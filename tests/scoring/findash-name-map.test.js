'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  buildNameMap,
  enrichRows,
  normalizeTicker,
} = require('../../scripts/build-findash-name-map.js');

let pass = 0;
let fail = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
    console.log('  ok   ' + name);
  } catch (error) {
    fail++;
    console.error('FAIL   ' + name + '\n       ' + error.message);
  }
}

const overviewBytes = (rows) => Buffer.from(JSON.stringify({ schema: 'findash-export/v1', rows }));
const sha = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('exact snapshot names win case-insensitively and keep their provenance', () => {
  const artifact = buildNameMap({
    overviewBytes: overviewBytes([{ rank: 1, ticker: 'nvda', score: 92.4 }]),
    snapshots: [{ meta: { ticker: 'NVDA', name: '  NVIDIA   Corporation  ' } }],
    watchlist: [{ ticker: 'NVDA', yahoo_symbol: 'NVDA', name: 'NVIDIA' }],
  });

  assert.deepEqual(artifact.entries, [{
    ticker: 'nvda', normalizedTicker: 'NVDA', name: 'NVIDIA Corporation',
    provenance: 'snapshot-exact',
  }]);
  assert.equal(artifact.mappedCount, 1);
  assert.deepEqual(artifact.unresolved, []);
  assert.deepEqual(artifact.ambiguous, []);
});

test('ticker placeholders plus HTML/control payloads are rejected', () => {
  const artifact = buildNameMap({
    overviewBytes: overviewBytes([
      { rank: 1, ticker: 'APP', score: 95.4 },
      { rank: 2, ticker: 'BAD', score: 90 },
      { rank: 3, ticker: 'CTRL', score: 89 },
    ]),
    snapshots: [{ meta: { ticker: 'APP', name: 'APP' } }],
    watchlist: [
      { ticker: 'APP', yahoo_symbol: 'APP', name: 'APP' },
      { ticker: 'BAD', yahoo_symbol: 'BAD', name: '<img onerror=alert(1)>' },
      { ticker: 'CTRL', yahoo_symbol: 'CTRL', name: 'Control\u0007Corp' },
    ],
  });

  assert.deepEqual(artifact.entries, []);
  assert.deepEqual(artifact.unresolved, ['APP', 'BAD', 'CTRL']);
  assert.deepEqual(artifact.rejectedCandidates, { invalid: 0, placeholder: 2, unsafe: 2 });
});

test('market suffix fallback is accepted only for one instrument and one name', () => {
  const artifact = buildNameMap({
    overviewBytes: overviewBytes([
      { rank: 1, ticker: 'FNV', score: 90 },
      { rank: 2, ticker: 'DUAL', score: 89 },
    ]),
    snapshots: [
      { meta: { ticker: 'FNV.TO', name: 'Franco-Nevada Corporation' } },
      { meta: { ticker: 'DUAL.L', name: 'Dual London PLC' } },
      { meta: { ticker: 'DUAL.AX', name: 'Dual Australia Ltd' } },
    ],
    watchlist: [],
  });

  assert.equal(artifact.entries[0].normalizedTicker, 'FNV');
  assert.equal(artifact.entries[0].provenance, 'snapshot-unique-base');
  assert.deepEqual(artifact.ambiguous, [{ normalizedTicker: 'DUAL', stage: 'market-base' }]);
  assert.deepEqual(artifact.unresolved, ['DUAL']);
});

test('conflicting exact candidates are never guessed', () => {
  const artifact = buildNameMap({
    overviewBytes: overviewBytes([{ rank: 1, ticker: 'SAME', score: 88 }]),
    snapshots: [
      { meta: { ticker: 'same', name: 'First Corporation' } },
      { meta: { ticker: 'SAME', name: 'Second Corporation' } },
    ],
    watchlist: [],
  });

  assert.deepEqual(artifact.entries, []);
  assert.deepEqual(artifact.ambiguous, [{ normalizedTicker: 'SAME', stage: 'snapshot-exact' }]);
  assert.deepEqual(artifact.unresolved, ['SAME']);
});

test('enrichment is additive and stripping name restores every published row byte-for-byte', () => {
  const rows = [
    { rank: 1, ticker: 'APP', score: 95.4, lamps: ['peakMargin'] },
    { rank: 2, ticker: 'MISS', score: 91.2, lamps: [] },
  ];
  const artifact = buildNameMap({
    overviewBytes: overviewBytes(rows),
    snapshots: [{ meta: { ticker: 'app', name: 'AppLovin Corporation' } }],
    watchlist: [],
  });
  const enriched = enrichRows(rows, artifact);
  const stripped = enriched.map(({ name, ...row }) => row);

  assert.equal(enriched[0].name, 'AppLovin Corporation');
  assert.equal(Object.hasOwn(enriched[1], 'name'), false, 'unresolved stays unavailable, never fabricated');
  assert.equal(sha(stripped), sha(rows));
  assert.deepEqual(stripped, rows);
});

test('artifact is deterministic and bound to the exact published overview bytes', () => {
  const bytes = overviewBytes([{ rank: 1, ticker: 'APP', score: 95.4 }]);
  const input = {
    overviewBytes: bytes,
    snapshots: [{ meta: { ticker: 'APP', name: 'AppLovin Corporation' } }],
    watchlist: [],
  };
  const left = buildNameMap(input);
  const right = buildNameMap(input);

  assert.deepEqual(left, right);
  assert.match(left.sourceOverviewSha256, /^[a-f0-9]{64}$/);
  assert.equal(left.sourceOverviewSha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.equal(normalizeTicker(' fnv.to '), 'FNV.TO');
});

test('tracked current-public artifact is complete, safe and leaves placeholders unresolved', () => {
  const artifact = require('../../external-data/findash-name-map.json');
  const normalized = artifact.entries.map((entry) => entry.normalizedTicker);

  assert.equal(artifact.schema, 'findash-name-map/v1');
  assert.equal(artifact.rowCount, 200);
  assert.equal(artifact.mappedCount, 180);
  assert.equal(artifact.coveragePct, 90);
  assert.equal(artifact.entries.length + artifact.unresolved.length, artifact.rowCount);
  assert.equal(new Set(normalized).size, normalized.length);
  assert.deepEqual(normalized, [...normalized].sort((a, b) => a.localeCompare(b, 'en')));
  assert.ok(artifact.entries.every((entry) => entry.name === entry.name.replace(/\s+/g, ' ').trim()));
  assert.ok(artifact.entries.every((entry) => !/[<>\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(entry.name)));
  assert.ok(artifact.entries.every((entry) => entry.name.toUpperCase() !== entry.normalizedTicker));
  assert.ok(artifact.unresolved.includes('ELPC'));
  assert.ok(artifact.unresolved.includes('LTM'));
  assert.equal(artifact.entries.find((entry) => entry.normalizedTicker === 'APP').name, 'AppLovin Corporation');
  assert.equal(artifact.entries.find((entry) => entry.normalizedTicker === 'NVDA').name, 'NVIDIA Corporation');
});

console.log(`\nfindash-name-map.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
