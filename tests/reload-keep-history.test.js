'use strict';
// Actual pullAll, mapper and cache writer; all provider / filesystem effects are virtual.
// Break-once targets are copied production source, never a writing test or live data.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { fixture, snapshot, NOW } = require('./stale-quarter-reload.test.js');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'pull-yahoo.js'), 'utf8');
const dates = ['2025-12-31', '2024-12-31', '2023-12-31', '2022-12-31'];
const count = a => (a || []).filter(v => Number.isFinite(v?.value ?? v)).length;
const values = a => a.map(v => v?.value ?? v);
const clone = x => JSON.parse(JSON.stringify(x));
function rows() {
  return Object.fromEntries(['financials', 'cash-flow', 'balance-sheet'].map(k => [k, dates.slice().reverse().map((date, i) => ({
    date, periodType: k === 'balance-sheet' ? 'instant' : '12M', totalRevenue: 100 + i,
    operatingIncome: 10 + i, grossProfit: 30 + i, netIncome: 5 + i,
    operatingCashFlow: 20 + i, freeCashFlow: 15 + i, sellingGeneralAndAdministration: 8 + i,
    totalAssets: 1000 + i, currentAssets: 200 + i, currentLiabilities: 100,
  }))]));
}
async function baseline() {
  const f = fixture({ annualResponses: rows() });
  const m = await f.run(); assert.equal(m.results[0].status, 'ok');
  const s = f.stored('OLD');
  s.meta.asOf = '2026-09-26T03:00:00Z';
  s.meta.fundamentalsAsOf = s.meta.fetchedAt = s.meta.fundamentalsTimeseriesFetchedAt = '2026-09-20T02:17:00Z';
  for (const series of Object.values(s.meta.statementPeriods)) for (const p of series) if (p) p.fetchedAt = s.meta.fetchedAt;
  // Keep the old quarter eligible for the next selected reload.
  s.timeseries.revenueQEnds[0] = s.timeseries.grossProfitQEnds[0] = s.timeseries.opIncQEnds[0] = '2026-03-31';
  for (const field of ['revenueQ', 'grossProfitQ', 'opIncQ', 'netIncomeQ']) s.meta.statementPeriods[field][0].end = '2026-03-31';
  return s;
}
async function accepted(sourceOverride = source) {
  const s = await baseline(), f = fixture({ snapshots: [s], annualResponses: rows(), pullSource: sourceOverride });
  const m = await f.run(); assert.equal(m.results[0].status, 'ok');
  assert.deepEqual(f.stored('OLD').annual.annualRevEnds, dates);
  assert.deepEqual(values(f.stored('OLD').annual.annualRev), values(s.annual.annualRev));
  return f;
}
async function rejected(sourceOverride = source) {
  const s = await baseline(), thin = rows();
  thin.financials[2].totalRevenue = 777; delete thin.financials[2].operatingIncome;
  const f = fixture({ snapshots: [s], annualResponses: thin, pullSource: sourceOverride, quotePrice: 123, quoteMarketCap: 2e12 });
  const sp = path.join(f.out, 'OLD.json'), cp = path.join(root, 'fundamentals-cache/OLD.json');
  const before = [f.files.get(sp).toString(), f.files.get(cp).toString()];
  const m = await f.run(); assert.equal(m.results[0].status, 'reload-retained');
  assert.equal(f.files.get(cp).toString(), before[1], 'rejected answer poisoned cache');
  const out = f.stored('OLD');
  assert.deepEqual(out.annual, s.annual); assert.deepEqual(out.timeseries, s.timeseries);
  assert.equal(out.meta.fundamentalsAsOf, s.meta.fundamentalsAsOf); assert.equal(out.meta.fundamentalsTimeseriesFetchedAt, s.meta.fundamentalsTimeseriesFetchedAt);
  assert.equal(out.price.regularMarketPrice, 123); assert.equal(out.marketCap.value, 2e12); assert.equal(out.meta.asOf, new Date(NOW).toISOString());
  assert.equal(m.results[0].fundamentalsRetainedReason, 'shared-period fundamentals missing');
  const slim = JSON.parse(f.files.get(path.join(f.out, '_manifest.json')));
  const merged = require('../scripts/merge-shard-manifests.js').mergeManifests([slim], 1, 1);
  assert.equal(merged.n_retained, 1); assert.equal(merged.n_ok, 1);
  assert.equal(merged.n_full, 0); assert.equal(merged.n_priceonly, 0);
  return f;
}
async function bundle(sourceOverride = source, conflict = false) {
  const a = rows();
  a.financials[a.financials.length - 1] = { date: dates[0], periodType: '12M' };
  const history = dates.map((endDate, i) => ({ endDate, totalRevenue: 103 - i + (conflict && i === 1 ? 7 : 0), netIncome: 8 - i }));
  const f = fixture({ annualResponses: a, pullSource: sourceOverride,
    summaryResponse: { price: { currency: 'USD', marketCap: 1e12, regularMarketPrice: 100 },
      financialData: { financialCurrency: 'USD' }, quoteType: { quoteType: 'EQUITY' },
      incomeStatementHistory: { incomeStatementHistory: history } } });
  const m = await f.run(); assert.equal(m.results[0].status, 'ok');
  const s = f.stored('OLD');
  assert.equal(count(s.annual.annualOpInc), conflict ? 0 : 3, 'conflicting revenue bases must not mix');
  assert.equal(s.annual.annualOpInc[0] ?? null, null, 'old operating income must not become current');
  assert.equal(s.annual.annualRev[0].value, 103, 'newest complete QS row retained');
  assert.equal(s.annual.annualRev[1].value, conflict ? 109 : 102, 'main winner retained on revenue conflict');
  if (!conflict) assert.equal(s.annual.annualOpInc[1].value, 12);
  if (conflict) { assert.equal(s.meta.annualIncomeConflicts[0].end, dates[1]); assert.equal(s.meta.annualIncomeGapReason, 'conflicting-revenue-basis'); }
  return f;
}
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
async function main() {
  await check('accepted reload retains four annual dates', accepted);
  await check('history metadata must not create a new net-income scoring date lane', async () => {
    const f = await accepted(), s = f.stored('OLD');
    assert.equal(s.timeseries.netIncomeQEnds, undefined);
    assert.deepEqual(require('../src/scoring/snapshot.js').periodEnds(s, 'netIncomeQ'), s.timeseries.netIncomeQ.map(() => null));
    assert(s.meta.statementPeriods.netIncomeQ.some(p => p?.end));
  });
  await check('late rejected reload preserves fundamentals and cache, refreshes price and cap', rejected);
  await check('OVH-like answer retains operating income', () => bundle());
  await check('SMIN-like conflicting revenue retains main winner + visible missing income', () => bundle(source, true));
  await check('merged income cannot promote older balance/cash-flow values to newest year', async () => {
    const a = rows(); a['cash-flow'] = a['cash-flow'].slice(0, 2); a['balance-sheet'] = a['balance-sheet'].slice(0, 2);
    a.financials[3] = { date: dates[0] };
    const f = fixture({ annualResponses: a, summaryResponse: {
      price: { currency: 'USD', marketCap: 1e12 }, financialData: { financialCurrency: 'USD' },
      incomeStatementHistory: { incomeStatementHistory: dates.map((endDate, i) => ({ endDate, totalRevenue: 103 - i })) },
    } });
    assert.equal((await f.run()).results[0].status, 'ok'); const s = f.stored('OLD');
    assert.equal(s.annual.annualBalance[0], null); assert.equal(s.annual.annualBalance[1], null);
    assert.equal(s.annual.annualBalance[2].totalAssets, 1001);
    assert.equal(s.annual.annualOCF[0], null); assert.equal(s.annual.annualOCF[2].value, 21);
  });
  await check('same-period holes keep original timestamp; new reported zero wins', async () => {
    const s = await baseline(), a = rows();
    delete a.financials[1].sellingGeneralAndAdministration;
    a.financials[2].sellingGeneralAndAdministration = 0;
    const f = fixture({ snapshots: [s], annualResponses: a }); assert.equal((await f.run()).results[0].status, 'ok');
    const out = f.stored('OLD');
    assert.equal(out.annual.annualSGA[2], 9);
    assert.equal(out.annual.annualSGA[1], 0);
    assert.equal(out.meta.reloadHistoryRetained.find(r => r.field === 'annualSGA').fetchedAt, s.meta.fetchedAt);
    assert.equal(out.meta.statementPeriods.annualSGA[2].fetchedAt, s.meta.fetchedAt);
  });
  for (const revised of [false, true]) await check('quarterly same-period hole, revised=' + revised, async () => {
    const s = await baseline();
    const quarterlyRows = [
      { date: '2025-12-31', totalRevenue: 90, grossProfit: 30, operatingIncome: 15, netIncome: 8 },
      { date: '2026-03-31', totalRevenue: revised ? 111 : 100, operatingIncome: 20, netIncome: 10 },
      { date: '2026-06-30', totalRevenue: 120, grossProfit: 48, operatingIncome: 24, netIncome: 12 },
    ];
    const f = fixture({ snapshots: [s], annualResponses: rows(), quarterlyRows, manual: revised ? ['OLD'] : [] });
    f.files.delete(path.join(root, 'fundamentals-cache/OLD.json'));
    assert.equal((await f.run()).results[0].status, 'ok'); const out = f.stored('OLD');
    assert.equal(out.timeseries.grossProfitQ[1]?.value ?? null, revised ? null : 40);
    assert.equal(out.timeseries.revenueQ[1].value, revised ? 111 : 100);
    if (!revised) assert.equal(out.meta.statementPeriods.grossProfitQ[1].fetchedAt, s.meta.fetchedAt);
  });
  await check('accepted revision cannot revert through an older cache on the next full pull', async () => {
    const s = await baseline(), a = rows();
    a.financials[2].totalRevenue = 777; delete a.financials[1].sellingGeneralAndAdministration;
    const f = fixture({ snapshots: [s], annualResponses: a }), cp = path.join(root, 'fundamentals-cache/OLD.json');
    const cache = JSON.parse(f.files.get(cp)); cache.payload.ftsQuarterlyNI = s.timeseries.netIncomeQ.map(v => v?.value ?? v);
    f.files.set(cp, Buffer.from(JSON.stringify(cache))); await f.run();
    assert.equal(f.stored('OLD').annual.annualRev[1].value, 777);
    assert.equal(f.files.get(cp).toString(), JSON.stringify(cache), 'thinner answer must not overwrite cache');
    for (const days of [1, 8]) {
      const next = fixture({ snapshots: [f.stored('OLD')], annualResponses: a, manual: ['OLD'], now: NOW + days * 86400000 });
      next.files.set(cp, f.files.get(cp)); assert.equal((await next.run()).results[0].status, 'ok');
      assert.equal(next.stored('OLD').annual.annualRev[1].value, 777);
      assert(next.calls.some(c => c[1] === 'annual/financials'));
    }
  });
  await check('ordinary pull of a snapshot older than seven days accepts a shorter answer', async () => {
    const s = await baseline(); s.meta.asOf = '2026-09-10T03:00:00Z';
    const a = rows(); for (const k of Object.keys(a)) a[k] = a[k].slice(-1);
    const f = fixture({ snapshots: [s], annualResponses: a });
    const cp = path.join(root, 'fundamentals-cache/OLD.json'), sp = path.join(f.out, 'OLD.json');
    f.files.delete(cp); const before = f.files.get(sp).toString();
    assert.equal((await f.run()).results[0].status, 'ok');
    assert.notEqual(f.files.get(sp).toString(), before); assert(f.files.has(cp));
    assert.equal(f.stored('OLD').annual.annualRev.length, 1);
    assert(!f.logs.some(l => l.includes('stale-quarter-reload: reload-failed')));
  });
  await check('diluted-average shares cannot fill outstanding-share holes', async () => {
    const a = rows(); for (const r of a.financials) r.dilutedAverageShares = 100;
    const first = fixture({ annualResponses: a }); await first.run(); const s = first.stored('OLD');
    s.meta.fundamentalsTimeseriesFetchedAt = s.meta.fundamentalsAsOf = '2026-09-20T02:17:00Z';
    const nextRows = rows(); for (const r of nextRows['balance-sheet']) { r.ordinarySharesNumber = 200; r.periodType = '12M'; }
    delete nextRows['balance-sheet'][2].ordinarySharesNumber;
    const next = fixture({ snapshots: [s], annualResponses: nextRows, manual: ['OLD'], now: NOW + 86400000 });
    next.files.delete(path.join(root, 'fundamentals-cache/OLD.json'));
    assert.equal((await next.run()).results[0].status, 'ok');
    assert.deepEqual(next.stored('OLD').annual.annualShares, [200, null, 200, 200]);
  });
  for (const old of [false, true]) for (const period of ['annual', 'quarterly']) {
    await check(`equal-count ${period} window respects ordinary/reload scope, old=${old}`, async () => {
      const s = await baseline(), a = rows(); if (old) s.meta.asOf = '2026-09-10T03:00:00Z';
      const options = { snapshots: [s], annualResponses: a };
      if (period === 'annual') for (const group of Object.values(a)) for (const r of group) r.date = String(Number(r.date.slice(0, 4)) - 1) + r.date.slice(4);
      else options.quarterlyRows = [
        { date: '2025-09-30', totalRevenue: 90, grossProfit: 30, operatingIncome: 15, netIncome: 8 },
        { date: '2025-12-31', totalRevenue: 100, grossProfit: 40, operatingIncome: 20, netIncome: 10 },
      ];
      const f = fixture(options), cp = path.join(root, 'fundamentals-cache/OLD.json'), sp = path.join(f.out, 'OLD.json');
      f.files.delete(cp); const before = f.files.get(sp).toString();
      const rejects = !old;
      assert.equal((await f.run()).results[0].status, rejects ? 'reload-retained' : 'ok');
      assert.notEqual(f.files.get(sp).toString(), before); assert.equal(f.files.has(cp), !rejects);
      if (rejects) { assert.deepEqual(f.stored('OLD').timeseries, s.timeseries); assert.deepEqual(f.stored('OLD').annual, s.annual); }
    });
  }
  await check('missing FCF/OCF in both answers remains null with a reason', async () => {
    const s = await baseline(), a = rows(); s.annual.annualFCF[1] = s.annual.annualOCF[1] = null;
    delete a['cash-flow'][2].freeCashFlow; delete a['cash-flow'][2].operatingCashFlow;
    const f = fixture({ snapshots: [s], annualResponses: a }); await f.run(); const out = f.stored('OLD');
    for (const field of ['annualFCF', 'annualOCF']) {
      assert.equal(out.annual[field][1], null);
      assert(out.meta.reloadHistoryGaps.some(g => g.field === field && g.end === dates[1]));
    }
  });
  await check('revised period uses new value and never fills missing siblings from old basis', async () => {
    const s = await baseline(), a = rows();
    a.financials[2].totalRevenue = 777; delete a.financials[2].grossProfit;
    const f = fixture({ snapshots: [s], annualResponses: a }); assert.equal((await f.run()).results[0].status, 'ok');
    const out = f.stored('OLD'); assert.equal(out.annual.annualRev[1].value, 777);
    assert.equal(out.annual.annualGP[1], null);
    assert(out.meta.reloadHistoryGaps.some(r => r.end === dates[1] && r.reason === 'period-revised'));
  });
  await check('revised cash-flow statement cannot combine new OCF with retained old FCF', async () => {
    const s = await baseline(), a = rows();
    a['cash-flow'][2].operatingCashFlow = 777; delete a['cash-flow'][2].freeCashFlow;
    const f = fixture({ snapshots: [s], annualResponses: a });
    const before = f.files.get(path.join(f.out, 'OLD.json')).toString();
    assert.equal((await f.run()).results[0].status, 'reload-retained');
    assert.deepEqual(f.stored('OLD').annual, JSON.parse(before).annual);
  });
  await check('missing in both remains null with a reason; no old year resurrected as current', async () => {
    const s = await baseline(), a = rows();
    s.annual.annualGP[1] = null; delete a.financials[2].grossProfit;
    s.annual.annualSGA.push(999); s.annual.annualSGAEnds.push('2015-12-31');
    const f = fixture({ snapshots: [s], annualResponses: a }); await f.run(); const out = f.stored('OLD');
    assert.equal(out.annual.annualGP[1], null);
    assert(!out.annual.annualSGA.includes(999));
    assert(out.meta.reloadHistoryArchive.some(r => r.end === '2015-12-31' && r.value === 999));
    assert(out.meta.reloadHistoryGaps.some(r => r.field === 'annualGP' && r.reason === 'value-missing-in-comparable-statements'));
  });
  for (const [key, wrong] of [['duration', '6M'], ['currency', 'EUR'], ['unit', 'millions'], ['basis', 'restated']]) {
    await check('absence: incompatible ' + key + ' never fills a hole', async () => {
      const s = await baseline(), a = rows(); delete a.financials[1].sellingGeneralAndAdministration;
      s.meta.statementPeriods.annualSGA[2][key] = wrong;
      const f = fixture({ snapshots: [s], annualResponses: a }); await f.run();
      assert.equal(f.stored('OLD').annual.annualSGA[2], null);
    });
  }
  for (const [key, wrong] of [['periodType', '6M'], ['currencyCode', 'JPY'], ['unit', 'millions'], ['statementBasis', 'restated']]) {
    await check('absence: incompatible answer ' + key + ' cannot supply operating income', async () => {
      const a = rows(); a.financials[3] = { date: dates[0] };
      for (const row of a.financials) row[key] = wrong;
      const f = fixture({ annualResponses: a, summaryResponse: {
        price: { currency: 'USD', marketCap: 1e12 }, financialData: { financialCurrency: 'USD' },
        incomeStatementHistory: { incomeStatementHistory: dates.map((endDate, i) => ({ endDate, totalRevenue: 103 - i })) },
      } });
      await f.run(); assert.equal(count(f.stored('OLD').annual.annualOpInc), 0);
    });
  }
  console.log(`reload-keep-history.test.js: ${passed} passed, 0 failed`);
}
if (require.main === module) main().catch(e => { console.error(e.stack); process.exitCode = 1; });
module.exports = { accepted, rejected, bundle, baseline, rows, source, main };
