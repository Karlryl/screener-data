'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { rowFor, buildFeed, validate, build, ROW_KEYS, MAX_BYTES } = require('../scripts/write-bewertung-export.js');
const { beurteileWaehrungsbeleg } = require('../scripts/write-findash-export.js');
const full = require('./fixtures/bewertung/snapshot-full.json');
const w6 = require('./fixtures/w6/snapshots.json');
const generatedAt = '2026-10-14T12:00:00Z';
const make = (list = full) => buildFeed({ snapshots: list, generatedAt });
const bytesOf = feed => Buffer.byteLength(JSON.stringify(feed));
const clone = ticker => structuredClone(full.find(s => s.meta.ticker === ticker));
const row = (feed, ticker) => feed.rows.find(r => r.t === ticker);
const script = path.resolve(__dirname, '../scripts/write-bewertung-export.js');

test('hand fixture arithmetic is exact: net income 100 on market cap 1000 gives ep 10', () => {
  const before = JSON.stringify(full), feed = make();
  assert.equal(JSON.stringify(full), before);
  assert.deepEqual(row(feed, 'FULL'), {
    t: 'FULL', ep: 10, cp: 20, bp: 50, nd: 1, ndSt: 'geprueft', gj: '2025-12-31',
    // Five stored quarters (oldest first) -> the four newest, newest first; an exact EPS zero is a statement and stays.
    q4: [{ q: '2026-06-30', eps: 2.01 }, { q: '2026-03-31', eps: 0 }, { q: '2025-12-31', eps: 1.5 }, { q: '2025-09-30', eps: 1.25 }],
    qc: 'USD', asOf: '2026-10-02',
  });
  // Losses and negative cash flow are real values; net debt needs positive operating cash flow.
  assert.deepEqual(row(feed, 'LOSS'), { t: 'LOSS', ep: -5, cp: -4, bp: 20, ndSt: 'nicht-geprueft', gj: '2025-12-31', asOf: '2026-10-10' });
  // JPY row: ratio is currency-neutral (both sides USD), EPS stays in JPY and says so.
  assert.deepEqual(row(feed, 'YEN'), { t: 'YEN', ep: 10, gj: '2025-03-31', q4: [{ q: '2026-03-31', eps: 71.51 }], qc: 'JPY', asOf: '2026-10-10' });
  assert.deepEqual(validate(feed, bytesOf(feed)), []);
  for (const r of feed.rows) assert.deepEqual(Object.keys(r), ROW_KEYS.filter(k => Object.hasOwn(r, k)));
});

test('failed currency evidence yields no ep, cp or bp; figures without market cap stay', () => {
  const failing = [
    s => { s.meta.tradingCurrencyAssumed = true; },
    s => { delete s.meta.tradingCurrency; },
    s => { s.meta.tradingCurrency = 'EUR'; },
  ];
  for (const change of failing) {
    const s = clone('FULL'); change(s);
    assert.equal(beurteileWaehrungsbeleg(s.meta).ok, false);
    const r = rowFor(s);
    for (const key of ['ep', 'cp', 'bp']) assert.equal(Object.hasOwn(r, key), false, key);
    assert.equal(r.nd, 1);
    assert.equal(r.q4.length, 4);
  }
  assert.equal(beurteileWaehrungsbeleg(clone('FULL').meta).ok, true);
  // A missing, zero or negative market cap is no denominator.
  for (const value of [undefined, null, 0, -5, NaN, Infinity, '1000']) {
    const s = clone('FULL'); s.marketCap = { value };
    const r = rowFor(s);
    for (const key of ['ep', 'cp', 'bp']) assert.equal(Object.hasOwn(r, key), false, key + ' @ ' + String(value));
  }
  // Nothing at all to show: no row, so the file holds only snapshots with a value.
  const bare = clone('FULL'); bare.annual = {}; bare.external = {};
  assert.equal(rowFor(bare), null);
  const noCurrency = clone('FULL'); noCurrency.meta.tradingCurrency = 'EUR'; noCurrency.annual = {}; noCurrency.external = {};
  assert.equal(rowFor(noCurrency), null);
});

test('withheld instead of wrong: zero placeholders, partial debt, statements of another year, unknown EPS currency', () => {
  let s = clone('FULL'); s.annual.annualNetIncome[0].value = 0; s.annual.annualBalance[0].totalEquity = 0; s.annual.annualOCF[0].value = 0;
  let r = rowFor(s);
  for (const key of ['ep', 'cp', 'bp', 'nd']) assert.equal(Object.hasOwn(r, key), false, key + ' zero placeholder');
  assert.equal(r.ndSt, 'nicht-geprueft');
  s = clone('FULL'); s.annual.annualBalance[0]._debtPartial = true;
  r = rowFor(s);
  assert.equal(r.nd, undefined); assert.equal(r.ndSt, 'nicht-geprueft'); assert.equal(r.ep, 10);
  s = clone('FULL'); s.annual.annualOCFEnds[0] = '2026-03-31';
  r = rowFor(s);
  assert.equal(r.cp, undefined); assert.equal(r.nd, undefined); assert.equal(r.ep, 10); assert.equal(r.bp, 50);
  s = clone('FULL'); s.annual.annualBalanceEnds[0] = '2024-12-31';
  r = rowFor(s);
  assert.equal(r.bp, undefined); assert.equal(r.nd, undefined); assert.equal(r.cp, 20);
  // Unknown period ends cannot prove a clash; the net-income year stays the label.
  s = clone('FULL'); delete s.annual.annualOCFEnds; delete s.annual.annualBalanceEnds;
  r = rowFor(s);
  assert.equal(r.cp, 20); assert.equal(r.bp, 50); assert.equal(r.nd, 1);
  s = clone('FULL'); s.meta.reportingCurrency = null;
  assert.equal(rowFor(s).q4, undefined); assert.equal(rowFor(s).qc, undefined);
  s = clone('FULL'); s.external.earningsHistory = [{ quarter: 'not-a-date', epsActual: 1 }, { quarter: '2026-06-30T00:00:00.000Z', epsActual: null },
    { quarter: '2026-03-31T00:00:00.000Z', epsActual: 1 }, { quarter: '2026-03-31T00:00:00.000Z', epsActual: 9 }];
  assert.deepEqual(rowFor(s).q4, [{ q: '2026-03-31', eps: 1 }]);
});

test('real fixtures from the W6 set: tiny ratios keep two significant digits, rows without values are absent', () => {
  const feed = make(w6);
  assert.equal(feed.snapshotCount, w6.length);
  assert.deepEqual(feed.rows.map(r => r.t), ['PAY']);
  assert.deepEqual(row(feed, 'PAY'), { t: 'PAY', ep: 0.000001, cp: 0.000003, ndSt: 'nicht-geprueft', asOf: '2026-10-02' });
  assert.deepEqual(validate(feed, bytesOf(feed)), []);
});

test('no rank, percentile, score, signal or fund name can appear', () => {
  assert.deepEqual(ROW_KEYS, ['t', 'ep', 'cp', 'bp', 'nd', 'ndSt', 'gj', 'q4', 'qc', 'asOf']);
  const feed = make(), keys = new Set(feed.rows.flatMap(r => Object.keys(r)));
  for (const key of [...keys, ...ROW_KEYS, ...Object.keys(feed)]) assert.doesNotMatch(key, /rank|rk|perc|pct|score|sc$|signal|sig|fond|fund/i);
});

test('validator goes red on every tamper variant and stays green on the control', () => {
  assert.deepEqual(validate(make(), bytesOf(make())), []);
  const tampers = {
    'missing ticker': f => { delete row(f, 'FULL').t; },
    'ep not finite (string)': f => { row(f, 'FULL').ep = '10'; },
    'ep not finite (NaN)': f => { row(f, 'FULL').ep = NaN; },
    'unknown key': f => { row(f, 'FULL').rank = 1; },
    'null value': f => { row(f, 'FULL').cp = null; },
    'nd without ndSt': f => { delete row(f, 'FULL').ndSt; },
    'ndSt geprueft without nd': f => { row(f, 'LOSS').ndSt = 'geprueft'; },
    'ndSt nicht-geprueft with nd': f => { row(f, 'FULL').ndSt = 'nicht-geprueft'; },
    'ndSt unknown state': f => { row(f, 'FULL').ndSt = 'ok'; },
    'ndSt unknown state without nd': f => { row(f, 'LOSS').ndSt = 'ok'; },
    'q4 longer than four': f => { const r = row(f, 'FULL'); r.q4.push({ q: '2025-06-30', eps: 0.9 }); },
    'q4 empty': f => { row(f, 'FULL').q4 = []; },
    'q4 not newest first': f => { row(f, 'FULL').q4.reverse(); },
    'q4 bad date': f => { row(f, 'FULL').q4[0].q = '2026-02-30'; },
    'q4 item with extra key': f => { row(f, 'FULL').q4[0].note = 'x'; },
    'q4 without qc': f => { delete row(f, 'FULL').qc; },
    'qc without q4': f => { row(f, 'LOSS').qc = 'USD'; },
    'asOf not a day': f => { row(f, 'FULL').asOf = '2026-10-02T09:00:00Z'; },
    'gj impossible day': f => { row(f, 'FULL').gj = '2025-02-30'; },
    'duplicate ticker': f => { f.rows.push(structuredClone(row(f, 'FULL'))); f.snapshotCount++; },
    'more rows than snapshots': f => { f.snapshotCount = 1; },
    'row without a value': f => { f.rows.push({ t: 'EMPTY', ndSt: 'nicht-geprueft' }); f.snapshotCount++; },
    'wrong schema': f => { f.schema = 'findash-export/v2'; },
    'generated_at unparsable': f => { f.generated_at = 'yesterday'; },
    'rows missing': f => { delete f.rows; },
  };
  for (const [name, mutate] of Object.entries(tampers)) {
    const feed = make(); mutate(feed);
    assert.ok(validate(feed, 1000).length > 0, name);
  }
});

test('the size cap is enforced exactly', () => {
  const feed = make();
  assert.ok(validate(feed, MAX_BYTES + 1).some(e => e.includes('Size')));
  assert.ok(validate(feed, 0).some(e => e.includes('Size')));
  assert.deepEqual(validate(feed, MAX_BYTES), []);
  assert.equal(MAX_BYTES, 4_000_000);
});

function fixtureTree(snapshots, { population = snapshots.length } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bewertung-'));
  const snapshotsDir = path.join(dir, 'snapshots'), v1Dir = path.join(dir, 'v1');
  fs.mkdirSync(snapshotsDir); fs.mkdirSync(path.join(v1Dir, 'filter'), { recursive: true });
  const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
  for (const snapshot of snapshots) write(path.join(snapshotsDir, snapshot.meta.ticker + '.json'), snapshot);
  write(path.join(snapshotsDir, '_manifest.json'), { note: 'metadata file, not a snapshot' });
  const watchlistFile = path.join(dir, 'watchlist.json');
  write(watchlistFile, { stocks: snapshots.map(s => ({ ticker: s.meta.ticker })) });
  write(path.join(v1Dir, 'index.json'), { schema: 'findash-export/v1', generated_at: generatedAt, generatedFromSnapshots: population, branches: ['x'] });
  return { dir, snapshotsDir, v1Dir, watchlistFile, target: path.join(v1Dir, 'filter', 'bewertung.json') };
}
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('build is idempotent, leaves universum.json untouched and rejects a foreign generation', () => {
  const t = fixtureTree(full);
  const universe = path.join(t.v1Dir, 'filter', 'universum.json');
  fs.writeFileSync(universe, '{"stand":"unveraendert"}');
  const universeHash = sha(universe), indexHash = sha(path.join(t.v1Dir, 'index.json'));
  const options = { snapshotsDir: t.snapshotsDir, v1Dir: t.v1Dir, watchlistFile: t.watchlistFile };
  const first = build(options), hash = sha(t.target);
  const second = build(options);
  assert.equal(sha(t.target), hash);
  assert.equal(first.bytes, second.bytes);
  assert.equal(first.bytes, fs.statSync(t.target).size);
  assert.equal(sha(universe), universeHash);
  assert.equal(sha(path.join(t.v1Dir, 'index.json')), indexHash);
  assert.deepEqual(fs.readdirSync(path.join(t.v1Dir, 'filter')).sort(), ['bewertung.json', 'universum.json']);
  assert.equal(first.feed.snapshotCount, full.length);
  assert.deepEqual(first.feed.rows.map(r => r.t), ['FULL', 'LOSS', 'YEN']);
  assert.equal(row(first.feed, 'FULL').ep, 10);
  assert.deepEqual(JSON.parse(fs.readFileSync(t.target, 'utf8')), first.feed);
  const foreign = fixtureTree(full, { population: full.length + 1 });
  assert.throws(() => build({ snapshotsDir: foreign.snapshotsDir, v1Dir: foreign.v1Dir, watchlistFile: foreign.watchlistFile }), /population mismatch/);
  assert.equal(fs.existsSync(foreign.target), false);
});

test('CLI checks a real file, rejects a corrupted copy and an oversized one, and self-tests', () => {
  const t = fixtureTree(full), run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  build({ snapshotsDir: t.snapshotsDir, v1Dir: t.v1Dir, watchlistFile: t.watchlistFile });
  const hash = sha(t.target);
  const ok = run('--check', '--v1-dir', t.v1Dir);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /check OK/);
  // Only generated fixture copies are break targets; the good file is never mutated.
  const bad = fixtureTree(full), corrupt = make(); row(corrupt, 'FULL').rank = 1;
  fs.writeFileSync(bad.target, JSON.stringify(corrupt));
  const rejected = run('--check', '--v1-dir', bad.v1Dir);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /row shape/);
  const big = fixtureTree(full), source = row(make(), 'FULL');
  const rows = Array.from({ length: 30000 }, (_, i) => ({ ...source, t: 'T' + String(i).padStart(6, '0') }));
  fs.writeFileSync(big.target, JSON.stringify({ schema: 'findash-export/v1', generated_at: generatedAt, snapshotCount: rows.length, rows }));
  assert.ok(fs.statSync(big.target).size > MAX_BYTES);
  const oversized = run('--check', '--v1-dir', big.v1Dir);
  assert.equal(oversized.status, 1);
  assert.match(oversized.stderr, /Size must be between/);
  assert.equal(run('--check', '--v1-dir', path.join(t.dir, 'nowhere')).status, 1);
  assert.equal(run('--unknown').status, 1);
  const self = run('--selftest');
  assert.equal(self.status, 0, self.stderr);
  assert.equal(sha(t.target), hash);
});
