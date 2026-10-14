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
// Variants of the INRX fixture (statement kept in the listing currency but labelled USD): net income in the
// statement unit, vendor trailing PE (null removes it), FX stamps (reporting rate, trading rate per listing unit).
const inr = ({ ni = 5000, pe = 20, fT = 0.01, fR = 1, tc = 'INR', rc = 'USD' } = {}) => {
  const s = clone('INRX');
  s.annual.annualNetIncome[0].value = ni;
  if (pe === null) delete s.metrics.pe; else s.metrics.pe.value = pe;
  Object.assign(s.meta, { tradingFxRateApplied: fT, fxRateApplied: fR, tradingCurrencyOriginal: tc, tradingCurrency: tc, reportingCurrencyOriginal: rc });
  return s;
};

test('hand fixture arithmetic is exact: net income 100 on market cap 1000 gives ep 10', () => {
  const before = JSON.stringify(full), feed = make();
  assert.equal(JSON.stringify(full), before);
  assert.deepEqual(row(feed, 'FULL'), {
    t: 'FULL', ep: 10, cp: 20, bp: 50, nd: 1, ndSt: 'geprueft', gj: '2025-12-31',
    // Five stored quarters (oldest first) -> the four newest, newest first.
    q4: [{ q: '2026-06-30', eps: 2.01 }, { q: '2026-03-31', eps: 1.8 }, { q: '2025-12-31', eps: 1.5 }, { q: '2025-09-30', eps: 1.25 }],
    asOf: '2026-10-02',
  });
  // Losses and negative cash flow are real values; net debt needs positive operating cash flow.
  assert.deepEqual(row(feed, 'LOSS'), { t: 'LOSS', ep: -5, cp: -4, bp: 20, ndSt: 'nicht-geprueft', gj: '2025-12-31', asOf: '2026-10-10' });
  // JPY row: listing and reporting currency are both JPY, so the quarter EPS are listing-currency numbers.
  assert.deepEqual(row(feed, 'YEN'), { t: 'YEN', ep: 10, gj: '2025-03-31', q4: [{ q: '2026-03-31', eps: 71.51 }], asOf: '2026-10-10' });
  assert.deepEqual(validate(feed, bytesOf(feed)), []);
  for (const r of feed.rows) assert.deepEqual(Object.keys(r), ROW_KEYS.filter(k => Object.hasOwn(r, k)));
});

test('failed currency evidence yields no ep, cp, bp or q4; figures without market cap stay', () => {
  const failing = [
    s => { s.meta.tradingCurrencyAssumed = true; },
    s => { delete s.meta.tradingCurrency; },
    s => { s.meta.tradingCurrency = 'EUR'; },
  ];
  for (const change of failing) {
    const s = clone('FULL'); change(s);
    assert.equal(beurteileWaehrungsbeleg(s.meta).ok, false);
    const r = rowFor(s);
    for (const key of ['ep', 'cp', 'bp', 'q4']) assert.equal(Object.hasOwn(r, key), false, key);
    assert.equal(r.nd, 1);
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

test('withheld instead of wrong: zero placeholders, partial debt, statements of another year', () => {
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
});

test('a quarantined data packet shows no value at all, only the reason', () => {
  const s = clone('FULL'); s.meta.financialDataIssue = { caseId: 'fixture-case', reason: 'fixture packet unreliable' };
  assert.deepEqual(rowFor(s), { t: 'FULL', ohne: 'datenpaket-gesperrt' });
  // Even a snapshot with nothing else to show keeps the marker row.
  const bare = clone('FULL'); bare.annual = {}; bare.external = {}; bare.meta.financialDataIssue = { caseId: 'x', reason: 'y' };
  assert.deepEqual(rowFor(bare), { t: 'FULL', ohne: 'datenpaket-gesperrt' });
  assert.deepEqual(validate(make([s]), 1000), []);
});

test('mislabelled reporting currency is withheld; band edges and the garbage-PE look-alike are pinned', () => {
  // INRX: ep 500 %, vendor PE 20 (implied yield 5 %), r = 100 = cross rate 1 / 0.01: the HCLTECH.NS / PTTEP.BK pattern.
  assert.deepEqual(rowFor(clone('INRX')), { t: 'INRX', ohne: 'waehrung-unplausibel' });
  // Genuine USD reporter listed in INR with a garbage vendor PE: same r, but the implied yield is absurd -> values stay.
  let r = rowFor(inr({ ni: 50, pe: 2000 }));
  assert.equal(r.ohne, undefined); assert.equal(r.ep, 5); assert.equal(r.q4, undefined);
  // r band for cross rate 100 (net income 50 per unit of r, because mc 1000 and PE 20): 40 and 250 inclusive.
  for (const [rr, flagged] of [[250, true], [260, false], [40, true], [39, false]]) {
    assert.equal(rowFor(inr({ ni: 50 * rr }))?.ohne === 'waehrung-unplausibel', flagged, 'r ' + rr);
  }
  // Implied-yield band 1.5 to 50 % (PE 66.67 to 2), r held at 100 by scaling net income with 100000 / PE.
  for (const [pe, flagged] of [[66, true], [67, false], [2, true], [1.9, false]]) {
    assert.equal(rowFor(inr({ ni: 100000 / pe, pe }))?.ohne === 'waehrung-unplausibel', flagged, 'pe ' + pe);
  }
  // Cross rate 4 (fT 0.25): r must exceed 3; cross rate 2.5 (fT 0.4) is below the minimum cross rate of 3.
  assert.equal(rowFor(inr({ ni: 50 * 2.9, fT: 0.25 })).ohne, undefined);
  assert.equal(rowFor(inr({ ni: 50 * 3.2, fT: 0.25 })).ohne, 'waehrung-unplausibel');
  assert.equal(rowFor(inr({ ni: 50 * 5, fT: 0.4 })).ohne, undefined);
  // Pence listing: tradingFxRateApplied is per penny, the cross rate uses the pound (BHMG.L pattern): large r, no flag.
  assert.equal(rowFor(inr({ ni: 5000, fT: 0.0133, tc: 'GBp' })).ep, 500);
  assert.equal(rowFor(inr({ ni: 5000, fT: 0.0133, tc: 'GBP' })).ohne, 'waehrung-unplausibel');
  // A plain USD reporter on a euro listing sits near r = 1 and shows.
  r = rowFor(inr({ ni: 60, pe: 15, fT: 1.12, tc: 'EUR' }));
  assert.equal(r.ohne, undefined); assert.equal(r.ep, 6);
});

test('differing currencies without a cross-check are withheld; equal currencies are not', () => {
  // Loss, missing or non-positive trailing PE: nothing to check against while listing and reporting currency differ.
  for (const s of [inr({ ni: -5000 }), inr({ pe: null }), inr({ pe: 0 }), inr({ ni: 0 })]) {
    assert.deepEqual(rowFor(s), { t: 'INRX', ohne: 'waehrung-ungeprueft' });
  }
  // The same gaps with equal currencies change nothing.
  for (const s of [inr({ ni: -5000, rc: 'INR' }), inr({ pe: null, rc: 'INR' })]) {
    const r = rowFor(s); assert.equal(r.ohne, undefined); assert.ok(r.cp !== undefined);
  }
  // GBp is not GBP: no q4, and without a PE the row is withheld.
  assert.equal(rowFor(inr({ pe: null, tc: 'GBp', rc: 'GBP' })).ohne, 'waehrung-ungeprueft');
  // No row is created just to carry a reason: with nothing to show the snapshot stays out of the file.
  const bare = inr({ ni: -5000 }); bare.annual = {}; bare.external = {};
  assert.equal(rowFor(bare), null);
  // Failed listing-currency proof: no market-cap ratios exist, so no verdict either.
  const unproven = inr({ ni: -5000 }); unproven.meta.tradingCurrencyAssumed = true;
  assert.equal(rowFor(unproven).ohne, undefined);
});

test('q4 only with equal listing and reporting currency; zero EPS is a gap, not a number', () => {
  assert.equal(rowFor(clone('FULL')).q4.length, 4);
  // Differing, spelled differently (GBp / GBP), unknown or guessed currencies: no q4 (and no qc key exists at all).
  const variants = [
    s => Object.assign(s.meta, { tradingCurrencyOriginal: 'GBp', tradingCurrency: 'GBp', reportingCurrencyOriginal: 'GBP', tradingFxRateApplied: 0.0133, fxRateApplied: 1.3 }),
    s => { s.meta.reportingCurrency = null; },
    s => { delete s.meta.reportingCurrency; },
    s => { s.meta.tradingCurrencyAssumed = true; },
  ];
  for (const change of variants) { const s = clone('FULL'); change(s); assert.equal(rowFor(s).q4, undefined); assert.equal(rowFor(s).qc, undefined); }
  assert.equal(rowFor(inr({ ni: 50, pe: 2000 })).q4, undefined);
  // A zero or missing EPS leaves a visible gap in the four-quarter window instead of pulling an older quarter in.
  for (const eps of [0, null, NaN]) {
    const s = clone('FULL'); s.external.earningsHistory.find(q => q.quarter.startsWith('2026-03-31')).epsActual = eps;
    assert.deepEqual(rowFor(s).q4, [{ q: '2026-06-30', eps: 2.01 }, { q: '2025-12-31', eps: 1.5 }, { q: '2025-09-30', eps: 1.25 }]);
  }
  const zeros = clone('FULL'); for (const q of zeros.external.earningsHistory) q.epsActual = 0;
  assert.equal(rowFor(zeros).q4, undefined);
  const odd = clone('FULL'); odd.external.earningsHistory = [{ quarter: 'not-a-date', epsActual: 1 }, { quarter: '2026-06-30T00:00:00.000Z', epsActual: null },
    { quarter: '2026-03-31T00:00:00.000Z', epsActual: 1 }, { quarter: '2026-03-31T00:00:00.000Z', epsActual: 9 }];
  assert.deepEqual(rowFor(odd).q4, [{ q: '2026-03-31', eps: 1 }]);
  // No age limit is applied: the consumer filters on gj and the quarter dates.
  const old = clone('FULL'); old.annual.annualNetIncomeEnds = ['2011-12-31']; old.annual.annualOCFEnds = ['2011-12-31']; old.annual.annualBalanceEnds = ['2011-12-31'];
  old.external.earningsHistory = [{ quarter: '2014-06-30T00:00:00.000Z', epsActual: 0.4 }];
  assert.deepEqual(rowFor(old).q4, [{ q: '2014-06-30', eps: 0.4 }]); assert.equal(rowFor(old).gj, '2011-12-31');
});

test('real fixtures from the W6 set: tiny ratios keep two significant digits, rows without values are absent', () => {
  const feed = make(w6);
  assert.equal(feed.snapshotCount, w6.length);
  assert.deepEqual(feed.rows.map(r => r.t), ['PAY']);
  assert.deepEqual(row(feed, 'PAY'), { t: 'PAY', ep: 0.000001, cp: 0.000003, ndSt: 'nicht-geprueft', asOf: '2026-10-02' });
  assert.deepEqual(validate(feed, bytesOf(feed)), []);
});

test('no rank, percentile, score, signal or fund name can appear', () => {
  assert.deepEqual(ROW_KEYS, ['t', 'ep', 'cp', 'bp', 'nd', 'ndSt', 'gj', 'q4', 'asOf', 'ohne']);
  const feed = make(), keys = new Set(feed.rows.flatMap(r => Object.keys(r)));
  for (const key of [...keys, ...ROW_KEYS, ...Object.keys(feed)]) assert.doesNotMatch(key, /rank|rk|perc|pct|score|sc$|signal|sig|fond|fund/i);
});

test('validator goes red on every tamper variant and stays green on the control', () => {
  const control = make();
  assert.ok(control.rows.some(r => r.ohne), 'the control holds a withheld row');
  assert.deepEqual(validate(control, bytesOf(control)), []);
  const tampers = {
    'missing ticker': f => { delete row(f, 'FULL').t; },
    'ep not finite (string)': f => { row(f, 'FULL').ep = '10'; },
    'ep not finite (NaN)': f => { row(f, 'FULL').ep = NaN; },
    'unknown key': f => { row(f, 'FULL').rank = 1; },
    'qc is no key any more': f => { row(f, 'FULL').qc = 'USD'; },
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
    'q4 eps exactly zero': f => { row(f, 'FULL').q4[1].eps = 0; },
    'ohne unknown reason': f => { row(f, 'INRX').ohne = 'misc'; },
    'ohne row with a value': f => { row(f, 'INRX').ep = 500; },
    'ohne row with asOf': f => { row(f, 'INRX').asOf = '2026-10-02'; },
    'ohne on a row with values': f => { row(f, 'FULL').ohne = 'waehrung-unplausibel'; },
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
  // The generation of the board index next to the file must match exactly.
  assert.deepEqual(validate(control, bytesOf(control), generatedAt), []);
  assert.ok(validate(control, bytesOf(control), '2026-09-01T12:00:00Z').some(e => e.includes('Generation mismatch')));
});

test('the size cap is enforced exactly', () => {
  const feed = make();
  assert.ok(validate(feed, MAX_BYTES + 1).some(e => e.includes('Size')));
  assert.ok(validate(feed, 0).some(e => e.includes('Size')));
  assert.deepEqual(validate(feed, MAX_BYTES), []);
  assert.equal(MAX_BYTES, 4_000_000);
});

function fixtureTree(snapshots, { population = snapshots.length, generated = generatedAt } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bewertung-'));
  const snapshotsDir = path.join(dir, 'snapshots'), v1Dir = path.join(dir, 'v1');
  fs.mkdirSync(snapshotsDir); fs.mkdirSync(path.join(v1Dir, 'filter'), { recursive: true });
  const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
  for (const snapshot of snapshots) write(path.join(snapshotsDir, snapshot.meta.ticker + '.json'), snapshot);
  write(path.join(snapshotsDir, '_manifest.json'), { note: 'metadata file, not a snapshot' });
  const watchlistFile = path.join(dir, 'watchlist.json');
  write(watchlistFile, { stocks: snapshots.map(s => ({ ticker: s.meta.ticker })) });
  write(path.join(v1Dir, 'index.json'), { schema: 'findash-export/v1', generated_at: generated, generatedFromSnapshots: population, branches: ['x'] });
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
  assert.deepEqual(first.feed.rows.map(r => r.t), ['FULL', 'INRX', 'LOSS', 'YEN']);
  assert.equal(row(first.feed, 'FULL').ep, 10);
  assert.deepEqual(row(first.feed, 'INRX'), { t: 'INRX', ohne: 'waehrung-unplausibel' });
  assert.deepEqual(JSON.parse(fs.readFileSync(t.target, 'utf8')), first.feed);
  const foreign = fixtureTree(full, { population: full.length + 1 });
  assert.throws(() => build({ snapshotsDir: foreign.snapshotsDir, v1Dir: foreign.v1Dir, watchlistFile: foreign.watchlistFile }), /population mismatch/);
  assert.equal(fs.existsSync(foreign.target), false);
});

test('generated_at is copied character for character from index.json (the private raw copy compares the strings)', () => {
  // Spellings that a Date round trip or an own timestamp would change: milliseconds, an offset, zero milliseconds, none.
  for (const generated of ['2026-10-14T12:55:05.069Z', '2026-10-14T14:55:05+02:00', '2026-10-14T12:55:05.000Z', '2026-10-14T12:55:05Z']) {
    const t = fixtureTree(full, { generated });
    const index = JSON.parse(fs.readFileSync(path.join(t.v1Dir, 'index.json'), 'utf8'));
    assert.strictEqual(index.generated_at, generated);
    const { feed } = build({ snapshotsDir: t.snapshotsDir, v1Dir: t.v1Dir, watchlistFile: t.watchlistFile });
    assert.strictEqual(feed.generated_at, index.generated_at);
    const raw = fs.readFileSync(t.target, 'utf8');
    assert.strictEqual(JSON.parse(raw).generated_at, index.generated_at);
    assert.ok(raw.includes('"generated_at":' + JSON.stringify(index.generated_at) + ','), 'bytes on disk carry the index string');
    assert.equal(spawnSync(process.execPath, [script, '--check', '--v1-dir', t.v1Dir], { encoding: 'utf8' }).status, 0, generated);
    // Any other spelling of the same instant is a different generation for the comparison.
    const other = generated.endsWith('Z') ? generated.replace('Z', '+00:00') : generated.replace('+02:00', 'Z');
    assert.ok(validate(feed, bytesOf(feed), other).some(e => e.includes('Generation mismatch')), other);
  }
  assert.strictEqual(make().generated_at, generatedAt);
});

test('without the filter folder (filter universe step failed) nothing is written and the folder is not recreated', () => {
  const t = fixtureTree(full);
  fs.rmSync(path.join(t.v1Dir, 'filter'), { recursive: true });
  assert.throws(() => build({ snapshotsDir: t.snapshotsDir, v1Dir: t.v1Dir, watchlistFile: t.watchlistFile }), /filter\/ folder missing/);
  assert.equal(fs.existsSync(path.join(t.v1Dir, 'filter')), false);
});

test('CLI checks a real file, rejects a corrupted copy, a foreign generation and an oversized one, and self-tests', () => {
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
  // The reviewer's case: a file of 1 September next to the board index of 14 October.
  const old = fixtureTree(full), stale = make(); stale.generated_at = '2026-09-01T12:00:00Z';
  fs.writeFileSync(old.target, JSON.stringify(stale));
  const foreign = run('--check', '--v1-dir', old.v1Dir);
  assert.equal(foreign.status, 1);
  assert.match(foreign.stderr, /Generation mismatch/);
  fs.rmSync(path.join(old.v1Dir, 'index.json'));
  assert.equal(run('--check', '--v1-dir', old.v1Dir).status, 1);
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
