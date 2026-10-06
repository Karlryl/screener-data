'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const shadow = require('../../lib/dup-issuer-shadow-table.js');
const table = shadow.loadDupIssuerShadowTable();
const writerFile = path.join(__dirname, '..', '..', 'scripts', 'write-findash-export.js');
const writerSource = fs.readFileSync(writerFile, 'utf8');

// Execute the real mappers. Unrelated data helpers are inert; no snapshot, ATH,
// calibration or engine-output file is opened. The real shadow loader still runs.
function writer(apply = shadow.applyDupIssuerShadow, loader = shadow.loadDupIssuerShadowTable) {
  const module = { exports: {} };
  const context = {
    module, __dirname: path.dirname(writerFile), process: { env: {} }, console,
    require(id) {
      if (id === 'path') return path;
      if (id === 'fs') return { readFileSync() { throw new Error('Fixture has no external data'); } };
      if (id === '../lib/dup-issuer-shadow-table.js') return { ...shadow, applyDupIssuerShadow: apply, loadDupIssuerShadowTable: loader };
      return { displayFor: () => null, financialReasons: () => [], safeSnapshotFilename: (ticker) => ticker + '.json' };
    },
  };
  vm.runInNewContext(writerSource, context, { filename: writerFile });
  return module.exports;
}

function assertMarked(rows) {
  for (const entry of Object.values(table)) {
    for (const row of rows.filter((r) => entry.tickers.includes(r.ticker))) {
      if (row.ticker === entry.codeKeeps) assert.ok(!Object.hasOwn(row, 'dupIssuer'), `${row.ticker}: kept ticker must not be flagged`);
      else assert.equal(row.dupIssuer?.of, entry.codeKeeps, `${row.ticker}: missing/wrong dupIssuer.of (expected ${entry.codeKeeps})`);
    }
  }
}

const fixture = (tickers) => tickers.map((ticker, i) => ({
  ticker, name: `Original ${ticker}`, rank: i + 1, score: 90 - i,
  track: 'profitable', coverageAxes: '7/7', marketCap: null, revGrowthYoYPct: null,
  lamps: [], runwayQuarters: 12 - i,
}));
const unprocessed = fixture(['ELPC', 'CPLE3.SA']);

// Deliberate red run uses only an unprocessed in-memory fixture, never source mutation.
if (process.argv.includes('--prove-red')) {
  assertMarked(unprocessed);
  throw new Error('Guard failed to reject the unprocessed fixture');
}

test('guard detects the bypassed applicator on the unprocessed pair', () => {
  assert.throws(() => assertMarked(unprocessed), /CPLE3\.SA: missing\/wrong dupIssuer\.of/);
});

test('all three real mappers mark every listed secondary and change no other output', () => {
  const mapped = writer();
  const bypassed = writer((row) => row);
  for (const mapper of ['mapBoardRow', 'mapOverviewRow', 'mapSurvivalRow']) {
    for (const entry of Object.values(table)) {
      const input = fixture(entry.tickers);
      const inputBytes = JSON.stringify(input);
      const rows = input.map(mapped[mapper]);
      const baseline = input.map(bypassed[mapper]);
      assert.equal(rows.length, input.length);
      assertMarked(rows);
      for (const row of rows) {
        if (row.ticker !== entry.codeKeeps) assert.deepEqual(row.dupIssuer, {
          of: entry.codeKeeps, issuer: entry.issuer, basis: 'hand-table:dup-issuer-shadow',
        });
      }
      const stripped = rows.map(({ dupIssuer, ...rest }) => rest);
      assert.equal(JSON.stringify(stripped), JSON.stringify(baseline), `${mapper}: unrelated output changed`);
      assert.equal(JSON.stringify(input), inputBytes, 'source rows were mutated');
    }
  }
});

test('secondary alone is still marked, including the short-list AVAV.SW case', () => {
  const rows = fixture(['AVAV.SW']).map(writer().mapBoardRow);
  assertMarked(rows);
  assert.equal(rows[0].dupIssuer.of, 'AVAV');
});

test('distinct issuers remain two rows, absent table issuers cause no flag or error', () => {
  const rows = fixture(['FBNC', 'FBP']).map(writer().mapBoardRow);
  assert.deepEqual(rows.map((row) => row.ticker), ['FBNC', 'FBP']);
  assert.ok(rows.every((row) => !Object.hasOwn(row, 'dupIssuer')));
  assertMarked(rows);
  assertMarked([]);
});

test('shared mapper loads once and never silently ignores a missing or malformed table', () => {
  let loads = 0;
  const mapped = writer(shadow.applyDupIssuerShadow, () => { loads++; return shadow.loadDupIssuerShadowTable(); });
  for (const mapper of ['mapBoardRow', 'mapOverviewRow', 'mapSurvivalRow']) fixture(['ELPC', 'CPLE3.SA']).map(mapped[mapper]);
  assert.equal(loads, 1);
  for (const message of ['ENOENT: missing table', 'malformed table']) {
    const broken = writer(shadow.applyDupIssuerShadow, () => { throw new Error(message); });
    assert.throws(() => broken.mapBoardRow(fixture(['ELPC'])[0], 0), { message });
    assert.throws(() => broken.build(), { message });
  }
});
