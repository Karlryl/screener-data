'use strict';
// Tag 1391 (Diagnose 30.09.2026): (A) a strictly newer fiscal year that only the losing annual
// bundle carries is kept, never a zero, never an undated or unproven year; (B) companies without
// a quarterly series enter the stale reload when their newest annual year is old or undated.
// Real exported functions; pullAll runs on the virtual files and fake Yahoo of
// stale-quarter-reload.test.js. No network, no live file is read or written.
const assert = require('node:assert/strict');
const path = require('path');
const Y = require('../pull-yahoo.js');
const R = require('../lib/stale-quarter-reload.js');
const axes = require('../src/scoring/axes.js');
const { fixture, snapshot, NOW } = require('./stale-quarter-reload.test.js');
const root = path.resolve(__dirname, '..');
const cells = a => a.map(x => (x == null ? null : { value: x }));
const vals = a => (a || []).map(x => x?.value ?? x ?? null);
const desc = (end, o = {}) => ({ end, duration: '12M', currency: 'AUD', unit: 'currency', basis: 'yahoo-statement', ...o });
const FTS_ENDS = ['2025-06-30', '2024-06-30', '2023-06-30', '2022-06-30'];

// SKS.AX as Yahoo served it on 30.09.2026: quoteSummary FY26, FY25 and two padded zeros;
// FTS FY25..FY22 with the operating lines (FY25 261,655,010 vs 261,655,008 AUD).
function sks({ qsRev = [347927740, 261655010, 0, 0], qsEnds = ['2026-06-30', '2025-06-30', '2024-06-30', '2022-06-30'], qsPeriod = {} } = {}) {
  const qs = { annualRev: cells(qsRev), annualRevEnds: qsEnds, annualOpInc: [], annualOpIncEnds: [],
    annualGP: [null, null, null, null], annualGPEnds: qsEnds, annualNetIncome: cells([20e6, 15e6, null, null]),
    // Like _statementPeriods: an undated row still has a descriptor, with end null.
    annualNetIncomeEnds: qsEnds, annualCostOfRevenue: [], _periods: qsEnds.map(e => desc(e, qsPeriod)) };
  const fts = { annualRev: cells([261655008, 136309155, 83268128, 67288383]), annualRevEnds: FTS_ENDS,
    annualOpInc: cells([21.5e6, 7.1e6, 0.4e6, 0.7e6]), annualOpIncEnds: FTS_ENDS,
    annualGP: cells([60e6, 30e6, 20e6, 15e6]), annualGPEnds: FTS_ENDS,
    annualNetIncome: cells([14e6, 5e6, 0.2e6, 0.5e6]), annualNetIncomeEnds: FTS_ENDS,
    annualCostOfRevenue: cells([201e6, 106e6, 63e6, 52e6]), _periods: FTS_ENDS.map(e => desc(e)) };
  return { qs, fts };
}
const growth = b => axes.revAnnualYoY({ annual: { annualRev: b.annualRev, annualRevEnds: b.annualRevEnds } });

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message); }
}

(async () => {
  // ── A: presence ──────────────────────────────────────────────────────────────
  await check('A presence: QS [FY26, FY25, 0, 0] vs FTS [FY25..FY22] keeps FY26 and no zero', () => {
    const { qs, fts } = sks(), before = JSON.stringify(fts), w = Y.mergeAnnualIncomeBundle(qs, fts);
    assert.deepEqual(vals(w.annualRev), [347927740, 261655008, 136309155, 83268128, 67288383]);
    assert.deepEqual(w.annualRevEnds, ['2026-06-30', ...FTS_ENDS]);
    assert(!vals(w.annualRev).includes(0), 'a padded zero must never enter');
    for (const k of ['annualOpInc', 'annualGP', 'annualNetIncome', 'annualCostOfRevenue']) {
      assert.equal(w[k][0], null, k + ' of the adopted year stays missing, never 0');
      assert.deepEqual(vals(w[k]).slice(1), vals(fts[k]), k + ' of FY25..FY22 unchanged and aligned');
    }
    for (const k of ['annualOpIncEnds', 'annualGPEnds', 'annualNetIncomeEnds']) assert.deepEqual(w[k], w.annualRevEnds, k);
    assert.equal(w._base, fts); assert.equal(w._periodMerged, true); assert.deepEqual(w._newerYears, ['2026-06-30']);
    assert.deepEqual(w._periods.map(p => p.end), w.annualRevEnds);
    assert.equal(JSON.stringify(fts), before, 'inputs are not mutated');
    assert.equal(Math.round(growth(w) * 10000) / 100, 32.97, 'board growth FY26/FY25 (+33.0 %), not FY25/FY24');
  });
  await check('A presence: an FTS year newer than a winning quoteSummary bundle is kept the same way', () => {
    const ends = ['2025-12-31', '2024-12-31', '2023-12-31', '2022-12-31'];
    const qs = { annualRev: cells([400, 300, 200, 100]), annualRevEnds: ends, annualNetIncome: cells([4, 3, 2, 1]),
      annualNetIncomeEnds: ends, annualOpInc: [], _periods: ends.map(e => desc(e)) };
    const fEnds = ['2026-12-31', '2025-12-31', '2024-12-31'];
    // No FTS operating income: otherwise the existing period merge (missingOp) takes over.
    const fts = { annualRev: cells([500, 400, 300]), annualRevEnds: fEnds, annualNetIncome: cells([5, 4, 3]),
      annualNetIncomeEnds: fEnds, annualOpInc: [], _periods: fEnds.map(e => desc(e)) };
    const w = Y.mergeAnnualIncomeBundle(qs, fts);
    assert.equal(w._base, qs, 'quoteSummary wins on revenue count (4 vs 3) and stays the base');
    assert.deepEqual(vals(w.annualRev), [500, 400, 300, 200, 100]);
    assert.deepEqual(vals(w.annualNetIncome), [null, 4, 3, 2, 1]);
    assert.deepEqual(w.annualOpInc, [], 'an empty sibling series stays empty');
  });
  // ── A: absence ───────────────────────────────────────────────────────────────
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
  ]) {
    await check('A absence: ' + name + ' -> nothing adopted, FTS bundle returned unchanged', () => {
      const { qs, fts } = sks(opts), w = Y.mergeAnnualIncomeBundle(qs, fts);
      assert.equal(w, fts);
      assert.deepEqual(vals(w.annualRev), [261655008, 136309155, 83268128, 67288383]);
    });
  }
  await check('A tolerance: 0.49 % overlap difference still adopts (same 0.5 % rule as the conflict guard)', () => {
    const { qs, fts } = sks({ qsRev: [347927740, Math.round(261655008 * 1.0049), 0, 0] });
    assert.deepEqual(Y.mergeAnnualIncomeBundle(qs, fts)._newerYears, ['2026-06-30']);
  });
  await check('A absence: undated kept bundle (legacy cache without ends) adopts nothing', () => {
    const { qs, fts } = sks(); fts.annualRevEnds = [null, null, null, null];
    assert.equal(Y.mergeAnnualIncomeBundle(qs, fts), fts);
  });
  await check('A absence: partly dated kept bundle adopts nothing', () => {
    const { qs, fts } = sks(); fts.annualRevEnds = ['2025-06-30', null, '2023-06-30', '2022-06-30'];
    assert.equal(Y.mergeAnnualIncomeBundle(qs, fts), fts);
  });
  await check('A absence: kept newest year is a stub (6 months after the year before) -> nothing adopted', () => {
    const { qs, fts } = sks({ qsRev: [120e6, 50e6, 0, 0], qsEnds: ['2026-12-31', '2025-12-31', '2024-06-30', '2022-06-30'] });
    fts.annualRevEnds = ['2025-12-31', '2025-06-30', '2024-06-30', '2023-06-30'];
    fts.annualRev = cells([50e6, 100e6, 90e6, 80e6]); fts._periods = fts.annualRevEnds.map(e => desc(e));
    for (const k of ['annualOpIncEnds', 'annualGPEnds', 'annualNetIncomeEnds']) fts[k] = fts.annualRevEnds;
    assert.equal(Y.mergeAnnualIncomeBundle(qs, fts), fts, 'would publish +140 % over a half-year');
  });
  await check('A absence: overlap only on an old year, not on the kept newest year -> nothing adopted', () => {
    const { qs, fts } = sks({ qsRev: [347927740, 67288383], qsEnds: ['2026-06-30', '2022-06-30'] });
    assert.equal(Y.mergeAnnualIncomeBundle(qs, fts), fts);
  });
  await check('A absence: a sign flip in a shared year is a conflict, not padding', () => {
    const { qs, fts } = sks({ qsRev: [347927740, 261655010, -136309155, 0] });
    assert.equal(Y.mergeAnnualIncomeBundle(qs, fts), fts);
  });
  await check('A absence: no statement descriptors (legacy cache) adopts nothing', () => {
    const { qs, fts } = sks(); delete fts._periods;
    assert.equal(Y.mergeAnnualIncomeBundle(qs, fts), fts);
  });

  // ── A: the real pullAll call site ────────────────────────────────────────────
  await check('A pullAll: adopted year lands dated; side series align by date; provenance follows FTS', async () => {
    const fin = FTS_ENDS.slice().reverse().map((date, i) => ({ date, periodType: '12M',
      totalRevenue: [67288383, 83268128, 136309155, 261655008][i], operatingIncome: 1e6 + i, grossProfit: 10e6 + i,
      netIncome: 5e5 + i, costOfRevenue: 50e6 + i, sellingGeneralAndAdministration: 3e6 + i }));
    const cash = FTS_ENDS.slice().reverse().map((date, i) => ({ date, periodType: '12M', operatingCashFlow: 20e6 + i,
      freeCashFlow: 15e6 + i, stockBasedCompensation: 1e5 + i }));
    const bal = FTS_ENDS.slice().reverse().map((date, i) => ({ date, periodType: 'instant', totalAssets: 1e9 + i,
      currentAssets: 2e8 + i, currentLiabilities: 1e8, totalDebt: 5e7 }));
    // quoteSummary: FY26 + FY25, padded zeros, and an all-zero gross profit (FN-4 zero coding).
    const history = [['2026-06-30', 347927740], ['2025-06-30', 261655010], ['2024-06-30', 0], ['2022-06-30', 0]]
      .map(([endDate, totalRevenue]) => ({ endDate, totalRevenue, grossProfit: 0, netIncome: totalRevenue ? 9e6 : null }));
    const f = fixture({ snapshots: [snapshot('OLD', '2026-06-30')], manual: ['OLD'],
      annualResponses: { financials: fin, 'cash-flow': cash, 'balance-sheet': bal },
      summaryResponse: { price: { currency: 'USD', marketCap: 1e12, regularMarketPrice: 100 },
        financialData: { financialCurrency: 'USD' }, quoteType: { quoteType: 'EQUITY' },
        incomeStatementHistory: { incomeStatementHistory: history } } });
    f.files.delete(path.join(root, 'fundamentals-cache', 'OLD.json'));
    const m = await f.run(); assert.equal(m.results[0].status, 'ok');
    const s = f.stored('OLD'), a = s.annual;
    assert.deepEqual(a.annualRevEnds, ['2026-06-30', ...FTS_ENDS]);
    assert.deepEqual(vals(a.annualRev), [347927740, 261655008, 136309155, 83268128, 67288383]);
    assert.equal(a.annualOpInc[0], null); assert.equal(vals(a.annualOpInc)[1], 1e6 + 3);
    assert.equal(a.annualNetIncome[0], null, 'quoteSummary net income of FY26 is not carried over');
    assert.equal(a.annualSBC[0], null); assert.equal(a.annualSBC[1], 1e5 + 3, 'cash side aligned by date, FY25 at index 1');
    assert.equal(a.annualOCF[0], null); assert.equal(vals(a.annualOCF)[1], 20e6 + 3);
    assert.equal(a.annualBalance[0], null); assert.equal(a.annualBalance[1].totalAssets, 1e9 + 3);
    assert.deepEqual(s.meta.annualRevNewerYears, { ends: ['2026-06-30'], source: 'quoteSummary' });
    assert.equal(s.meta.statementPeriods.annualRev[0].end, '2026-06-30');
    assert.equal(s.meta.opIncSource, 'yahoo-adjusted');
    assert.equal(s.meta.gpZeroCodingNulled, false, 'zero-coding marker follows the stored (FTS) gross profit');
    assert.equal(s.meta.annualIncomeGapReason, undefined, 'padded zeros are no revenue-basis conflict next to an adoption');
    assert.equal(s.meta.annualIncomeConflicts, undefined);
    assert.equal(s.meta.annualAlignDropped, undefined, 'nothing outside the income window here');
  });
  await check('A pullAll: a side-series year outside the income window is named, not dropped silently', async () => {
    // FTS FY22 has cash flow but no income line: mapFTSToAnnual trims it from the income window.
    const fin = FTS_ENDS.slice().reverse().map((date, i) => (i === 0 ? { date, periodType: '12M' } : { date, periodType: '12M',
      totalRevenue: [0, 83268128, 136309155, 261655008][i], operatingIncome: 1e6 + i, grossProfit: 10e6 + i, netIncome: 5e5 + i }));
    const cash = FTS_ENDS.slice().reverse().map((date, i) => ({ date, periodType: '12M', operatingCashFlow: 20e6 + i, freeCashFlow: 15e6 + i }));
    const history = [['2026-06-30', 347927740], ['2025-06-30', 261655010]].map(([endDate, totalRevenue]) => ({ endDate, totalRevenue }));
    const f = fixture({ snapshots: [snapshot('OLD', '2026-06-30')], manual: ['OLD'],
      annualResponses: { financials: fin, 'cash-flow': cash, 'balance-sheet': [] },
      summaryResponse: { price: { currency: 'USD', marketCap: 1e12, regularMarketPrice: 100 },
        financialData: { financialCurrency: 'USD' }, quoteType: { quoteType: 'EQUITY' },
        incomeStatementHistory: { incomeStatementHistory: history } } });
    f.files.delete(path.join(root, 'fundamentals-cache', 'OLD.json'));
    assert.equal((await f.run()).results[0].status, 'ok');
    const s = f.stored('OLD');
    assert.deepEqual(s.annual.annualRevEnds, ['2026-06-30', '2025-06-30', '2024-06-30', '2023-06-30']);
    assert(s.meta.annualAlignDropped.some(d => d.field === 'annualOCF' && d.end === '2022-06-30'));
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
  await check('B ordering: board rank first, then stale quarters before annual rows; undated ends sort without error', () => {
    const snaps = [snapshot('QTR'), annualOnly('UND', null), annualOnly('ANN', ['2025-06-30']), annualOnly('TOP', ['2025-06-30'])];
    const f = fixture({ snapshots: snaps });
    const p = R.planReload(snaps.map(s => ({ ticker: s.meta.ticker })), { snapshotDir: f.out, now: NOW,
      config: f.config, io: f.io, ranks: { TOP: 1 } });
    assert.deepEqual(p.selected.map(r => r.ticker), ['TOP', 'QTR', 'UND', 'ANN']);
    assert.deepEqual(p.selected.map(r => r.basis), ['annual', 'quarter', 'annual', 'annual']);
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
