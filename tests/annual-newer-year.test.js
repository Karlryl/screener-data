'use strict';
// Tag 1391 (Diagnose 30.09.2026): (A) a strictly newer fiscal year that only the losing annual
// bundle carries is recorded next to the unchanged annual series (meta.annualRevNewerYear) and
// read ONLY by the annual growth leg, i.e. only when no quarterly year-over-year pair exists;
// never a zero, never an undated or unproven year. (B) Companies without a quarterly series
// enter the stale reload when their newest annual year is old or undated.
// Real exported functions; pullAll runs on the virtual files and fake Yahoo of
// stale-quarter-reload.test.js. No network, no live file is read or written.
const assert = require('node:assert/strict');
const path = require('path');
const Y = require('../pull-yahoo.js');
const R = require('../lib/stale-quarter-reload.js');
const axes = require('../src/scoring/axes.js');
const r40 = require('../scripts/write-rule40-export.js');
const { fixture, snapshot, NOW } = require('./stale-quarter-reload.test.js');
const root = path.resolve(__dirname, '..');
const cells = a => a.map(x => (x == null ? null : { value: x }));
const vals = a => (a || []).map(x => x?.value ?? x ?? null);
const clone = x => JSON.parse(JSON.stringify(x));
const desc = (end, o = {}) => ({ end, duration: '12M', currency: 'AUD', unit: 'currency', basis: 'yahoo-statement', ...o });
const FTS_ENDS = ['2025-06-30', '2024-06-30', '2023-06-30', '2022-06-30'];
const FY26 = { end: '2026-06-30', revenue: 347927740, priorEnd: '2025-06-30', priorRevenue: 261655008, currency: 'AUD' };

// SKS.AX as Yahoo served it on 30.09.2026: quoteSummary FY26, FY25 and two padded zeros;
// FTS FY25..FY22 with the operating lines (FY25 261,655,010 vs 261,655,008 AUD).
function sks({ qsRev = [347927740, 261655010, 0, 0], qsEnds = ['2026-06-30', '2025-06-30', '2024-06-30', '2022-06-30'], qsPeriod = {} } = {}) {
  // Like _statementPeriods: an undated row still has a descriptor, with end null.
  const qs = { annualRev: cells(qsRev), annualRevEnds: qsEnds, annualOpInc: [], annualOpIncEnds: [],
    annualGP: [null, null, null, null], annualGPEnds: qsEnds, annualNetIncome: cells([20e6, 15e6, null, null]),
    annualNetIncomeEnds: qsEnds, annualCostOfRevenue: [], _periods: qsEnds.map(e => desc(e, qsPeriod)) };
  const fts = { annualRev: cells([261655008, 136309155, 83268128, 67288383]), annualRevEnds: FTS_ENDS,
    annualOpInc: cells([21.5e6, 7.1e6, 0.4e6, 0.7e6]), annualOpIncEnds: FTS_ENDS,
    annualGP: cells([60e6, 30e6, 20e6, 15e6]), annualGPEnds: FTS_ENDS,
    annualNetIncome: cells([14e6, 5e6, 0.2e6, 0.5e6]), annualNetIncomeEnds: FTS_ENDS,
    annualCostOfRevenue: cells([201e6, 106e6, 63e6, 52e6]), _periods: FTS_ENDS.map(e => desc(e)) };
  return { qs, fts };
}
// A stored snapshot (USD) with a full annual block; `quarters` adds a dated year-over-year pair.
function stored({ marker = FY26, quarters = false } = {}) {
  const s = { meta: { ticker: 'SKS.AX', reportingCurrency: 'USD' }, metrics: { fcfMarginTTM: { value: 0.08 } },
    annual: { annualRev: cells([182617952.5, 95134807.4, 58115665.97, 46962857.03]), annualRevEnds: FTS_ENDS.slice(),
      annualGP: cells([41e6, 21e6, 14e6, 10e6]), annualOpInc: cells([13.9e6, 4.8e6, 0.28e6, 0.49e6]),
      annualNetIncome: cells([9e6, 3e6, 0.1e6, 0.3e6]), annualSBC: cells([1e6, 0.8e6, 0.5e6, 0.4e6]),
      annualFCF: cells([10e6, 4e6, 1e6, 0.5e6]), annualOCF: cells([12e6, 5e6, 2e6, 1e6]),
      annualBalance: [120e6, 80e6, 60e6, 50e6].map((totalAssets, i) => ({ totalAssets, currentLiabilities: 30e6 - i * 5e6 })) },
    timeseries: quarters ? { revenueQ: cells([60e6, 55e6, 50e6, 45e6, 40e6]),
      revenueQEnds: ['2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'] } : {} };
  if (marker) s.meta.annualRevNewerYear = { ...marker, source: 'quoteSummary', priorStored: 182617952.5 };
  return s;
}
const AXES = ['revGrowthLevel', 'revAcceleration', 'gpGrowth', 'ruleOfX', 'capitalEfficiency', 'dilution',
  'marginTrajectory', 'marginLevel', 'revYoYComponents', 'revAnnualYoY', 'revQuartalsYoY'];
const pct = x => Math.round(x * 100) / 100;

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message); }
}

(async () => {
  // ── A: the newer-year record (pure) ──────────────────────────────────────────
  await check('A presence: QS [FY26, FY25, 0, 0] vs FTS [FY25..FY22] records FY26, the merged series stay FTS', () => {
    const { qs, fts } = sks(), before = JSON.stringify([qs, fts]);
    assert.equal(Y.mergeAnnualIncomeBundle(qs, fts), fts, 'annual series are the unchanged FTS bundle');
    assert.deepEqual(Y._newerAnnualYear(fts, qs), FY26, 'FY26 against FY25, native AUD, no zero');
    assert.equal(JSON.stringify([qs, fts]), before, 'inputs are not mutated');
  });
  await check('A presence: an FTS year newer than a winning quoteSummary bundle is recorded the same way', () => {
    const ends = ['2025-12-31', '2024-12-31', '2023-12-31', '2022-12-31'];
    const qs = { annualRev: cells([400, 300, 200, 100]), annualRevEnds: ends, annualOpInc: [], _periods: ends.map(e => desc(e)) };
    const fEnds = ['2026-12-31', '2025-12-31', '2024-12-31'];
    const fts = { annualRev: cells([500, 400, 300]), annualRevEnds: fEnds, annualOpInc: [], _periods: fEnds.map(e => desc(e)) };
    assert.equal(Y.mergeAnnualIncomeBundle(qs, fts), qs);
    assert.deepEqual(Y._newerAnnualYear(qs, fts), { end: '2026-12-31', revenue: 500, priorEnd: '2025-12-31', priorRevenue: 400, currency: 'AUD' });
  });
  for (const [name, opts] of [
    ['overlap disagrees by 0.51 %', { qsRev: [347927740, Math.round(261655008 * 1.0051), 0, 0] }],
    ['newer year undated', { qsEnds: [null, '2025-06-30', '2024-06-30', '2022-06-30'] }],
    ['newer year revenue 0', { qsRev: [0, 261655010, 0, 0] }],
    ['newer year revenue negative', { qsRev: [-347927740, 261655010, 0, 0] }],
    ['no overlap at all (shared years only zero)', { qsRev: [347927740, 0, 0, 0] }],
    ['no overlap at all (no shared date)', { qsEnds: ['2026-06-30', '2021-06-30', '2020-06-30', '2019-06-30'] }],
    ['stub period, 6 months after FY25', { qsEnds: ['2025-12-31', '2025-06-30', '2024-06-30', '2022-06-30'] }],
    ['skipped year (FY27 without FY26)', { qsEnds: ['2027-06-30', '2025-06-30', '2024-06-30', '2022-06-30'] }],
    ['other statement currency', { qsPeriod: { currency: 'USD' } }],
    ['other duration', { qsPeriod: { duration: '6M' } }],
    ['overlap only on an old year, not on the kept newest year', { qsRev: [347927740, 67288383], qsEnds: ['2026-06-30', '2022-06-30'] }],
    ['a sign flip in a shared year (a conflict, not padding)', { qsRev: [347927740, 261655010, -136309155, 0] }],
  ]) {
    await check('A absence: ' + name + ' -> nothing recorded, FTS bundle unchanged', () => {
      const { qs, fts } = sks(opts);
      assert.equal(Y._newerAnnualYear(fts, qs), null);
      assert.equal(Y.mergeAnnualIncomeBundle(qs, fts), fts);
    });
  }
  await check('A tolerance: 0.49 % overlap difference still records (same 0.5 % rule as the conflict guard)', () => {
    const { qs, fts } = sks({ qsRev: [347927740, Math.round(261655008 * 1.0049), 0, 0] });
    assert.equal(Y._newerAnnualYear(fts, qs).end, '2026-06-30');
  });
  for (const [name, edit] of [
    ['undated kept bundle (legacy cache without ends)', fts => { fts.annualRevEnds = [null, null, null, null]; }],
    ['partly dated kept bundle', fts => { fts.annualRevEnds = ['2025-06-30', null, '2023-06-30', '2022-06-30']; }],
    ['no statement descriptors (legacy cache)', fts => { delete fts._periods; }],
    ['kept bundle not newest-first (its index 0 is not the year measured against)', fts => {
      fts.annualRevEnds = FTS_ENDS.slice().reverse(); fts.annualRev = fts.annualRev.slice().reverse(); }],
    ['kept newest year is a stub (6 months after the year before)', fts => {
      fts.annualRevEnds = ['2025-06-30', '2024-12-31', '2023-12-31', '2022-12-31']; fts._periods = fts.annualRevEnds.map(e => desc(e)); }],
  ]) {
    await check('A absence: ' + name + ' -> nothing recorded', () => {
      const { qs, fts } = sks(); edit(fts);
      assert.equal(Y._newerAnnualYear(fts, qs), null);
    });
  }

  // ── A: only the annual growth leg reads the record ───────────────────────────
  await check('A annual leg: without a quarterly pair the growth is FY26/FY25 (+32.97 %); other annual axes unchanged', () => {
    const s = stored(), bare = stored({ marker: null });
    assert.equal(axes.revQuartalsYoY(s), null);
    assert.equal(pct(axes.revGrowthLevel(s)), 32.97);
    assert.equal(pct(axes.revGrowthLevel(bare)), 91.96, 'without the record: FY25/FY24 as before');
    assert.deepEqual(axes.revYoYComponents(s), [347927740 / 261655008 - 1], 'growth-boost component follows the same leg');
    for (const k of ['revAcceleration', 'gpGrowth', 'capitalEfficiency', 'dilution', 'marginTrajectory', 'marginLevel', 'revAnnualYoY']) {
      assert.deepEqual(axes[k](s), axes[k](bare), k + ' reads the unchanged annual series');
    }
  });
  await check('A quarter leg: with a quarterly pair the record is inert, every axis is identical', () => {
    const s = stored({ quarters: true }), bare = stored({ marker: null, quarters: true });
    assert.equal(pct(axes.revGrowthLevel(s)), 50, 'growth comes from the quarters (60/40)');
    for (const k of AXES) assert.deepEqual(axes[k](s), axes[k](bare), k);
  });
  await check('A annual leg: a record measured against another stored revenue, or without one, is ignored', () => {
    const other = stored(); other.meta.annualRevNewerYear.priorStored = 95134807.4;
    assert.equal(pct(axes.revGrowthLevel(other)), 91.96);
    const corrected = stored(); corrected.annual.annualRev[0] = { value: 180000000 };
    assert.equal(axes.annualLegNewerYear(corrected), null, 'a later correction of annualRev[0] disarms the record');
    const hole = stored(); hole.annual.annualRev[0] = null;
    assert.equal(axes.annualLegNewerYear(hole), null);
    const bareHole = stored({ marker: null }); bareHole.annual.annualRev[0] = null;
    assert.equal(axes.revGrowthLevel(hole), axes.revGrowthLevel(bareHole));
  });
  await check('A annual leg: a record with a negative revenue is ignored', () => {
    for (const k of ['revenue', 'priorRevenue']) {
      const s = stored(); s.meta.annualRevNewerYear[k] = -s.meta.annualRevNewerYear[k];
      assert.equal(axes.annualLegNewerYear(s), null, k);
      assert.equal(pct(axes.revGrowthLevel(s)), 91.96, k);
    }
  });
  await check('A annual leg: priorStored null with annualRev[0] null is ignored', () => {
    const s = stored(); s.annual.annualRev[0] = null; s.meta.annualRevNewerYear.priorStored = null;
    const bare = stored({ marker: null }); bare.annual.annualRev[0] = null;
    assert.equal(axes.annualLegNewerYear(s), null);
    assert.equal(axes.revGrowthLevel(s), axes.revGrowthLevel(bare));
  });
  await check('A rule 40: base-year and period gates use the same pair and fiscal year as the annual leg', () => {
    const s = stored(), bare = stored({ marker: null });
    assert.deepEqual(r40.basisJahr(s), { basis: 261655008, aktuell: 347927740 });
    assert.deepEqual(r40.basisJahr(bare), { basis: 95134807.4, aktuell: 182617952.5 });
    assert.equal(r40.neuestesQuartalsEnde(s), Date.parse('2026-06-30'));
    assert.equal(r40.neuestesQuartalsEnde(bare), Date.parse('2025-06-30'));
    assert.equal(r40.basisJahr(stored({ quarters: true })), null, 'quarter leg: the annual gate does not apply');
    const positional = stored({ quarters: true }); delete positional.timeseries.revenueQEnds;
    assert.notEqual(axes.revQuartalsYoY(positional), null, 'quarters still pair by position');
    assert.equal(r40.neuestesQuartalsEnde(positional), Date.parse('2025-06-30'), 'quarter leg: the record never sets the period');
  });

  // ── A: the real pullAll call site ────────────────────────────────────────────
  const answers = () => ({
    financials: FTS_ENDS.slice().reverse().map((date, i) => ({ date, periodType: '12M',
      totalRevenue: [67288383, 83268128, 136309155, 261655008][i], operatingIncome: 1e6 + i, grossProfit: 10e6 + i,
      netIncome: 5e5 + i, costOfRevenue: 50e6 + i })),
    'cash-flow': FTS_ENDS.slice().reverse().map((date, i) => ({ date, periodType: '12M', operatingCashFlow: 20e6 + i,
      freeCashFlow: 15e6 + i, stockBasedCompensation: 1e5 + i })),
    'balance-sheet': FTS_ENDS.slice().reverse().map((date, i) => ({ date, periodType: 'instant', totalAssets: 1e9 + i,
      currentAssets: 2e8 + i, currentLiabilities: 1e8, totalDebt: 5e7 })),
  });
  const summary = { price: { currency: 'USD', marketCap: 1e12, regularMarketPrice: 100 },
    financialData: { financialCurrency: 'USD' }, quoteType: { quoteType: 'EQUITY' },
    incomeStatementHistory: { incomeStatementHistory: [['2026-06-30', 347927740], ['2025-06-30', 261655010], ['2024-06-30', 0], ['2022-06-30', 0]]
      .map(([endDate, totalRevenue]) => ({ endDate, totalRevenue, grossProfit: 0, netIncome: totalRevenue ? 9e6 : null })) } };
  const pull = async (extra) => {
    const f = fixture({ snapshots: [snapshot('OLD', '2026-06-30')], manual: ['OLD'], annualResponses: answers(),
      summaryResponse: summary, ...extra });
    f.files.delete(path.join(root, 'fundamentals-cache', 'OLD.json'));
    const m = await f.run(); assert.equal(m.results[0].status, 'ok');
    return f.stored('OLD');
  };
  await check('A pullAll (annual leg): annual series stay the FTS bundle, the year is recorded, growth is FY26/FY25', async () => {
    const s = await pull({ quarterEmpty: true });
    assert.deepEqual(s.annual.annualRevEnds, FTS_ENDS);
    assert.deepEqual(vals(s.annual.annualRev), [261655008, 136309155, 83268128, 67288383]);
    assert.equal(vals(s.annual.annualOpInc)[0], 1e6 + 3, 'FY25 keeps its complete statement at index 0');
    assert.deepEqual(s.meta.annualRevNewerYear, { ...FY26, currency: 'USD', source: 'quoteSummary', priorStored: 261655008 });
    assert.equal(axes.revQuartalsYoY(s), null);
    assert.equal(pct(axes.revGrowthLevel(s)), 32.97);
  });
  await check('A pullAll (annual leg, AUD statements): fingerprint = stored converted annualRev[0], record armed, +32.97 %', async () => {
    const aud = { ...summary, price: { ...summary.price, currency: 'AUD' }, financialData: { financialCurrency: 'AUD' } };
    const s = await pull({ quarterEmpty: true, summaryResponse: aud });
    assert.notEqual(s.meta.fxRateApplied, 1, 'precondition: FX-converted statements');
    assert.equal(s.meta.annualRevNewerYear.priorStored, vals(s.annual.annualRev)[0], 'fingerprint is the stored, converted value');
    assert.equal(s.meta.annualRevNewerYear.priorRevenue, 261655008, 'the ratio inputs stay native AUD');
    assert(axes.annualLegNewerYear(s), 'non-USD record must be armed');
    assert.equal(pct(axes.revGrowthLevel(s)), 32.97);
  });
  await check('A pullAll: no warning when the main series caught up', async () => {
    const prev = snapshot('OLD', '2026-06-30');
    prev.annual = { annualRev: cells([261655008]), annualRevEnds: ['2025-06-30'] };
    prev.meta.annualRevNewerYear = { ...FY26, source: 'quoteSummary', priorStored: 261655008 };
    const caughtUp = answers();
    caughtUp.financials.push({ date: '2026-06-30', periodType: '12M', totalRevenue: 347927740, operatingIncome: 2e6,
      grossProfit: 20e6, netIncome: 9e6, costOfRevenue: 300e6 });
    const f = fixture({ snapshots: [prev], manual: ['OLD'], annualResponses: caughtUp, summaryResponse: summary, quarterEmpty: true });
    f.files.delete(path.join(root, 'fundamentals-cache', 'OLD.json'));
    assert.equal((await f.run()).results[0].status, 'ok');
    const s = f.stored('OLD');
    assert.equal(s.annual.annualRevEnds[0], '2026-06-30', 'FTS now carries FY26 itself');
    assert.equal(s.meta.annualRevNewerYear, undefined);
    assert(!f.logs.some(l => l.includes('nicht mehr bestaetigt')), 'no false fallback warning');
    assert.equal(pct(axes.revGrowthLevel(s)), 32.97, 'growth unchanged, now from the series');
  });
  await check('A pullAll: a record that is no longer confirmed while its year is still missing is logged', async () => {
    const prev = snapshot('OLD', '2026-06-30');
    prev.annual = { annualRev: cells([261655008]), annualRevEnds: ['2025-06-30'] };
    prev.meta.annualRevNewerYear = { ...FY26, source: 'quoteSummary', priorStored: 261655008 };
    const noNewer = { ...summary, incomeStatementHistory: { incomeStatementHistory: [] } };
    const f = fixture({ snapshots: [prev], manual: ['OLD'], annualResponses: answers(), summaryResponse: noNewer, quarterEmpty: true });
    f.files.delete(path.join(root, 'fundamentals-cache', 'OLD.json'));
    assert.equal((await f.run()).results[0].status, 'ok');
    assert.equal(f.stored('OLD').meta.annualRevNewerYear, undefined);
    assert(f.logs.some(l => l.includes('2026-06-30 nicht mehr bestaetigt')), 'the fallback by one fiscal year is visible');
  });
  await check('A pullAll (quarter leg): the record is written but inert, every axis equals the snapshot without it', async () => {
    const quarterlyRows = [['2025-06-30', 40], ['2025-09-30', 45], ['2025-12-31', 50], ['2026-03-31', 55], ['2026-06-30', 60]]
      .map(([date, v]) => ({ date, totalRevenue: v * 1e6, grossProfit: v * 4e5, operatingIncome: v * 1e5, netIncome: v * 5e4 }));
    const s = await pull({ quarterlyRows }), bare = clone(s); delete bare.meta.annualRevNewerYear;
    assert(s.meta.annualRevNewerYear, 'recorded at pull time');
    assert.equal(pct(axes.revGrowthLevel(s)), 50);
    for (const k of AXES) assert.deepEqual(axes[k](s), axes[k](bare), k);
  });

  // ── B: planner presence / absence ────────────────────────────────────────────
  const annualOnly = (ticker, ends, revs = [182e6, 95e6], fetched) => {
    const s = snapshot(ticker, '2026-03-31', fetched); s.timeseries = {};
    s.annual = { annualRev: cells(revs), ...(ends ? { annualRevEnds: ends } : {}) };
    return s;
  };
  const plan = (snaps, now = NOW) => {
    const f = fixture({ snapshots: snaps });
    return R.planReload(snaps.map(s => ({ ticker: s.meta.ticker })), { snapshotDir: f.out, now, config: f.config, io: f.io });
  };
  await check('B presence: annual-only row with a 456-day-old fiscal year is a candidate (basis annual)', () => {
    const p = plan([annualOnly('ANN', ['2025-06-30', '2024-06-30'])]);
    assert.equal(p.noQuarter, 1); assert.equal(p.selected.length, 1);
    assert.equal(p.selected[0].basis, 'annual'); assert.equal(p.selected[0].end, '2025-06-30');
  });
  await check('B presence: annual-only row with revenue but no dated year is a candidate (end null)', () => {
    const p = plan([annualOnly('UND', null)]);
    assert.equal(p.selected.length, 1); assert.equal(p.selected[0].basis, 'annual'); assert.equal(p.selected[0].end, null);
  });
  await check('B boundary: 395 days waits, 396 days is a candidate', () => {
    assert.equal(R.MAX_ANNUAL_AGE_DAYS, 395);
    assert.equal(plan([annualOnly('EDGE', ['2025-08-30'])]).selected.length, 0);
    assert.equal(plan([annualOnly('EDGE', ['2025-08-29'])]).selected.length, 1);
  });
  for (const [name, snap] of [
    ['fresh fiscal year (272 days)', annualOnly('FRESH', ['2025-12-31', '2024-12-31'])],
    ['no annual revenue at all', annualOnly('BARE', ['2024-06-30'], [null])],
    ['fetched three days ago', annualOnly('RECENT', ['2025-06-30'], undefined, '2026-09-26T02:17:00Z')],
  ]) {
    await check('B absence: ' + name + ' is no candidate, still counted as no-quarter', () => {
      const p = plan([snap]); assert.equal(p.noQuarter, 1); assert.equal(p.candidates.length, 0);
    });
  }
  await check('B record: an annual-only row whose growth leg already reports the newer year is no candidate', () => {
    const s = annualOnly('REC', ['2025-06-30', '2024-06-30'], [182e6, 95e6]);
    s.meta.annualRevNewerYear = { ...FY26, source: 'quoteSummary', priorStored: 182e6 };
    assert.equal(R.latestReportedAnnual(s, NOW), '2026-06-30');
    assert.equal(plan([s]).candidates.length, 0);
    s.meta.annualRevNewerYear.priorStored = 1;
    assert.equal(plan([s]).candidates.length, 1, 'an invalid record does not hide a stale year');
  });
  await check('B ordering: board rank first, then stale quarters before annual rows; undated ends sort without error', () => {
    const snaps = [snapshot('QTR'), annualOnly('UND', null), annualOnly('ANN', ['2025-06-30']), annualOnly('TOP', ['2025-06-30'])];
    const f = fixture({ snapshots: snaps });
    const p = R.planReload(snaps.map(s => ({ ticker: s.meta.ticker })), { snapshotDir: f.out, now: NOW,
      config: f.config, io: f.io, ranks: { TOP: 1 } });
    assert.deepEqual(p.selected.map(r => r.ticker), ['TOP', 'QTR', 'UND', 'ANN']);
    assert.deepEqual(p.selected.map(r => r.basis), ['annual', 'quarter', 'annual', 'annual']);
  });
  await check('B ordering: calendar evidence goes before the quarter-before-annual tie-break', () => {
    const snaps = [snapshot('QTR'), annualOnly('ANNR', ['2025-06-30'])];
    const f = fixture({ snapshots: snaps });
    const p = R.planReload(snaps.map(x => ({ ticker: x.meta.ticker })), { snapshotDir: f.out, now: NOW, config: f.config, io: f.io,
      calendar: { ANNR: { date: '2026-09-25' } } });
    assert.deepEqual(p.selected.map(r => [r.ticker, r.basis, r.reported]), [['ANNR', 'annual', true], ['QTR', 'quarter', false]]);
  });
  await check('B impossible date: 2025-02-30 is no reported fiscal year (the row counts as undated)', () => {
    const s = annualOnly('BAD', ['2025-02-30'], [182e6]);
    assert.equal(R.latestReportedAnnual(s, NOW), null);
    const p = plan([s]); assert.equal(p.selected.length, 1); assert.equal(p.selected[0].end, null);
  });
  await check('B zeros: a padded 0 is no reported fiscal year (dated zero skipped, all-zero row stays out)', () => {
    const p = plan([annualOnly('ZERO', ['2025-12-31', '2024-06-30'], [0, 95e6])]);
    assert.equal(p.selected.length, 1); assert.equal(p.selected[0].end, '2024-06-30');
    assert.equal(plan([annualOnly('NIL', ['2024-06-30', '2023-06-30'], [0, 0])]).candidates.length, 0);
  });

  // ── B: the real pullAll reload of an annual-only row ─────────────────────────
  const annualRows = (ends, revs) => ({
    financials: ends.slice().reverse().map((date, i) => ({ date, periodType: '12M', totalRevenue: revs.slice().reverse()[i],
      operatingIncome: 10 + i, grossProfit: 30 + i, netIncome: 5 + i })),
    'cash-flow': ends.slice().reverse().map((date, i) => ({ date, periodType: '12M', operatingCashFlow: 20 + i, freeCashFlow: 15 + i })),
    'balance-sheet': ends.slice().reverse().map((date, i) => ({ date, periodType: 'instant', totalAssets: 1000 + i, currentAssets: 200 + i })),
  });
  await check('B pullAll: selected annual-only row reloads, stores the newer fiscal year, counts newer', async () => {
    const f = fixture({ snapshots: [annualOnly('OLD', ['2025-06-30', '2024-06-30'], [182, 95])], quarterEmpty: true,
      annualResponses: annualRows(['2026-06-30', '2025-06-30', '2024-06-30'], [240, 182, 95]) });
    const m = await f.run();
    assert.equal(m.n_stale_quarter_selected, 1); assert.equal(m.results[0].status, 'ok', m.results[0].fundamentalsRetainedReason);
    assert.equal(m.n_stale_quarter_reload_failed, 0); assert.equal(m.n_stale_quarter_newer, 1);
    assert.equal(m.n_stale_quarter_still_old_yahoo, 0);
    assert.equal(m.results[0].quarterReload.basis, 'annual');
    assert.equal(m.results[0].quarterReload.storedQuarter, '2026-06-30');
    assert.equal(f.stored('OLD').annual.annualRevEnds[0], '2026-06-30');
  });
  await check('B pullAll: an undated row that now carries a young fiscal year counts as newer', async () => {
    const f = fixture({ snapshots: [annualOnly('OLD', null, [182, 95])], quarterEmpty: true,
      annualResponses: annualRows(['2026-06-30', '2025-06-30', '2024-06-30'], [240, 182, 95]) });
    const m = await f.run();
    assert.equal(m.results[0].status, 'ok'); assert.equal(m.n_stale_quarter_newer, 1);
    assert.equal(m.n_stale_quarter_still_old_yahoo, 0);
  });
  await check('B pullAll: Yahoo still without a newer fiscal year -> still-old, clock advances a week', async () => {
    const f = fixture({ snapshots: [annualOnly('OLD', ['2025-06-30', '2024-06-30'], [182, 95])], quarterEmpty: true,
      annualResponses: annualRows(['2025-06-30', '2024-06-30'], [182, 95]) });
    const m = await f.run();
    assert.equal(m.results[0].status, 'ok'); assert.equal(m.n_stale_quarter_newer, 0);
    assert.equal(m.n_stale_quarter_still_old_yahoo, 1);
    assert.equal(R.fetchClock(f.stored('OLD'), null, NOW).at, new Date(NOW).toISOString());
  });

  console.log(`annual-newer-year.test.js: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
