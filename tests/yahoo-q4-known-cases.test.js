'use strict';

// Break-once mutates only an in-memory table fixture. Never target a writing test or real data.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { applyKnownCases, validateTable } = require('../lib/yahoo-q4-known-cases.js');
const { mapFTSToQuarterly, _convertSnapshotToUSD } = require('../pull-yahoo.js');
const { readScoringSnapshot, loadUniverse, loadSmallcapUniverse } = require('../src/scoring/run-screener.js');
const { norm } = require('../src/scoring/snapshot.js');
const evidence = require('./fixtures/yahoo-q4-known-cases.json');
const table = require('../configs/yahoo-q4-known-cases.json');
const clone = x => JSON.parse(JSON.stringify(x));
const valueOf = x => typeof x === 'number' ? x : x?.value;
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const tablePath = path.resolve(__dirname, '../configs/yahoo-q4-known-cases.json');
const beforeHash = sha(tablePath);
const fields = { revenueQ: ['totalRevenue', 'annualRev'], opIncQ: ['operatingIncome', 'annualOpInc'], grossProfitQ: ['grossProfit', 'annualGP'] };
let pass = 0;
function test(name, fn) { fn(); pass++; console.log(`ok ${name}`); }
function fixture(ticker) {
  const receipt = evidence.receipts[ticker];
  const c = evidence.cells.find(c => c.ticker === ticker);
  const annual = {};
  for (const [source, field] of Object.values(fields)) {
    const rows = receipt.annual.slice().sort((a, b) => b.date.localeCompare(a.date));
    annual[field] = rows.map(r => Number.isFinite(r[source]) ? { value: r[source] } : null);
    annual[field + 'Ends'] = rows.map(r => r.date.slice(0, 10));
  }
  return { meta: { ticker, reportingCurrency: c.currency, tradingCurrency: c.currency, fetchedAt: '2026-09-27T00:00:00Z' },
    timeseries: mapFTSToQuarterly(receipt.quarterly.slice().sort((a, b) => a.date.localeCompare(b.date))), annual };
}
function index(s, c) { return s.timeseries[c.field + 'Ends'].indexOf(c.period); }

test('table is exactly ten WRONG cases and 27 unique listing cells', () => {
  assert.equal(table.cases.length, 10);
  const keys = table.cases.flatMap(c => c.listingAliases.map(t => `${t}|${c.field}|${c.period}`)).sort();
  assert.deepEqual(keys, evidence.cells.filter(c => c.verdict === 'WRONG').map(c => `${c.ticker}|${c.field}|${c.period}`).sort());
  assert.throws(() => validateTable({}), /Invalid/);
  const bad = clone(table); bad.cases.push(bad.cases[0]); assert.throws(() => validateTable(bad), /Duplicate/);
});

test('source precision belongs to each document, not its issuer', () => {
  for (const c of table.cases.filter(c => c.issuerId === 'chipmos')) {
    assert.equal(c.sourcePrecisionNative, 1000, 'Primary FY/9M financial statements use thousands');
    assert.equal(c.sources.find(s => s.url.endsWith('en_ir_income_4850693036.pdf')).unit, 'TWD thousands');
    assert.equal(c.sources.find(s => s.url.endsWith('en_ir_income_3828614009.pdf')).unit, 'TWD thousands');
    assert.equal(c.sources.find(s => s.url.endsWith('en_ir_lawsaid_2850608037.pdf')).unit, 'TWD millions');
  }
});

for (const c of evidence.cells) test(`${c.verdict}: ${c.ticker} ${c.field}`, () => {
  const original = fixture(c.ticker), before = JSON.stringify(original), i = index(original, c);
  assert.equal(valueOf(original.timeseries[c.field][i]), c.vendorNative, 'Retained vendor receipt');
  const result = applyKnownCases(original), out = result.snapshot;
  assert.equal(norm(out, c.field)[i], c.expectedNative);
  assert.equal(JSON.stringify(original), before, 'Input never mutated');
  assert.equal(JSON.stringify(applyKnownCases(out).snapshot), JSON.stringify(out), 'Idempotent');
  if (c.verdict !== 'WRONG') assert.deepEqual(out.timeseries[c.field][i], original.timeseries[c.field][i]);
  else assert.equal(out.timeseries[c.field][i].yahooQ4Correction.originalVendorNativeValue, c.vendorNative);
  const converted = clone(original);
  _convertSnapshotToUSD(converted); // The actual production pre-FX hook, not a helper simulation.
  const expectedUSD = c.expectedNative === null ? null : c.expectedNative * converted.meta.fxRateApplied;
  assert.equal(norm(converted, c.field)[i], expectedUSD, 'Applied before existing FX exactly once');
  const bytes = JSON.stringify(converted); _convertSnapshotToUSD(converted);
  assert.equal(JSON.stringify(converted), bytes, 'No double conversion');
  assert.equal(JSON.stringify(applyKnownCases(converted).snapshot), bytes, 'Scoring after pull is idempotent');
});

for (const c of table.cases) test(`absence controls: ${c.caseId}`, () => {
  const base = fixture(c.listingAliases[0]), i = index(base, c);
  for (const [label, mutate] of [
    ['true zero', s => { s.timeseries[c.field][i].value = 0; }],
    ['stale value', s => { s.timeseries[c.field][i].value += 1; }],
    ['other period', s => { s.timeseries[c.field + 'Ends'][i] = '2024-12-31'; }],
    ['other field', s => { s.timeseries.otherQ = s.timeseries[c.field]; delete s.timeseries[c.field]; }],
    ['other issuer', s => { s.meta.ticker = 'UNLISTED'; }],
    ['currency', s => { s.meta.reportingCurrency = 'GBP'; }],
    ['unit', s => { s.timeseries[c.field][i].unit = 'millions'; }],
    ['multiplier', s => { s.timeseries[c.field][i].multiplier = 1000; }],
    ['period type', s => { s.timeseries[c.field][i].periodType = '12M'; }],
    ['provider', s => { s.timeseries[c.field][i].source = 'SEC'; }],
    ['annual fingerprint', s => { s.annual[c.inputFingerprint.annualField][0].value += 1; }],
    ['annual unit', s => { s.annual[c.inputFingerprint.annualField][0].unit = 'millions'; }],
    ['FX proof missing', s => { Object.assign(s.meta, { fxConverted: true, reportingCurrency: 'USD', reportingCurrencyOriginal: c.nativeCurrency }); }],
    ['already corrected', s => { s.timeseries[c.field][i].value = c.replacementNativeValue; }],
  ]) {
    const s = clone(base); mutate(s);
    // Other verified fields of this issuer may still be corrected; the target cell must not move.
    const before = JSON.stringify(s.timeseries[c.field]?.[i]);
    const out = applyKnownCases(s);
    assert.equal(JSON.stringify(out.snapshot.timeseries[c.field]?.[i]), before, label);
    if (label === 'stale value' || label === 'annual fingerprint') assert.ok(out.stats.stale > 0, label);
  }
});

test('unlisted incomplete subtraction logs and counts, without changing any value', () => {
  const s = fixture('AENA.MC'); s.meta.ticker = 'UNLISTED';
  const events = [], before = JSON.stringify(s);
  const r = applyKnownCases(s, { onEvent: e => events.push(e) });
  assert.ok(r.stats.observed > 0); assert.equal(events.length, r.stats.observed);
  assert.equal(JSON.stringify(r.snapshot), before);
});

test('real scoring loaders and normalized cache reader apply immediately', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yahoo-q4-scoring-test-'));
  const c = evidence.cells.find(c => c.ticker === 'AENA.MC' && c.verdict === 'WRONG');
  const s = fixture(c.ticker), factor = 1.1587486;
  // A legacy USD cache predates this correction; retain its original vendor value.
  for (const container of [s.timeseries, s.annual]) for (const [key, rows] of Object.entries(container)) {
    if (!key.endsWith('Ends')) container[key] = rows.map(r => r == null ? r : { ...r, value: r.value * factor });
  }
  Object.assign(s.meta, { reportingCurrency: 'USD', reportingCurrencyOriginal: 'EUR', fxConverted: true, fxRateApplied: factor });
  const file = path.join(dir, 'AENA.MC.json'), watchlist = path.join(dir, 'watchlist.fixture');
  assert.notEqual(path.resolve(dir), path.resolve(process.env.SCREENER_SNAPSHOTS_DIR || 'snapshots'));
  fs.writeFileSync(file, JSON.stringify(s));
  fs.writeFileSync(watchlist, JSON.stringify({ stocks: [{ ticker: c.ticker }] }));
  const h = sha(file);
  for (const out of [readScoringSnapshot(file), ...loadUniverse(dir, watchlist), ...loadSmallcapUniverse(dir, watchlist)]) {
    assert.equal(norm(out, c.field)[index(out, c)], c.expectedNative * factor);
  }
  assert.equal(sha(file), h);
});

test('break-once: fixture row loss turns the presence guard red, live table SHA unchanged', () => {
  const broken = clone(table); broken.cases = broken.cases.filter(c => c.caseId !== 'aena-2025-q4-opIncQ');
  const input = fixture('AENA.MC');
  const qi = input.timeseries.opIncQEnds.indexOf('2025-12-31');
  const guard = config => assert.equal(norm(applyKnownCases(input, { table: config }).snapshot, 'opIncQ')[qi], 736818000);
  guard(table); assert.throws(() => guard(broken), assert.AssertionError); guard(table);
  assert.equal(sha(tablePath), beforeHash);
});

test('display evidence count and Rule40 use the same cached-snapshot correction', () => {
  const F = require('./rule40-fixture.js');
  const raw = fixture('GEST.MC');
  const s = F.snapshot({ ticker: 'GEST.MC', sector: 'Consumer Cyclical', industry: 'Auto Parts', revenueTTM: 11e9 });
  Object.assign(s.meta, raw.meta);
  Object.assign(s.annual, raw.annual);
  s.timeseries = raw.timeseries;
  const f = F.baueExport([{ row: F.boardZeile({ ticker: 'GEST.MC' }), snap: s, branch: 'consumer-discretionary', reihe: false }]);
  const file = path.join(f.snapshotsDir, 'GEST.MC.json'), before = sha(file);
  const priorEnv = process.env.FINDASH_SNAPSHOTS_DIR;
  process.env.FINDASH_SNAPSHOTS_DIR = f.snapshotsDir;
  const writerPath = require.resolve('../scripts/write-findash-export.js');
  delete require.cache[writerPath];
  try {
    const w = require(writerPath);
    const out = w.mapBoardRow(F.boardZeile({ ticker: 'GEST.MC' }), 0);
    assert.equal(out.qPunkte, w.belegPunkte(s.timeseries).qPunkte - 1, 'Missing Q4 is not counted as a revenue observation');
    const r = require('../scripts/write-rule40-export.js').sammleKandidaten({ v1Dir: f.v1Dir, snapshotsDir: f.snapshotsDir });
    const candidates = r.kandidaten;
    const candidate = candidates.find(c => c.ticker === 'GEST.MC');
    assert.ok(candidate, 'Fixture passes the real Rule40 route');
    const axes = require('../src/scoring/axes.js');
    assert.equal(candidate.wachstumRoh, axes.revGrowthLevel(applyKnownCases(s).snapshot));
    assert.notEqual(candidate.wachstumRoh, axes.revGrowthLevel(s), 'Reader hook has a measurable effect');
  } finally {
    if (priorEnv === undefined) delete process.env.FINDASH_SNAPSHOTS_DIR;
    else process.env.FINDASH_SNAPSHOTS_DIR = priorEnv;
    delete require.cache[writerPath];
    assert.equal(sha(file), before);
  }
});

if (process.env.SCREENER_SNAPSHOTS_DIR && fs.existsSync(process.env.SCREENER_SNAPSHOTS_DIR)) {
  test('real snapshot replay: exactly 27 changes, 44 controls, all other bytes and source hashes unchanged', () => {
    const r = require('../scripts/yahoo-q4-known-cases-replay.js').replay(process.env.SCREENER_SNAPSHOTS_DIR);
    console.log(`Real replay: ${r.snapshots} snapshots, ${r.changedCells} cells, ${r.controlsUnchanged} controls`);
  });
} else console.log('SKIP real snapshot replay: SCREENER_SNAPSHOTS_DIR not supplied/available');
console.log(`${pass} tests passed; break-once fired and restored.`);
