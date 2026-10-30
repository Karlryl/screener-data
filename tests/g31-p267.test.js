'use strict';
// P267 findings on PR #12 (G31 switch, Karl 11.10.2026): the GP/badge period travels with its value from
// overviewMetric through the score output into the writer and is checked against the writer's own re-derivation;
// explicit statement durations (6M/6M half years, 6M/3M conflicts); the PGHL.BO release on the selected GP
// candidate; the Prüfhinweis field (g31Hinweis, master decision 18.10.2026); the 000599.SZ hold rows (P268).
// Real excerpts: tests/fixtures/g31-switch/cases.json and tests/fixtures/financial-known-cases.json (17.10.2026).
// Every red probe changes memory or test data only; live files are hashed before and after.
// Run: node tests/g31-p267.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Module, createRequire } = require('node:module');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'g31-p267-'));
process.env.FINDASH_SNAPSHOTS_DIR = path.join(tmp, 'snapshots');
process.env.FINDASH_SMALLCAP_SNAPSHOTS_DIR = path.join(tmp, 'snapshots-smallcap');
fs.mkdirSync(process.env.FINDASH_SNAPSHOTS_DIR); fs.mkdirSync(process.env.FINDASH_SMALLCAP_SNAPSHOTS_DIR);

const ROOT = path.resolve(__dirname, '..');
const G = require('../lib/g31-recency.js');
const axes = require('../src/scoring/axes.js');
const { revGrowthLeg } = require('../lib/rev-growth-basis.js');
const { overviewMetric, overviewShadow } = require('../src/scoring/overview.js');
const { produceRankings } = require('../src/scoring/score.js');
const { overviewGrowthHold } = require('../lib/overview-known-cases.js');
const { applyFinancialCases, financialReasons, validateTable, table } = require('../lib/financial-known-cases.js');
const W = require('../scripts/write-findash-export.js');
const { safeSnapshotFilename } = require('../lib/snapshot-fs.js');
const g31 = require('./fixtures/g31-switch/cases.json');
const shared = require('./fixtures/financial-known-cases.json').snapshots;

const LIVE = ['lib/g31-recency.js', 'scripts/write-findash-export.js', 'configs/financial-known-cases.json',
  'configs/g31-hinweise.json', 'tests/fixtures/financial-known-cases.json'];
const liveHashes = () => LIVE.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex'));
const before = liveHashes();
const real = ticker => structuredClone(g31.cases.find(c => c.ticker === ticker).snapshot);
const v = cell => (cell && typeof cell === 'object' ? cell.value : cell);
const round3 = x => Math.round(x * 1000) / 1000;
const legacy = fn => G.withG31Variant('legacy', fn);
const ENDS = ['2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'];
const UNCONFIRMED = /^Zeitraum nicht bestätigt: /;
const writeSnap = s => fs.writeFileSync(path.join(process.env.FINDASH_SNAPSHOTS_DIR, safeSnapshotFilename(s.meta.ticker)), JSON.stringify(s));
const compile = (file, source, overrides = {}) => {
  const m = new Module(file, module), req = createRequire(file); m.filename = file; m.paths = module.paths;
  m.require = id => (Object.hasOwn(overrides, id) ? overrides[id] : req(id)); m._compile(source, file); return m.exports;
};

// DAVE (17.10.2026): GP quarter 30.06.2026 against 30.06.2025 = 0.299, legacy fiscal year = 0.704.
const dave = real('DAVE'); dave.meta.ticker = '_P267_DAVE'; writeSnap(dave);
const engineRow = overview => produceRankings([{ ticker: dave.meta.ticker, action: 'route', formulaId: 'software-comm-services',
  track: 'profitable', score: 70, revGrowthYoYPct: axes.revGrowthLevel(dave), overview }]).branches['software-comm-services'].profitable[0];

test('GP period travels with its value: overviewMetric -> score output -> both writer shapes (positive case)', () => {
  const metric = overviewMetric(dave);
  assert.deepEqual(metric.period, { basis: 'quarter', periodEnd: '2026-06-30', priorPeriodEnd: '2025-06-30', reason: null });
  const ranked = engineRow(metric);
  assert.deepEqual(ranked.overview.period, metric.period, 'score output keeps the period next to the rounded value');
  const row = W.mapBoardRow(ranked, 0, 'main');
  assert.equal(row.overview.value, 0.299);
  assert.deepEqual(row.overviewPeriod, metric.period);
  assert.deepEqual([row.revGrowthBasis, row.revGrowthPeriodEnd], [revGrowthLeg(dave).basis, revGrowthLeg(dave).periodEnd], 'revenue label matches');
  // Legacy comparison: the old fiscal-year value with its own period, never the revenue period.
  assert.equal(row.overviewValueLegacy, 0.704);
  assert.deepEqual(row.overviewPeriodLegacy, { basis: 'year', periodEnd: dave.annual.annualGPEnds[0], priorPeriodEnd: dave.annual.annualGPEnds[1], reason: null });
  const errs = []; W.validateBoardRow(row, row.ticker, errs);
  assert.deepEqual(errs.filter(e => /overviewPeriod/.test(e)), []);
});

test('mismatched GP value and period: the label is emptied with its reason; revenue keeps its label (P267 repro)', () => {
  // Codex repro: GP 0.704 (another input state) arriving with the quarter period of 30.06.2026 (true value 0.299).
  const quarterPeriod = overviewMetric(dave).period;
  for (const overview of [{ kind: 'gp', value: 0.704, companion: 1, period: quarterPeriod },
    { ...legacy(() => overviewMetric(dave)) }]) {
    const row = W.mapBoardRow(engineRow(overview), 0, 'main');
    assert.equal(row.overview.value, 0.704, 'the value itself is not touched');
    assert.equal(row.overviewPeriod.basis, 'none'); assert.equal(row.overviewPeriod.periodEnd, null);
    assert.match(row.overviewPeriod.reason, UNCONFIRMED);
    assert.equal(row.overviewValueLegacy, null, 'no comparison for an unreproduced value');
    assert.equal(row.revGrowthBasis, revGrowthLeg(dave).basis, 'revenue label unaffected');
  }
  // Same value, other period (basis or end): also not confirmed.
  const otherEnd = { ...quarterPeriod, periodEnd: '2026-03-31' };
  assert.match(W.mapBoardRow(engineRow({ kind: 'gp', value: 0.299, companion: 1, period: otherEnd }), 0, 'main').overviewPeriod.reason, UNCONFIRMED);
  // A row from a calculation without period gets an empty label with its reason, never a borrowed one.
  const bare = W.mapBoardRow(engineRow({ kind: 'gp', value: 0.299, companion: 1 }), 0, 'main');
  assert.equal(bare.overviewPeriod.basis, 'none'); assert.ok(bare.overviewPeriod.reason);
  // Break-once in memory: without the re-derivation check the wrong pairing is exported again.
  const wfile = path.join(ROOT, 'scripts/write-findash-export.js'), ws = fs.readFileSync(wfile, 'utf8');
  const anchor = "      if (label && label.basis !== 'none' && derivations.wachstum && again?.period\n";
  const eol = ws.includes('\r\n') ? '\r\n' : '\n';
  assert.equal(ws.split(anchor.replace('\n', eol)).length, 2, 'exact unique anchor');
  const broken = compile(wfile, ws.replace(anchor.replace('\n', eol), '      if (false' + eol));
  const wrong = broken.mapBoardRow(engineRow({ kind: 'gp', value: 0.704, companion: 1, period: quarterPeriod }), 0, 'main');
  assert.throws(() => assert.match(wrong.overviewPeriod.reason ?? '', UNCONFIRMED), assert.AssertionError);
});

test('a held overview value keeps no label, comparison or shadow value (no shadow refills a held field)', () => {
  const s = real('DAVE'); s.meta.ticker = 'PGHL.BO'; // the hold table is keyed by listing; DAVE data, PGHL hold
  s.annual.annualGPEnds = s.annual.annualGPEnds.map(() => null);
  s.timeseries.grossProfitQEnds = s.timeseries.grossProfitQEnds.map(() => null);
  writeSnap(s);
  const metric = overviewMetric(s);
  const ranked = produceRankings([{ ticker: 'PGHL.BO', action: 'route', formulaId: 'health-care', track: 'profitable', score: 70,
    revGrowthYoYPct: axes.revGrowthLevel(s), overview: { ...metric, value: 0.282 } }]).branches['health-care'].profitable[0];
  const row = W.mapBoardRow(ranked, 0, 'main');
  assert.equal(row.overview.value, null);
  assert.deepEqual([row.overviewPeriod.basis, row.overviewPeriod.periodEnd], ['none', null]); assert.ok(row.overviewPeriod.reason);
  assert.equal(row.overviewValueLegacy, null); assert.equal(row.overviewPeriodLegacy, null);
  assert.equal(row.g31OverviewShadow.value, null);
});

test('PGHL.BO: a dated GP quarter releases the hold (9.291113381 % on 17.10.); the undated control stays held', () => {
  const pghl = (quarters) => {
    const s = { meta: { ticker: 'PGHL.BO', reportingCurrency: 'INR' },
      annual: { annualGP: [102803557.8744, 80220863.8, 84776783.76619999, 75525338.6942].map(value => ({ value })), annualGPEnds: [null, null, null, null] } };
    if (quarters) s.timeseries = { grossProfitQ: [28150174.1427, 27000000, 26500000, 26000000, 25757056.7925].map(value => ({ value })), grossProfitQEnds: [...ENDS] };
    return s;
  };
  const q = pghl(true), metric = overviewMetric(q);
  assert.equal((metric.value * 100).toFixed(9), '9.291113381');
  assert.deepEqual([metric.period.basis, metric.period.periodEnd, metric.period.priorPeriodEnd], ['quarter', '2026-06-30', '2025-06-30']);
  const released = overviewGrowthHold('PGHL.BO', q);
  assert.equal(released.expectedValue, 0.093, 'released exactly when the export shows the rounded selected candidate');
  // Undated control: the old annual pair (non-adjacent, ends missing) never becomes a released growth figure.
  const undated = pghl(false), hold = overviewGrowthHold('PGHL.BO', undated);
  assert.equal(hold.expectedValue, undefined); assert.ok(hold.reason);
  assert.equal(require('../configs/overview-known-cases.json').cases.find(c => c.ticker === 'PGHL.BO').releaseWhen, 'selected-gp-candidate-matches-export');
});

// ---- statement durations (P170 step 1) ----
const durationSnap = (field, durations, over = {}) => {
  const values = field === 'revenueQ' ? [120, 110, 105, 100, 100] : [60, 55, 52, 50, 50];
  const s = { meta: { ticker: '_P267_DUR', statementPeriods: {} },
    annual: { annualRev: [150, 100], annualRevEnds: ['2025-12-31', '2024-12-31'], annualGP: [75, 50], annualGPEnds: ['2025-12-31', '2024-12-31'] },
    timeseries: { [field]: values, [field + 'Ends']: [...ENDS] } };
  if (durations) s.meta.statementPeriods[field] = durations.map((duration, i) => duration && { end: ENDS[i], duration, currency: 'USD' });
  return Object.assign(s, over);
};
const legOf = (field, s) => field === 'revenueQ' ? G.g31Shadow(s).v1 : overviewShadow(s, 'gp').period;

test('durations: 3M/3M quarter, 6M/6M half year, 6M/3M no pair, unassignable metadata ignored (revenue and GP)', () => {
  for (const field of ['revenueQ', 'grossProfitQ']) {
    const q = legOf(field, durationSnap(field, ['3M', '3M', '3M', '3M', '3M']));
    assert.deepEqual([q.basis, q.periodEnd, q.label], ['quarter', '2026-06-30', 'Quartal bis 30.06.2026'], field);
    const h = legOf(field, durationSnap(field, ['6M', '6M', '6M', '6M', '6M']));
    assert.deepEqual([h.basis, h.periodEnd, h.label], ['halfYear', '2026-06-30', 'Halbjahr bis 30.06.2026'], field);
    // Explicitly different lengths: no interim pair; the fiscal year carries, labelled as such.
    const mixed = durationSnap(field, ['6M', '3M', '3M', '3M', '3M']);
    assert.match(G.quarterCandidate(mixed, field).reason, /unterschiedlich lange Zeiträume/, field);
    assert.equal(legOf(field, mixed).basis, 'year', field);
    // Unknown duration on one side is no proven conflict and is never invented.
    // P267-r3: one 6M next to an unknown duration is no proven half-year pair, in either direction; the year carries.
    for (const d of [['6M', null, null, null, null], [null, null, null, null, '6M']]) {
      assert.match(G.quarterCandidate(durationSnap(field, d), field).reason, /Halbjahresvergleich ist nicht belegt/, field);
      assert.equal(legOf(field, durationSnap(field, d)).basis, 'year', field + ' ' + JSON.stringify(d));
    }
    assert.equal(legOf(field, durationSnap(field, ['3M', null, null, null, null])).basis, 'quarter', field + ': 3M next to unknown stays a quarter');
    assert.equal(legOf(field, durationSnap(field, [null, null, null, null, null])).basis, 'quarter', field);
    // Metadata of another length or with another end cannot be assigned: ignored, quarter as before.
    const short = durationSnap(field, ['6M', '3M', '3M', '3M']);
    assert.equal(legOf(field, short).basis, 'quarter', field + ': list shorter than the series');
    const shifted = durationSnap(field, ['6M', '3M', '3M', '3M', '3M']);
    shifted.meta.statementPeriods[field][0].end = '2026-05-31';
    assert.equal(legOf(field, shifted).basis, 'quarter', field + ': end differs from the source end');
    // A 12M interim cell is neither a quarter nor a half year.
    assert.equal(G.quarterCandidate(durationSnap(field, ['12M', '12M', '3M', '3M', '12M']), field).pct, null, field);
  }
  // The half-year label reaches the export basis and its validator.
  const h = durationSnap('revenueQ', ['6M', '6M', '6M', '6M', '6M']);
  assert.equal(revGrowthLeg(h).basis, 'halfYear'); assert.equal(axes.revGrowthLevel(h), revGrowthLeg(h).pct); assert.ok(Math.abs(revGrowthLeg(h).pct - 20) < 1e-9);
  const errs = []; W.checkRevGrowthBasis({ revGrowthYoYPct: 20, revGrowthBasis: 'halfYear', revGrowthPeriodEnd: '2026-06-30', revGrowthPriorPeriodEnd: '2025-06-30' }, 'row', errs);
  assert.deepEqual(errs, []);
  // Break-once in memory: without the duration conflict line a 3M quarter against a 12M year-ago cell is a quarter again.
  const gfile = path.join(ROOT, 'lib/g31-recency.js'), gs = fs.readFileSync(gfile, 'utf8');
  const anchor = "  if (durations[0] && durations[1] && durations[0] !== durations[1]) return missing('Die beiden Werte umfassen unterschiedlich lange Zeiträume.');";
  assert.equal(gs.split(anchor).length, 2, 'exact unique anchor');
  assert.equal(G.quarterCandidate(durationSnap('revenueQ', ['3M', '3M', '3M', '3M', '12M'])).pct, null);
  const broken = compile(gfile, gs.replace(anchor, ''));
  assert.throws(() => assert.equal(broken.quarterCandidate(durationSnap('revenueQ', ['3M', '3M', '3M', '3M', '12M'])).pct, null), assert.AssertionError);
  // Break-once (P267-r3): without the half-year line one 6M next to an unknown duration is labelled a half year again.
  const half = "  if ((durations[0] === '6M') !== (durations[1] === '6M')) return missing('Die Dauer eines der beiden Werte ist nicht gespeichert; ein Halbjahresvergleich ist nicht belegt.');";
  assert.equal(gs.split(half).length, 2, 'exact unique anchor');
  const brokenHalf = compile(gfile, gs.replace(half, ''));
  assert.throws(() => assert.equal(brokenHalf.quarterCandidate(durationSnap('revenueQ', ['6M', null, null, null, null])).pct, null), assert.AssertionError);
});

// ---- Prüfhinweis (master decision 18.10.2026: no blanket size filter, a hint shown with the value) ----
test('g31Hinweis: checked P268 entry for SAUD3.SA; diagnosis flags; absent on ordinary or unreproduced rows', () => {
  const saud = real('SAUD3.SA'), leg = G.g31Shadow(saud).v1;
  assert.deepEqual([leg.basis, leg.sourcePeriodEnd, leg.sourcePriorPeriodEnd], ['quarter', '2026-06-30', '2025-06-30']);
  const hint = G.g31Hinweis(saud);
  assert.equal(hint.code, 'uebernahme'); assert.match(hint.reason, /Bradesco/);
  // The same pair under another listing: no checked entry, the diagnosis speaks (newest quarter > 75 % of the year).
  const other = structuredClone(saud); other.meta.ticker = '_P267_SAUD';
  const diag = G.g31Hinweis(other);
  assert.match(diag.code, /aktuell-gross/); assert.match(diag.reason, /nicht gesperrt und nicht gegen den Firmenbericht geprüft/);
  // The checked entry lapses by itself once a newer quarter is the shown pair.
  const newer = structuredClone(saud);
  newer.timeseries.revenueQ.unshift({ value: v(saud.timeseries.revenueQ[0]) * 1.02 });
  newer.timeseries.revenueQEnds.unshift('2026-09-30');
  newer.timeseries.revenueQ.splice(5, 0, { value: v(saud.timeseries.revenueQ[0]) });
  newer.timeseries.revenueQEnds.splice(5, 0, '2025-09-30');
  assert.notEqual(G.g31Hinweis(newer)?.code, 'uebernahme');
  // Ordinary B1-free quarter pair and the fiscal-year fallback: no hint, the value is never changed by a hint.
  assert.equal(G.g31Hinweis(durationSnap('revenueQ', null)), null);
  assert.equal(G.g31Hinweis(real('PENG')), null);
  assert.equal(axes.revGrowthLevel(other), axes.revGrowthLevel(saud));
  // Writer: the hint stands only where the snapshot reproduces the shown growth.
  const s = real('SAUD3.SA'); s.meta.ticker = 'SAUD3.SA'; writeSnap(s);
  const row = { ticker: 'SAUD3.SA', score: 60, revGrowthYoYPct: axes.revGrowthLevel(s), overview: overviewMetric(s) };
  assert.equal(W.mapBoardRow(row, 0, 'main').g31Hinweis.code, 'uebernahme');
  assert.equal(W.mapBoardRow({ ...row, ticker: 'SAUD3.SA', revGrowthYoYPct: 12.5 }, 1, 'main').g31Hinweis, null);
});

test('hint table: every entry carries listing, exact ends, code, reason and quoted source; malformed tables fail loudly', () => {
  const t = require('../configs/g31-hinweise.json');
  assert.equal(G.loadHinweisTable(t).length, 12); // SEC comparison 30.10.2026 adds the FTW takeover hint; // 24.10.2026 adds the 300277.SZ merger hint (lane sd-umsatzreihen); the triage of 24.10.2026 five hints (603991.SS, JOBY for the June and the September quarter, QUBT, 000656.SZ).
  assert.deepEqual(t.entries.map(e => e.ticker).sort(), ['000656.SZ', '002289.SZ', '002993.SZ', '300277.SZ', '603991.SS', '688507.SS', 'FTW', 'JOBY', 'JOBY', 'QUBT', 'RHLD', 'SAUD3.SA']);
  assert.ok(!t.entries.some(e => e.ticker === '000599.SZ'), '000599.SZ is a wrong value: hand table, not a hint');
  for (const bad of [e => { e.periodEnd = '2026-02-30'; }, e => { e.code = 'sperre'; }, e => { e.sources = []; },
    e => { e.sources[0].quote = ''; }, e => { e.reason = ''; }]) {
    const copy = structuredClone(t); bad(copy.entries[0]);
    assert.throws(() => G.loadHinweisTable(copy), /Invalid G31 hint/);
  }
  const dup = structuredClone(t); dup.entries.push(structuredClone(dup.entries[0]));
  assert.throws(() => G.loadHinweisTable(dup), /Invalid G31 hint entry/);
});

// ---- 000599.SZ (P268: unrestated Q2 2025 next to restated Q1 2025) ----
const P268 = ['revenueQ', 'grossProfitQ', 'opIncQ'].map(field => `000599.sz-2025-06-30-${field}-20261018-g31`);
const raw599 = shared['000599.SZ'];
const cellAt = (s, field) => s.timeseries[field][s.timeseries[field + 'Ends'].indexOf('2025-06-30')];

test('000599.SZ guard: the three unrestated Q2 2025 cells are withheld; the restated pairs and other cells stay', () => {
  const out = applyFinancialCases(structuredClone(raw599)).snapshot;
  for (const [i, field] of ['revenueQ', 'grossProfitQ', 'opIncQ'].entries()) {
    const cell = cellAt(out, field);
    assert.equal(v(cell), null, field); assert.equal(cell.financialCorrection.caseId, P268[i], field + ': own reason marker');
    for (const [k, end] of raw599.timeseries[field + 'Ends'].entries()) {
      if (end !== '2025-06-30') assert.equal(v(out.timeseries[field][k]), v(raw599.timeseries[field][k]), field + ' ' + end);
    }
  }
  // Before: +533 % from 7,199.8 against the unrestated 1,136.8 Mio. CNY; after: no mixed pair, the fiscal year carries.
  assert.equal(axes.revGrowthLevel(raw599).toFixed(2), '533.32');
  const leg = revGrowthLeg(out);
  assert.deepEqual([leg.basis, leg.periodEnd], ['year', '2025-12-31']);
  assert.ok(financialReasons(out).some(r => /Kumho Tire/.test(r)));
  // Evidence binding: every row cites the 2026 half-year and first-quarter reports with their restated columns.
  for (const id of P268) {
    const c = table.cases.find(x => x.caseId === id);
    assert.deepEqual(c.sources.map(src => src.published), ['2026-08-14', '2026-04-29'], id);
    assert.match(c.sources[0].quote, /14,467,085,467\.59/); assert.match(c.sources[1].quote, /7,096,759,116\.51/);
  }
});

test('000599.SZ guard absent: another listing or a changed vendor value is not held; break-once on test data only', () => {
  const other = structuredClone(raw599); other.meta.ticker = '_P267_599';
  assert.equal(v(cellAt(applyFinancialCases(other).snapshot, 'revenueQ')), v(cellAt(raw599, 'revenueQ')));
  // Without the P268 rows (in-memory table copy) the +533 % pair is shown again: the guard sees it.
  const copy = structuredClone(table); copy.cases = copy.cases.filter(c => !P268.includes(c.caseId));
  const unguarded = applyFinancialCases(structuredClone(raw599), { table: validateTable(copy) }).snapshot;
  assert.throws(() => assert.equal(v(cellAt(unguarded, 'revenueQ')), null), assert.AssertionError);
  assert.equal(axes.revGrowthLevel(unguarded).toFixed(2), '533.32');
  assert.deepEqual(liveHashes(), before);
});

// ---- P267 round 2 ----
test('r2 P2-1: Rule of 40 keeps a held GP value held, including its shadow (main writer and Rule40 row builder)', () => {
  const s = real('DAVE'); s.meta.ticker = 'PGHL.BO';
  s.annual.annualGPEnds = s.annual.annualGPEnds.map(() => null);
  s.timeseries.grossProfitQEnds = s.timeseries.grossProfitQEnds.map(() => null);
  writeSnap(s);
  const ranked = produceRankings([{ ticker: 'PGHL.BO', action: 'route', formulaId: 'health-care', track: 'profitable', score: 70,
    revGrowthYoYPct: axes.revGrowthLevel(s), overview: { ...overviewMetric(s), value: 0.282 } }]).branches['health-care'].profitable[0];
  const row = W.mapBoardRow(ranked, 0, 'main');
  assert.equal(row.g31OverviewShadow.value, null);
  const unheld = G.g31Export(s);
  assert.ok(Number.isFinite(unheld.g31Overview.gp.value), 'the own derivation alone would show a value');
  const { baueZeilen } = require('../scripts/write-rule40-export.js');
  const out = baueZeilen([{ ticker: 'PGHL.BO', row, onBoard: true, branch: 'health-care', wachstumRoh: 30, fcfMarginPct: 30,
    ebitdaMarginPct: null, marketCap: 1e10, industry: 'Biotechnology', ...unheld }]).rows[0];
  assert.equal(out.overviewValue, null);
  assert.equal(out.overviewPeriod.basis, 'none'); assert.equal(out.overviewValueLegacy, null); assert.equal(out.overviewPeriodLegacy, null);
  assert.equal(out.g31OverviewShadow.value, null, 'the held shadow is not refilled');
  // Break-once in memory: the old assignment re-inserts the held shadow value.
  const rfile = path.join(ROOT, 'scripts/write-rule40-export.js'), rs = fs.readFileSync(rfile, 'utf8');
  const anchor = "k.onBoard && 'g31OverviewShadow' in row ? row.g31OverviewShadow : k.g31Overview?.[ov.kind] ?? null;";
  assert.equal(rs.split(anchor).length, 2, 'exact unique anchor');
  const broken = compile(rfile, rs.replace(anchor, 'k.g31Overview?.[ov.kind] ?? null;'));
  const bad = broken.baueZeilen([{ ticker: 'PGHL.BO', row, onBoard: true, branch: 'health-care', wachstumRoh: 30, fcfMarginPct: 30,
    ebitdaMarginPct: null, marketCap: 1e10, industry: 'Biotechnology', ...unheld }]).rows[0];
  assert.throws(() => assert.equal(bad.g31OverviewShadow.value, null), assert.AssertionError);
});

test('r2 P2-2: a wrong prior-year end alone empties the label (and the validator accepts the emptied label)', () => {
  const p = overviewMetric(dave).period;
  const row = W.mapBoardRow(engineRow({ kind: 'gp', value: 0.299, companion: 1, period: { ...p, priorPeriodEnd: '2024-06-30' } }), 0, 'main');
  assert.equal(row.overviewPeriod.basis, 'none'); assert.equal(row.overviewPeriod.priorPeriodEnd, null);
  assert.match(row.overviewPeriod.reason, UNCONFIRMED);
  const errs = []; W.checkOverviewPeriods(row, 'row', errs); assert.deepEqual(errs, []);
  assert.deepEqual(W.mapBoardRow(engineRow({ kind: 'gp', value: 0.299, companion: 1, period: p }), 0, 'main').overviewPeriod, p, 'control');
});

test('r2 P2-3: in the legacy arm the label is checked against the legacy candidate (DAVE year 0.704 kept)', () => {
  const s = real('DAVE'); s.meta.ticker = '_P267_DAVE_LEG'; writeSnap(s);
  const row = legacy(() => {
    const metric = overviewMetric(s);
    assert.equal(metric.value, s.annual.annualGP.map(v)[0] / s.annual.annualGP.map(v)[1] - 1);
    const ranked = produceRankings([{ ticker: s.meta.ticker, action: 'route', formulaId: 'software-comm-services', track: 'profitable',
      score: 70, revGrowthYoYPct: axes.revGrowthLevel(s), overview: metric }]).branches['software-comm-services'].profitable[0];
    return W.mapBoardRow(ranked, 0, 'main');
  });
  assert.equal(row.overview.value, 0.704);
  assert.deepEqual([row.overviewPeriod.basis, row.overviewPeriod.periodEnd, row.overviewPeriod.reason], ['year', s.annual.annualGPEnds[0], null]);
  // v1 arm on the same data keeps its quarter label (first test); both correct labels survive.
  assert.equal(W.mapBoardRow(engineRow(overviewMetric(dave)), 0, 'main').overviewPeriod.basis, 'quarter');
});

// ---- P267 round 3: the writer's derivation cache follows the active arm ----
test('r3 P2-3: one writer instance switching arms keeps both labels and comparisons (v1-legacy-v1, legacy-v1-legacy)', () => {
  const ends = dave.annual.annualGPEnds;
  const expect = {
    v1: { value: 0.299, period: { basis: 'quarter', periodEnd: '2026-06-30', priorPeriodEnd: '2025-06-30', reason: null } },
    legacy: { value: 0.704, period: { basis: 'year', periodEnd: ends[0], priorPeriodEnd: ends[1], reason: null } },
  };
  const step = (writer, arm) => {
    const run = () => writer.mapBoardRow(engineRow(overviewMetric(dave)), 0, 'main');
    const row = arm === 'v1' ? run() : legacy(run);
    assert.equal(row.overview.value, expect[arm].value, arm);
    assert.deepEqual(row.overviewPeriod, expect[arm].period, arm + ': label of exactly this value');
    assert.equal(row.overviewValueLegacy, 0.704, arm + ': comparison value kept');
    assert.deepEqual([row.overviewPeriodLegacy?.basis, row.overviewPeriodLegacy?.periodEnd], ['year', ends[0]], arm);
  };
  const wfile = path.join(ROOT, 'scripts/write-findash-export.js'), ws = fs.readFileSync(wfile, 'utf8');
  const fresh = () => compile(wfile, ws);
  const a = fresh(); for (const arm of ['v1', 'legacy', 'v1']) step(a, arm);
  const b = fresh(); for (const arm of ['legacy', 'v1', 'legacy']) step(b, arm);
  // Break-once in memory: a cache key without the arm mixes the arms again.
  const anchor = "  const cacheKey = `${snapshotDir}:${ticker}:${g31Variant() ?? 'legacy'}`;";
  assert.equal(ws.split(anchor).length, 2, 'exact unique anchor');
  const broken = compile(wfile, ws.replace(anchor, '  const cacheKey = `${snapshotDir}:${ticker}`;'));
  step(broken, 'v1');
  assert.throws(() => step(broken, 'legacy'), assert.AssertionError);
});

test.after(() => { assert.deepEqual(liveHashes(), before); fs.rmSync(tmp, { recursive: true, force: true }); });
