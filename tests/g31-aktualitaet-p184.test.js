'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Module, createRequire } = require('node:module');
const G = require('../lib/g31-recency.js');
const axes = require('../src/scoring/axes.js');
const { robustG, produceRankings } = require('../src/scoring/score.js');
const { overviewMetric, overviewShadow } = require('../src/scoring/overview.js');
const { withAnnualPairRule } = require('../lib/annual-pairs.js');
const { revGrowthLeg } = require('../lib/rev-growth-basis.js');
const { fcfMarginStmtFY } = require('../lib/fcf-stmt-shadow.js');
const { preserveReloadHistory } = require('../lib/reload-history.js');
const { applyFinancialCases } = require('../lib/financial-known-cases.js');
const { fixture, fixtureTable } = require('./annual-financial-replacements.test.js');
const X = require('../lib/exchange-quarter-check.js');
const F = require('./fixtures/exchange-quarter-check.json');
const { mapBoardRow, mapOverviewRow, checkRevGrowthBasis } = require('../scripts/write-findash-export.js');
const r40 = require('../scripts/write-rule40-export.js');
const ends = ['2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30', '2025-03-31', '2024-12-31', '2024-09-30'];
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
const snapshot = () => ({ meta: {}, annual: { annualRev: [150, 100], annualRevEnds: ['2025-12-31', '2024-12-31'],
  annualGP: [60, 50], annualGPEnds: ['2025-12-31', '2024-12-31'] },
  timeseries: { revenueQ: [200, null, 110, 100, 100], revenueQEnds: ends.slice(0, 5),
    grossProfitQ: [90, null, 50, 40, 30], grossProfitQEnds: ends.slice(0, 5) } });
const newer = s => { s.meta.annualRevNewerYear = { end: '2026-08-31', priorEnd: '2025-08-31',
  revenue: 180, priorRevenue: 150, priorStored: 150 }; return s; };

test('B1: dated endpoints survive an empty intermediate row, matching its absent-row twin', () => {
  const s = snapshot(), before = JSON.stringify(s), twin = structuredClone(s);
  twin.timeseries.revenueQ.splice(1, 1); twin.timeseries.revenueQEnds.splice(1, 1);
  // G31 switch 18.10.2026: production is the v1 arm; the pre-G31 value stays reachable as 'legacy'.
  close(axes.revGrowthLevel(s), 100);
  close(G.g31Shadow(s).v1.pct, 100);
  assert.deepEqual(G.g31Shadow(s).v1, G.g31Shadow(twin).v1);
  assert.equal(JSON.stringify(s), before);
  close(G.withG31Variant('legacy', () => axes.revGrowthLevel(s)), 50);
  close(axes.revGrowthLevel(s), 100);
});

test('B2: later validated annual wins; equal dates retain the quarter', () => {
  const s = newer(snapshot()); s.timeseries.revenueQ[1] = 100;
  close(G.withG31Variant('legacy', () => axes.revGrowthLevel(s)), 100);
  close(axes.revGrowthLevel(s), 20);
  const selected = G.g31Shadow(s).v1;
  close(selected.pct, 20); assert.equal(selected.basis, 'yearNewerRecord');
  assert.equal(selected.label, 'Geschäftsjahr bis 31.08.2026');
  s.meta.annualRevNewerYear.end = '2026-06-30'; s.meta.annualRevNewerYear.priorEnd = '2025-06-30';
  assert.equal(G.g31Shadow(s).v1.basis, 'quarter');
});

test('B3: bonus uses the validated newer annual component even with a quarter', () => {
  const s = newer(snapshot()); s.timeseries.revenueQ[1] = 100;
  close(G.withG31Variant('legacy', () => robustG(s)), 0.75);
  close(G.withG31Variant('v1', () => robustG(s)), 0.6);
  close(robustG(s), 0.6);
});

test('V2 sums eight complete consecutive quarters, and never substitutes an annual value', () => {
  const s = snapshot();
  s.timeseries.revenueQ = [200, 120, 100, 80, 100, 90, 60, 50]; s.timeseries.revenueQEnds = ends;
  close(G.g31Shadow(s).v2.pct, (500 / 300 - 1) * 100);
  assert.equal(G.g31Shadow(s).v2.label, 'Vier Quartale bis 30.06.2026');
  G.withG31Variant('v2', () => {
    close(axes.revGrowthLevel(s), revGrowthLeg(s).pct);
    close(r40.basisQuartal(s), 75); assert.equal(r40.basisJahr(s), null);
  });
  s.timeseries.revenueQ[2] = null;
  assert.equal(G.g31Shadow(s).v2.pct, null);
  assert.match(G.g31Shadow(s).v2.reason, /acht vollständige Quartalswerte/);
  assert.equal(G.withG31Variant('v2', () => robustG(s)), null);
  s.timeseries.revenueQ[2] = 100; s.timeseries.revenueQEnds = [...ends]; s.timeseries.revenueQEnds[2] = '2025-11-30';
  assert.equal(G.g31Shadow(s).v2.pct, null);
});

test('annual fingerprint still rejects drifted records and annual held years never bridge', () => {
  const s = newer(snapshot()); s.meta.annualRevNewerYear.priorStored++;
  assert.equal(axes.annualLegNewerYear(s), null);
  assert.equal(G.g31Shadow(s).v1.basis, 'quarter');
  const raw = fixture(); raw.annual.annualRev[1].value++;
  const held = applyFinancialCases(raw, { table: fixtureTable() }).snapshot;
  assert.deepEqual(held.annual.annualRev.slice(1).map(x => x.value), [null, null, null]);
  assert.equal(axes.revAcceleration(held), null);
  assert.equal(G.g31Shadow(held).v1.pct, null);
});

test('annual rule stays off by default; explicit checks keep inclusive 334 and 397 days', () => {
  for (const [days, valid] of [[333, false], [334, true], [397, true], [398, false], [730, false]]) {
    const s = { meta: {}, annual: { annualRev: [150, 100], annualRevEnds: ['2026-06-30',
      new Date(Date.parse('2026-06-30') - days * 86400000).toISOString().slice(0, 10)] } };
    close(G.g31Shadow(s).v1.pct, axes.revGrowthLevel(s));
    assert.equal(withAnnualPairRule({ growth: true }, () => G.g31Shadow(s).v1.pct !== null), valid, String(days));
    const recorded = newer(structuredClone(s));
    recorded.meta.annualRevNewerYear.end = s.annual.annualRevEnds[0];
    recorded.meta.annualRevNewerYear.priorEnd = s.annual.annualRevEnds[1];
    close(G.g31Shadow(recorded).v1.pct, axes.revGrowthLevel(recorded));
    assert.equal(withAnnualPairRule({ growth: true }, () => G.g31Shadow(recorded).v1.pct !== null), valid, String(days));
  }
});

test('quarter pairing keeps exactly the 15-day tolerance and positive prior guard', () => {
  for (const [days, valid] of [[349, false], [350, true], [380, true], [381, false]]) {
    const s = { timeseries: { revenueQ: [120, 100], revenueQEnds: ['2026-06-30',
      new Date(Date.parse('2026-06-30') - days * 86400000).toISOString().slice(0, 10)] } };
    assert.equal(G.quarterCandidate(s).pct !== null, valid);
  }
  for (const prior of [null, 0, -100]) {
    const s = snapshot(); s.timeseries.revenueQ[4] = prior;
    assert.equal(G.quarterCandidate(s).pct, null);
  }
  const s = snapshot(); s.timeseries.revenueQ[0] = 0;
  assert.equal(G.quarterCandidate(s).pct, -100);
});

test('undated quarter gaps stay blocked; missing and invalid dates are never invented', () => {
  const s = snapshot(); delete s.timeseries.revenueQEnds;
  assert.equal(G.quarterCandidate(s).pct, null);
  s.timeseries.revenueQ[1] = 100;
  close(G.quarterCandidate(s).pct, 100); assert.equal(G.quarterCandidate(s).periodEnd, null);
  s.timeseries.revenueQEnds = ['2026-02-30'];
  assert.equal(G.quarterCandidate(s).periodEnd, null);
  s.timeseries.revenueQ[0] = { value: null, financialMissing: { originalVendorRow: { value: 200 } } };
  assert.equal(G.quarterCandidate(s).pct, null);
});

test('FCF requires same fiscal year and currency; genuine zero remains present', () => {
  const s = { annual: { annualRev: [1000], annualFCF: [200], annualRevEnds: ['2025-12-31'], annualFCFEnds: ['2025-12-31'] },
    meta: { statementPeriods: { annualRev: [{ currency: 'USD', duration: '12M' }], annualFCF: [{ currency: 'USD', duration: '12M' }] } } };
  assert.equal(fcfMarginStmtFY(s).value, 20);
  s.annual.annualFCFEnds[0] = '2024-12-31'; assert.equal(fcfMarginStmtFY(s).grund, 'fy-end-mismatch');
  s.annual.annualFCFEnds[0] = '2025-12-31'; s.meta.statementPeriods.annualFCF[0].currency = 'EUR';
  assert.equal(fcfMarginStmtFY(s).grund, 'currency-mismatch');
  s.meta.statementPeriods.annualFCF[0].currency = 'USD'; s.annual.annualFCF[0] = 0;
  assert.equal(fcfMarginStmtFY(s).value, 0);
  const q = snapshot(); q.timeseries.revenueQ[0] = { value: 200, currency: 'USD' };
  q.timeseries.revenueQ[4] = { value: 100, currency: 'EUR' };
  assert.equal(G.quarterCandidate(q).pct, null);
});

test('carry-forward requires identical period, currency and basis and respects held cells', () => {
  const make = (value, end = '2025-12-31', currency = 'USD') => ({ meta: { reportingCurrency: currency,
    statementPeriods: { annualRev: [{ end, duration: '12M', currency, unit: 'currency', basis: 'reported', fetchedAt: '2026-01-31' }] } },
    annual: { annualRev: [value], annualRevEnds: [end] } });
  const prior = make(100);
  assert.equal(preserveReloadHistory(make(null), prior).annual.annualRev[0], 100);
  assert.equal(preserveReloadHistory(make(null, '2026-12-31'), prior).annual.annualRev[0], null);
  assert.equal(preserveReloadHistory(make(null, '2025-12-31', 'EUR'), prior).annual.annualRev[0], null);
  assert.equal(preserveReloadHistory(make(0), prior).annual.annualRev[0], 0);
  assert.equal(preserveReloadHistory(make({ value: null, financialMissing: {} }), prior).annual.annualRev[0].value, null);
});

test('exchange policy stays fill-only: fill a missing value, retain a differing vendor value', () => {
  const context = { stores: { cn: F.store.cn, tw: F.store.tw, warnings: [] },
    baseline: { date: F.baseline.date, rows: new Map(Object.entries(F.baseline.rows)), warnings: [] } };
  assert.equal(X.policy.mode, 'fill-only');
  const run = ticker => X.applyExchangeCheck(structuredClone(F.snapshots[ticker]), { mode: 'fill-only', context });
  const fill = run('000002.SZ'); assert.equal(fill.result.category, 'would-fill');
  assert.notDeepEqual(fill.snapshot, F.snapshots['000002.SZ']);
  // 000599.SZ is owned by the hand table since the G31 switch (P268); 000564.SZ is the same level mismatch.
  const mismatch = run('000564.SZ'); assert.match(mismatch.result.category, /^would-withhold/);
  assert.deepEqual(mismatch.snapshot, F.snapshots['000564.SZ']);
});

test('B4/B5: the live overview shows the newest labelled candidate; legacy keeps the old values', () => {
  // G31 switch 18.10.2026: overviewMetric now equals overviewShadow; 'legacy' reproduces the pre-G31 value.
  const legacy = (...args) => G.withG31Variant('legacy', () => overviewMetric(...args)).value;
  const s = snapshot();
  const gp = overviewShadow(s, 'gp'); close(gp.value, 2);
  assert.equal(gp.period.label, 'Quartal bis 30.06.2026');
  close(overviewMetric(s).value, 2); close(legacy(s), 0.2);
  // P267: the live metric carries the period of exactly its value (export shape, four keys).
  assert.deepEqual(overviewMetric(s).period, { basis: 'quarter', periodEnd: '2026-06-30', priorPeriodEnd: '2025-06-30', reason: null });
  const rev = overviewShadow(newer(s), 'revenue-badge'); close(rev.value, 0.2);
  assert.equal(rev.period.label, 'Geschäftsjahr bis 31.08.2026');
  close(overviewMetric(s, { gpClass: 'degenerate' }).value, 0.2);
  close(legacy(s, { gpClass: 'degenerate' }), 0.5);
  s.timeseries.grossProfitQ[0] = -30; close(overviewShadow(s, 'gp').value, -2); close(overviewMetric(s).value, -2);
  s.timeseries.grossProfitQ[4] = 0; close(overviewShadow(s, 'gp').value, 0.2);
  close(overviewMetric(s).value, 0.2);
  assert.equal(overviewShadow(s, 'runway-badge'), null);
});

test('B5 keeps overview adjacency for annual and validated newer-year pairs; the period gate empties scoring alike', () => {
  for (const [days, valid] of [[333, false], [334, true], [397, true], [398, false], [730, false]]) {
    const s = { meta: {}, annual: { annualRev: [150, 100], annualRevEnds: ['2026-06-30',
      new Date(Date.parse('2026-06-30') - days * 86400000).toISOString().slice(0, 10)] } };
    for (const recorded of [false, true]) {
      if (recorded) s.meta.annualRevNewerYear = { end: s.annual.annualRevEnds[0], priorEnd: s.annual.annualRevEnds[1],
        revenue: 180, priorRevenue: 150, priorStored: 150 };
      const before = JSON.stringify(s), live = overviewMetric(s, { gpClass: 'degenerate' });
      const shadow = overviewShadow(s, 'revenue-badge');
      assert.equal(shadow.value !== null, valid, `${days} days, newer record ${recorded}`);
      assert.equal(live.value !== null, valid);
      if (valid) close(shadow.value, recorded ? 0.2 : 0.5);
      else {
        // Period gate (24.10.2026): the label names both ends and the distance; P158's marker on the metric stays.
        assert.equal(shadow.period.reason, `Perioden 30.06.2026 und ${s.annual.annualRevEnds[1].split('-').reverse().join('.')} liegen ${days} Tage auseinander, kein Jahrespaar; Wachstum nicht gezeigt.`);
        assert.equal(live.reason, 'Jahreswachstum nicht belegt, Jahre liegen nicht hintereinander');
      }
      if (valid) close(G.g31Shadow(s).v1.pct, recorded ? 20 : 50);
      else assert.equal(G.g31Shadow(s).v1.pct, null);
      assert.equal(JSON.stringify(s), before);
    }
  }
  const s = snapshot(); s.annual.annualRevEnds = ['2025-12-31', '2023-12-31'];
  close(overviewShadow(s, 'revenue-badge').value, 1);
  assert.equal(overviewShadow(s, 'revenue-badge').period.basis, 'quarter');
});

test('real ranking and mappers keep the live overview and append separate shadow keys', () => {
  const e = { ticker: '_P184_TEST_', action: 'route', formulaId: 'software-comm-services', track: 'profitable', score: 75,
    overview: overviewMetric(snapshot()) };
  const ranked = produceRankings([e]);
  const row = mapBoardRow(ranked.branches[e.formulaId].profitable[0], 0);
  const flat = mapOverviewRow(ranked.overview[0], 0);
  assert.equal(row.score, 75); assert.equal(row.rank, 1);
  assert.deepEqual(Object.keys(row.overview), ['kind', 'value', 'companion']);
  assert.equal(row.overview.value, 2); // G31 switch: the newest labelled GP quarter (legacy 0.2)
  // P267: value and label travel together from the engine to both mappers.
  assert.deepEqual(flat.overviewPeriod, row.overviewPeriod);
  assert.equal(row.overviewPeriod.basis, 'quarter'); assert.equal(row.overviewPeriod.periodEnd, '2026-06-30');
  assert.deepEqual(row.g31OverviewShadow, flat.g31OverviewShadow);
  for (const output of [row, flat]) assert.deepEqual(Object.keys(output).slice(-2), ['g31Shadow', 'g31OverviewShadow']);
  // P184b omits unavailable V2 from delivery; the complete diagnostic remains in g31Shadow().
  assert.ok(Object.hasOwn(row.g31Shadow, 'v1')); assert.equal(Object.hasOwn(row.g31Shadow, 'v2'), false);
  assert.equal(G.g31Shadow(null).v2.pct, null);
  assert.deepEqual(produceRankings([{ ...e, overview: { kind: 'gp', value: -99 } }]).branches[e.formulaId].profitable.map(r => [r.ticker, r.score]),
    ranked.branches[e.formulaId].profitable.map(r => [r.ticker, r.score]));
});

test('display fallbacks cannot revive a currency-rejected pair; TTM validation is measurement-only', () => {
  const gp = { timeseries: { grossProfitQ: [150, 150, 150, 150, 100, 100, 100, 100]
    .map((value, i) => ({ value, currency: i === 4 ? 'EUR' : 'USD' })), grossProfitQEnds: ends } };
  const rev = { annual: { annualRev: [{ value: 150, currency: 'USD' }, { value: 100, currency: 'EUR' }],
    annualRevEnds: ['2025-12-31', '2024-12-31'] } };
  assert.equal(overviewShadow(gp, 'gp').value, null);
  assert.match(overviewShadow(gp, 'gp').period.reason, /Währungen/);
  assert.equal(overviewShadow(rev, 'revenue-badge').value, null);
  gp.timeseries.grossProfitQ[4].currency = 'USD'; rev.annual.annualRev[1].currency = 'USD';
  close(overviewMetric(gp).value, 0.5); close(overviewMetric(rev, { gpClass: 'degenerate' }).value, 0.5);
  gp.timeseries.grossProfitQ[4].value = 0;
  const ttm = overviewShadow(gp, 'gp');
  close(ttm.value, 1); assert.equal(ttm.period.label, 'Vier Quartale bis 30.06.2026');
  const row = { revGrowthBasis: 'ttm', revGrowthYoYPct: 20, revGrowthPeriodEnd: ends[0], revGrowthPriorPeriodEnd: ends[4] };
  const errors = []; G.withG31Variant('v2', () => checkRevGrowthBasis(row, 'v2', errors)); assert.deepEqual(errors, []);
  checkRevGrowthBasis(row, 'live', errors); assert.equal(errors.length, 1);
});

test('real mapper exports a complete V2 and selects the dedicated smallcap snapshot once', () => {
  const main = snapshot(), smallcap = snapshot();
  for (const s of [main, smallcap]) {
    s.meta = { ticker: '_P184_COMPLETE_', tradingCurrency: 'USD' };
    s.timeseries.revenueQ = [200, 120, 100, 80, 100, 90, 60, 50]; s.timeseries.revenueQEnds = ends;
  }
  smallcap.timeseries.revenueQ[0] = 500;
  const file = path.resolve(__dirname, '../scripts/write-findash-export.js'), source = fs.readFileSync(file, 'utf8');
  const requireReal = createRequire(file), counts = { main: 0, smallcap: 0 };
  const m = new Module(file, module); m.filename = file; m.paths = module.paths;
  m.require = id => {
    if (id === 'fs' || id === 'node:fs') return { ...fs, readFileSync: (target, options) => {
      if (String(target).endsWith('_P184_COMPLETE_.json')) {
        const store = String(target).includes('snapshots-smallcap') ? 'smallcap' : 'main'; counts[store]++;
        return JSON.stringify(store === 'smallcap' ? smallcap : main);
      }
      return fs.readFileSync(target, options);
    } };
    if (id === '../lib/yahoo-q4-known-cases.js') return { prepareSnapshot: s => s };
    return requireReal(id);
  };
  m._compile(source, file);
  G.withG31Variant('v2', () => {
    const row = { ticker: '_P184_COMPLETE_', score: 75, track: 'profitable', overview: overviewMetric(smallcap),
      overviewKind: 'gp', revGrowthYoYPct: G.g31Shadow(smallcap).v2.pct };
    const out = m.exports.mapBoardRow(row, 0, 'smallcap'), errors = [];
    close(out.g31Shadow.v2.pct, (800 / 300 - 1) * 100);
    assert.equal(out.revGrowthBasis, 'ttm'); assert.equal(counts.smallcap, 1);
    checkRevGrowthBasis(out, 'smallcap-v2', errors); assert.deepEqual(errors, []);
    const flat = m.exports.mapOverviewRow(row, 0, 'smallcap'); assert.deepEqual(flat.g31Shadow, out.g31Shadow);
    // P184b labels are losslessly derived from basis/end instead of repeated on every row.
    assert.deepEqual(out.g31OverviewShadow.period, { basis: 'quarter', periodEnd: '2026-06-30' });
    assert.deepEqual(flat.g31OverviewShadow, out.g31OverviewShadow);
    assert.equal(out.overview.value, row.overview.value);
    assert.equal(counts.smallcap, 1, 'board and overview share the store-aware snapshot cache');
    const mainRow = m.exports.mapBoardRow({ ...row, revGrowthYoYPct: G.g31Shadow(main).v2.pct }, 0, 'main');
    close(mainRow.g31Shadow.v2.pct, (500 / 300 - 1) * 100);
    assert.deepEqual(counts, { main: 1, smallcap: 1 });
  });
});

test('compact export preserves exceptional dates, real zero and missing reasons without raw operands', () => {
  const s = snapshot();
  let out = G.g31Export(s);
  assert.deepEqual(out.g31Shadow.v1, { pct: 100, basis: 'quarter', periodEnd: '2026-06-30' });
  assert.deepEqual(out.g31Overview.gp, { value: 2, period: { basis: 'quarter', periodEnd: '2026-06-30' } });
  assert.equal(Object.hasOwn(out.g31Shadow, 'v2'), false);
  s.timeseries.revenueQ[0] = 100;
  s.timeseries.revenueQEnds[4] = '2025-07-01';
  s.timeseries.reportedRevenueQEnds = ['2026-06-29', ...ends.slice(1, 4), '2025-06-29'];
  out = G.g31Export(s);
  assert.deepEqual(out.g31Shadow.v1, { pct: 0, basis: 'quarter', periodEnd: '2026-06-29',
    sourcePeriodEnd: '2026-06-30', sourcePriorPeriodEnd: '2025-07-01' });
  delete s.timeseries.reportedRevenueQEnds;
  assert.equal(G.g31Export(s).g31Shadow.v1.priorPeriodEnd, '2025-07-01');
  const missing = G.g31Export(null).g31Shadow.v1;
  assert.equal(missing.pct, null); assert.equal(missing.periodEnd, null); assert.ok(missing.reason);
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      assert.ok(!['current', 'prior', 'label', 'bonusComponents'].includes(key), key); walk(item);
    }
  };
  walk(out); walk(G.g31Export(null));
});

test('all nested G31 keys are registered and an unknown delivery key makes the guard fail', () => {
  const file = path.resolve(__dirname, 'druckenmiller/fixtures/v1-row-keys.snapshot.json');
  const hash = () => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), before = hash();
  const frozen = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(frozen, [...new Set(frozen)].sort());
  const walk = value => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) { assert.ok(frozen.includes(key), key); walk(item); }
  };
  const s = snapshot(); s.timeseries.revenueQ = [200, 120, 100, 80, 100, 90, 60, 50]; s.timeseries.revenueQEnds = ends;
  const shadow = G.g31Export(s);
  walk({ g31Shadow: G.g31Shadow(s), g31OverviewShadow: overviewShadow(s, 'gp') });
  walk({ g31Shadow: shadow.g31Shadow, g31OverviewShadow: shadow.g31Overview.gp });
  assert.throws(() => walk({ g31Shadow: { unregisteredProbe: 1 } }), assert.AssertionError);
  assert.equal(hash(), before);
});

test('shadow failures leave every legacy mapper field intact; smallcap hand-table errors stay swallowed', () => {
  const gfile = path.resolve(__dirname, '../lib/g31-recency.js'), wfile = path.resolve(__dirname, '../scripts/write-findash-export.js');
  const files = [gfile, wfile], hashes = () => files.map(file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
  const before = hashes(), gs = fs.readFileSync(gfile, 'utf8'), ws = fs.readFileSync(wfile, 'utf8');
  const load = (file, source, overrides) => {
    const m = new Module(file, module), real = createRequire(file); m.filename = file; m.paths = module.paths;
    m.require = id => Object.hasOwn(overrides, id) ? overrides[id] : real(id); m._compile(source, file); return m.exports;
  };
  const anchor = 'function g31Shadow(s) {'; assert.equal(gs.split(anchor).length, 2);
  const brokenGrowth = load(gfile, gs.replace(anchor, anchor + "\n  throw Error('synthetic growth fault');"), {});
  const brokenOverview = load(gfile, gs, { '../src/scoring/overview.js': { overviewShadow() { throw Error('synthetic overview fault'); } } });
  const s = snapshot(); s.meta = { ticker: '_P184_FAILURE_', tradingCurrency: 'USD' };
  const writer = (lib, failPrepare = false) => load(wfile, ws, {
    fs: { ...fs, readFileSync: (target, options) => String(target).endsWith('_P184_FAILURE_.json') ? JSON.stringify(s) : fs.readFileSync(target, options) },
    '../lib/g31-recency.js': lib,
    '../lib/yahoo-q4-known-cases.js': { prepareSnapshot: snap => {
      if (failPrepare) throw Object.assign(Error('synthetic hand-table fault'), { code: 'YAHOO_Q4_HAND_TABLE_FAILED' });
      return snap;
    } },
  });
  const row = { ticker: s.meta.ticker, score: 75, revGrowthYoYPct: 50, overview: overviewMetric(s), overviewKind: 'gp',
    overviewValue: overviewMetric(s).value }; // the flat overview mapper reads overviewValue
  // P267-r2: overviewValueLegacy and the overview label are verified against the live candidate re-derived in
  // the active arm, no longer against the shadow, so a shadow failure does not decide them. They stay outside
  // this comparison because the in-memory library copy below does not share its arm switch with the real
  // overview module (its legacy scope cannot reach overviewMetric).
  const legacy = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['g31Shadow', 'g31OverviewShadow', 'overviewValueLegacy', 'overviewPeriodLegacy'].includes(key)));
  for (const store of ['main', 'smallcap']) for (const mapper of ['mapBoardRow', 'mapOverviewRow']) {
    const expected = writer(G)[mapper](row, 0, store);
    close(expected.overviewValueLegacy, 0.2);
    for (const lib of [brokenGrowth, brokenOverview]) {
      const actual = writer(lib)[mapper](row, 0, store);
      assert.equal(JSON.stringify(legacy(actual)), JSON.stringify(legacy(expected)));
      assert.equal(actual.g31Shadow.v1, null); assert.match(actual.g31Shadow.reason, /Berechnung fehlgeschlagen/);
      assert.equal(actual.g31OverviewShadow.value, null); assert.match(actual.g31OverviewShadow.reason, /Berechnung fehlgeschlagen/);
    }
    const held = writer(G, true)[mapper](row, 0, store);
    assert.equal(held.score, row.score); assert.equal(held.revGrowthBasis, null);
    assert.equal(held.g31Shadow.v1.pct, null); assert.ok(held.g31Shadow.v1.reason);
  }
  assert.deepEqual(hashes(), before);
});

test('shadow scope restores after throws, nesting and rejected async calls', () => {
  // G31 switch 18.10.2026: the production arm is v1; 'legacy' is the only way to the pre-G31 calculation.
  assert.throws(() => G.withG31Variant('legacy', () => { throw Error('probe'); }), /probe/);
  assert.equal(G.g31Variant(), 'v1');
  G.withG31Variant('legacy', () => { G.withG31Variant('v2', () => assert.equal(G.g31Variant(), 'v2')); assert.equal(G.g31Variant(), null); });
  assert.throws(() => G.withG31Variant('legacy', async () => 1), /synchronous/);
  assert.throws(() => G.withG31Variant(null, () => 1), /legacy/);
  assert.equal(G.g31Variant(), 'v1');
});

test('break-once: B1, B2 and B3 each reject an in-memory broken source; live hashes unchanged', () => {
  const file = path.resolve(__dirname, '../lib/g31-recency.js'), source = fs.readFileSync(file, 'utf8');
  const hash = () => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const before = hash();
  const mutant = (anchor, replacement) => {
    assert.equal(source.split(anchor).length, 2, 'exact unique whole-line anchor');
    const m = new Module(file, module); m.filename = file; m.paths = module.paths; m.require = createRequire(file);
    m._compile(source.replace(anchor, replacement), file); return m.exports;
  };
  const checkB1 = lib => close(lib.g31Shadow(snapshot()).v1.pct, 100);
  const checkB2 = lib => close(lib.g31Shadow(newer(snapshot())).v1.pct, 20);
  const checkB3 = lib => close(lib.g31Shadow(newer(snapshot())).v1.bonusComponents[0], 0.2);
  assert.throws(() => checkB1(mutant("  if (!pair || pair.idx >= values.length || (pair.quelle === 'position'",
    "  if (!pair || pair.idx >= values.length || (true")), assert.AssertionError);
  assert.throws(() => checkB2(mutant('  const v1 = quarter.pct === null || newerAnnual ? annual : quarter;',
    '  const v1 = quarter.pct === null ? annual : quarter;')), assert.AssertionError);
  const brokenBonus = mutant('  const components = leg => [annual, leg].filter(c => c.pct !== null).map(c => c.current / c.prior - 1);',
    '  const components = leg => [leg].filter(c => c.pct !== null).map(c => c.current / c.prior - 1);');
  assert.throws(() => checkB3(brokenBonus), assert.AssertionError);
  checkB1(brokenBonus); checkB2(brokenBonus);
  checkB1(G); checkB2(G); checkB3(G); assert.equal(hash(), before);
});
