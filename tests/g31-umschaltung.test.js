'use strict';
// G31 switch (Karl 11.10.2026, built 18.10.2026): production shows per firm the newest reported growth
// with its period. Checks required by P170 plan "Required checks", on prepared-snapshot excerpts of the
// real P170 example tickers (tests/fixtures/g31-switch/cases.json, 17.10.2026 replay data) and on
// synthetic edge cases. The legacy arm (withG31Variant('legacy', ...)) is the pre-G31 calculation that
// feeds the *Legacy comparison fields. Run: node tests/g31-umschaltung.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Module, createRequire } = require('node:module');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'g31-switch-'));
process.env.FINDASH_SNAPSHOTS_DIR = path.join(tmp, 'snapshots');
process.env.FINDASH_SMALLCAP_SNAPSHOTS_DIR = path.join(tmp, 'snapshots-smallcap');
fs.mkdirSync(process.env.FINDASH_SNAPSHOTS_DIR); fs.mkdirSync(process.env.FINDASH_SMALLCAP_SNAPSHOTS_DIR);

const G = require('../lib/g31-recency.js');
const axes = require('../src/scoring/axes.js');
const { revGrowthLeg } = require('../lib/rev-growth-basis.js');
const { overviewMetric, overviewShadow, OVERVIEW_YEARS_NOT_ADJACENT_TEXT } = require('../src/scoring/overview.js');
const { produceRankings, robustG } = require('../src/scoring/score.js');
const W = require('../scripts/write-findash-export.js');
const { safeSnapshotFilename } = require('../lib/snapshot-fs.js');
const { jahresVergleichIdx } = require('../src/scoring/snapshot.js');
const fixture = require('./fixtures/g31-switch/cases.json');

const real = ticker => structuredClone(fixture.cases.find(c => c.ticker === ticker).snapshot);
const v = cell => (cell && typeof cell === 'object' ? cell.value : cell);
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ''} ${a} != ${b}`);
const legacy = fn => G.withG31Variant('legacy', fn);
const ENDS = ['2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'];
const synth = (over = {}) => ({ meta: { ticker: '_G31_' }, annual: { annualRev: [150, 100], annualRevEnds: ['2025-12-31', '2024-12-31'] },
  timeseries: { revenueQ: [120, 110, 105, 100, 100], revenueQEnds: [...ENDS] }, ...over });

test('production arm is v1; the legacy arm is the only way back to the pre-G31 calculation', () => {
  assert.equal(G.g31Variant(), 'v1');
  assert.equal(legacy(() => G.g31Variant()), null);
  assert.equal(G.g31Variant(), 'v1');
});

test('B2/B3 real cases PENG, MU, 5292.KL, COST: the later validated fiscal year wins and feeds the bonus', () => {
  for (const ticker of ['PENG', 'MU', '5292.KL', 'COST']) {
    const s = real(ticker), n = s.meta.annualRevNewerYear;
    const q = s.timeseries.revenueQ.map(v), qEnd = s.timeseries.revenueQEnds[0];
    assert.ok(n.end > qEnd, ticker + ': the recorded fiscal year ends after the newest quarter');
    const leg = revGrowthLeg(s);
    assert.deepEqual([leg.basis, leg.periodEnd, leg.priorPeriodEnd], ['yearNewerRecord', n.end, n.priorEnd], ticker);
    assert.equal(leg.pct, (n.revenue / n.priorRevenue - 1) * 100, ticker);
    assert.equal(axes.revGrowthLevel(s), leg.pct, ticker + ': scored/displayed growth = labelled leg');
    // B3: the annual bonus component is the validated newer year even though a quarter exists.
    assert.deepEqual(axes.revYoYComponents(s), [n.revenue / n.priorRevenue - 1, q[0] / q[4] - 1], ticker);
    // Legacy: the quarter carried the level, the older stored year the bonus.
    const a = s.annual.annualRev.map(v);
    assert.equal(legacy(() => axes.revGrowthLevel(s)), (q[0] / q[4] - 1) * 100, ticker);
    assert.deepEqual(legacy(() => axes.revYoYComponents(s)), [a[0] / a[1] - 1, q[0] / q[4] - 1], ticker);
  }
  // COST newer-annual bonus example: 8.17 % (FY2025) -> 10.14 % (FY2026) in the annual component.
  const cost = real('COST');
  close(legacy(() => axes.revYoYComponents(cost))[0] * 100, 8.167323631476142);
  close(axes.revYoYComponents(cost)[0] * 100, 10.143695387577889);
  assert.ok(robustG(cost) !== legacy(() => robustG(cost)));
});

test('equal ends keep the quarter; misaligned or invalid end arrays never date a pair', () => {
  const s = real('PENG');
  s.meta.annualRevNewerYear.end = s.timeseries.revenueQEnds[0];
  assert.equal(revGrowthLeg(s).basis, 'quarter', 'equal end keeps the quarter');
  const later = synth({ annual: { annualRev: [150, 100], annualRevEnds: ['2026-09-30', '2025-09-30'] } });
  assert.equal(revGrowthLeg(later).basis, 'year', 'a later plain fiscal year wins as well');
  for (const annualRevEnds of [['2026-09-30'], ['2026-02-30', '2025-09-30'], ['garbage', '2025-09-30']]) {
    const bad = synth({ annual: { annualRev: [150, 100], annualRevEnds } });
    assert.equal(revGrowthLeg(bad).basis, 'quarter', JSON.stringify(annualRevEnds) + ': an undated year cannot be later');
  }
  const misQ = synth(); misQ.timeseries.revenueQEnds = ENDS.slice(0, 4);
  assert.equal(revGrowthLeg(misQ).periodEnd, null, 'misaligned quarter ends: positional pair, period unknown');
});

test('non-adjacent annual pair, missing prior-year denominator, zero versus absence', () => {
  const gap = synth({ annual: { annualRev: [150, null, 100], annualRevEnds: ['2025-12-31', '2024-12-31', '2023-12-31'] } });
  assert.equal(revGrowthLeg(gap).basis, 'quarter', 'a non-adjacent year is no candidate; the quarter carries');
  gap.timeseries = {};
  assert.deepEqual([revGrowthLeg(gap).basis, axes.revGrowthLevel(gap)], ['none', null], 'never a two-year change as annual growth');
  for (const prior of [null, 0, -5]) {
    const s = synth(); s.timeseries.revenueQ[4] = prior;
    assert.equal(revGrowthLeg(s).basis, 'year', String(prior));
  }
  const zero = synth(); zero.timeseries.revenueQ[0] = 0;
  assert.equal(axes.revGrowthLevel(zero), -100, 'reported zero is -100 %, present');
  const absent = synth(); absent.timeseries.revenueQ[0] = null;
  assert.equal(revGrowthLeg(absent).basis, 'year', 'absence is not zero');
});

test('B1 real cases SAUD3.SA and CBDK.JK: the dated pair across an empty row equals its missing-row twin', () => {
  for (const ticker of ['SAUD3.SA', 'CBDK.JK']) {
    const s = real(ticker), q = s.timeseries.revenueQ.map(v);
    const hole = q.findIndex((x, i) => i > 0 && x === null);
    assert.ok(hole > 0, ticker + ': fixture carries an empty intermediate quarter');
    const twin = structuredClone(s);
    twin.timeseries.revenueQ.splice(hole, 1); twin.timeseries.revenueQEnds.splice(hole, 1);
    const leg = revGrowthLeg(s);
    assert.deepEqual(leg, revGrowthLeg(twin), ticker);
    assert.deepEqual([leg.basis, leg.periodEnd, leg.priorPeriodEnd], ['quarter', '2026-06-30', '2025-06-30'], ticker);
    assert.equal(legacy(() => revGrowthLeg(s)).basis, 'year', ticker + ': legacy fell back to the year');
    const undated = structuredClone(s); delete undated.timeseries.revenueQEnds;
    assert.notEqual(revGrowthLeg(undated).basis, 'quarter', ticker + ': the undated pair keeps the gap guard');
  }
  // SAUD3.SA is reported as flagged in the PR (newest quarter larger than the whole last fiscal year).
  const saud = real('SAUD3.SA');
  assert.ok(v(saud.timeseries.revenueQ[0]) > v(saud.annual.annualRev[0]));
});

test('B4 real cases DAVE, 2059.TW, 5475.TWO: GP shows the newest dated quarter with exact fraction and label', () => {
  for (const [ticker, legacyPct] of [['DAVE', 70.4], ['2059.TW', 90.1], ['5475.TWO', 1009.0]]) {
    const s = real(ticker), gp = s.timeseries.grossProfitQ.map(v), a = s.annual.annualGP.map(v);
    const metric = overviewMetric(s), shadow = overviewShadow(s, 'gp');
    const prior = jahresVergleichIdx(s, 'grossProfitQ', 0).idx; // dated year-ago partner (2059.TW: position 3)
    close(metric.value, gp[0] / gp[prior] - 1, ticker + ': the quarter fraction itself');
    close(metric.value * 100, G.quarterCandidate(s, 'grossProfitQ').pct, ticker + ': fraction x 100 = percent');
    assert.deepEqual([shadow.period.basis, shadow.period.periodEnd, shadow.period.priorPeriodEnd], ['quarter', '2026-06-30', '2025-06-30'], ticker);
    assert.equal(shadow.period.label, 'Quartal bis 30.06.2026');
    const old = legacy(() => overviewMetric(s)).value;
    assert.equal(old, a[0] / a[1] - 1, ticker + ': legacy annual GP');
    assert.equal(Math.round(old * 1000) / 10, legacyPct, ticker);
  }
});

test('B4 edges: negative latest GP stays valid; absent/nonpositive prior and bad dates never form a quarter pair', () => {
  const base = () => ({ annual: { annualGP: [60, 50], annualGPEnds: ['2025-12-31', '2024-12-31'] },
    timeseries: { grossProfitQ: [90, 80, 70, 60, 30], grossProfitQEnds: [...ENDS] } });
  const neg = base(); neg.timeseries.grossProfitQ[0] = -30;
  close(overviewMetric(neg).value, -2, 'negative numerator, positive prior: -200 %');
  for (const prior of [null, 0, -10]) {
    const s = base(); s.timeseries.grossProfitQ[4] = prior;
    close(overviewMetric(s).value, 0.2, String(prior) + ': falls back to the dated fiscal year');
    assert.equal(overviewShadow(s, 'gp').period.basis, 'year');
  }
  for (const grossProfitQEnds of [ENDS.slice(0, 3), ['2026-02-30', ...ENDS.slice(1)]]) {
    const s = base(); s.timeseries.grossProfitQEnds = grossProfitQEnds; s.timeseries.grossProfitQ[2] = null;
    close(overviewMetric(s).value, 0.2, JSON.stringify(grossProfitQEnds) + ': no dated quarter pair');
    assert.notEqual(overviewShadow(s, 'gp').period.basis, 'quarter');
  }
});

test('B5 real cases UWMC and RKT: the revenue badge uses the revenue column candidate; unknown dates stay labelled', () => {
  for (const ticker of ['UWMC', 'RKT']) {
    const s = real(ticker), leg = revGrowthLeg(s);
    const badge = overviewMetric(s, { gpClass: 'degenerate' }), shadow = overviewShadow(s, 'revenue-badge');
    assert.equal(badge.kind, 'revenue-badge');
    close(badge.value * 100, axes.revGrowthLevel(s), ticker + ': badge and growth column agree');
    assert.deepEqual([shadow.period.basis, shadow.period.periodEnd], [leg.basis, leg.periodEnd], ticker);
    const a = s.annual.annualRev.map(v);
    assert.equal(legacy(() => overviewMetric(s, { gpClass: 'degenerate' })).value, a[0] / a[1] - 1, ticker + ': legacy annual badge');
  }
  close(overviewMetric(real('UWMC'), { gpClass: 'degenerate' }).value, -1.1720877156337544);
  const undated = { annual: { annualRev: [150, 100] } };
  assert.equal(overviewMetric(undated, { gpClass: 'degenerate' }).value, 0.5);
  assert.equal(overviewShadow(undated, 'revenue-badge').period.label, 'Geschäftsjahr, Periodenende unbekannt');
});

test('held cells MAD.AX, AJBU.SI, MODEC (6269.T), OBM.AX, CIG-C are never revived; a future #448 September cell neither', () => {
  for (const ticker of ['MAD.AX', 'AJBU.SI', '6269.T']) {
    const s = real(ticker), held = s.timeseries.revenueQ[0];
    assert.equal(held.value, null, ticker); assert.ok(held.financialCorrection.originalVendorRow.value > 0, ticker);
    const leg = G.g31Shadow(s).v1;
    assert.equal(leg.basis, 'year', ticker + ': the held quarter is no candidate');
    assert.equal(leg.current, v(s.annual.annualRev[0]), ticker);
    assert.notEqual(G.quarterCandidate(s).current, held.financialCorrection.originalVendorRow.value, ticker);
  }
  const obm = real('OBM.AX');
  assert.equal(axes.revGrowthLevel(obm), null, 'OBM.AX: held older years are not bridged');
  const obmGp = overviewMetric(obm);
  assert.deepEqual([obmGp.value, obmGp.valuePresent, obmGp.reason], [null, false, OVERVIEW_YEARS_NOT_ADJACENT_TEXT]);
  const cig = real('CIG-C'), cell = cig.timeseries.grossProfitQ[0];
  assert.ok(cell.financialCorrection && cell.value > 0, 'CIG-C: the corrected cell carries the hand-table value');
  assert.equal(G.quarterCandidate(cig, 'grossProfitQ').current, cell.value);
  // #448: a new September 2026 quarter the hand table does not list is withheld (value null with its
  // reason). The newest period is then unavailable: the fiscal year carries, labelled as such, never the
  // vendor value and never the June quarter presented as the newest.
  const gran = real('GRANULES.NS');
  gran.timeseries.revenueQ.unshift({ value: null, financialMissing: { caseId: 'p448-future', originalVendorRow: { value: 999e6 } } });
  gran.timeseries.revenueQEnds.unshift('2026-09-30');
  const leg = revGrowthLeg(gran);
  assert.deepEqual([leg.basis, leg.periodEnd], ['year', gran.annual.annualRevEnds[0]]);
  assert.notEqual(leg.periodEnd, '2026-06-30');
});

test('display-only: changing only the overview value changes no score, rank or membership (real writer output)', () => {
  const tickers = ['DAVE', '2059.TW', '5475.TWO', 'UWMC', 'RKT'];
  const snaps = tickers.map(t => { const s = real(t); s.meta.ticker = '_G31_' + t; return s; });
  for (const s of snaps) fs.writeFileSync(path.join(process.env.FINDASH_SNAPSHOTS_DIR, safeSnapshotFilename(s.meta.ticker)), JSON.stringify(s));
  const entries = overview => snaps.map((s, i) => ({ ticker: s.meta.ticker, action: 'route', formulaId: 'financials', track: 'profitable',
    score: 60 + i, revGrowthYoYPct: axes.revGrowthLevel(s), overview: overview(s, i >= 3 ? { gpClass: 'degenerate' } : {}) }));
  const now = produceRankings(entries(overviewMetric)).branches.financials.profitable;
  const old = produceRankings(entries((s, o) => legacy(() => overviewMetric(s, o)))).branches.financials.profitable;
  assert.deepEqual(now.map(r => [r.ticker, r.score]), old.map(r => [r.ticker, r.score]));
  assert.notDeepEqual(now.map(r => r.overview.value), old.map(r => r.overview.value), 'the probe really changes the display');
  const rows = now.map((r, i) => W.mapBoardRow(r, i, 'main'));
  rows.forEach((row, i) => {
    assert.equal(row.rank, i + 1); assert.equal(row.score, now[i].score);
    assert.equal(row.overviewValueLegacy, old[i].overview.value, row.ticker + ': comparison field = pre-G31 value');
    assert.equal(row.revGrowthBasis, revGrowthLeg(snaps.find(s => s.meta.ticker === row.ticker)).basis);
  });
  const dave = rows.find(r => r.ticker === '_G31_DAVE');
  assert.deepEqual([dave.overview.value, dave.overviewValueLegacy], [0.299, 0.704]);
  assert.deepEqual(dave.g31OverviewShadow.period, { basis: 'quarter', periodEnd: '2026-06-30' });
  const errs = []; for (const row of rows) W.validateBoardRow(row, row.ticker, errs);
  assert.deepEqual(errs.filter(e => /Legacy|revGrowth/.test(e)), []);
});

test('legacy comparison fields: four together, same rules as the live label, broken rows are reported', () => {
  const ok = { revGrowthYoYPct: 20, revGrowthBasis: 'quarter', revGrowthPeriodEnd: '2026-06-30', revGrowthPriorPeriodEnd: '2025-06-30',
    revGrowthYoYPctLegacy: 50, revGrowthBasisLegacy: 'year', revGrowthPeriodEndLegacy: '2025-12-31', revGrowthPriorPeriodEndLegacy: '2024-12-31' };
  const errsOf = r => { const e = []; W.checkRevGrowthBasis(r, 'row', e); return e; };
  assert.deepEqual(errsOf(ok), []);
  assert.deepEqual(errsOf({ ...ok, revGrowthYoYPctLegacy: null, revGrowthBasisLegacy: 'none', revGrowthPeriodEndLegacy: null, revGrowthPriorPeriodEndLegacy: null }), []);
  for (const bad of [{ revGrowthBasisLegacy: 'ttm' }, { revGrowthYoYPctLegacy: null }, { revGrowthPeriodEndLegacy: '2025-02-30' },
    { revGrowthBasisLegacy: 'none' }, { revGrowthYoYPctLegacy: 'x' }]) {
    assert.ok(errsOf({ ...ok, ...bad }).some(e => /Legacy/.test(e)), JSON.stringify(bad));
  }
  const partial = { ...ok }; delete partial.revGrowthPeriodEndLegacy;
  assert.ok(errsOf(partial).some(e => /Legacy nur teilweise/.test(e)));
});

test('break-once: reverting the production default makes the switch checks fail; live sources unchanged', () => {
  const gfile = path.resolve(__dirname, '../lib/g31-recency.js'), afile = path.resolve(__dirname, '../src/scoring/axes.js');
  const hash = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const before = [hash(gfile), hash(afile)];
  const gs = fs.readFileSync(gfile, 'utf8'), anchor = "let activeVariant = 'v1';";
  assert.equal(gs.split(anchor).length, 2, 'exact unique anchor');
  const compile = (file, source, overrides) => {
    const m = new Module(file, module), req = createRequire(file); m.filename = file; m.paths = module.paths;
    m.require = id => (Object.hasOwn(overrides, id) ? overrides[id] : req(id)); m._compile(source, file); return m.exports;
  };
  const reverted = compile(gfile, gs.replace(anchor, 'let activeVariant = null;'), {});
  const axesReverted = compile(afile, fs.readFileSync(afile, 'utf8'), { '../../lib/g31-recency.js': reverted });
  const check = A => { const s = real('PENG'); assert.equal(A.revGrowthLevel(s), revGrowthLeg(s).pct); };
  check(axes);
  assert.throws(() => check(axesReverted), assert.AssertionError);
  assert.deepEqual([hash(gfile), hash(afile)], before);
});
