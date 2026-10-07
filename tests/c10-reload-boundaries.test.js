'use strict';
// Actual pullAll/mapper with virtual files and clock. No writing test is a mutation target.
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
if (process.env.C10_HISTORY_COPY) require.cache[require.resolve('../lib/reload-history.js')] = { exports: require(process.env.C10_HISTORY_COPY) };
const history = require('../lib/reload-history.js');
let coverage = require('../scripts/coverage-gate.js');
if (process.env.C10_COVERAGE_COPY) {
  const Module = require('module'), filename = path.join(root, 'scripts/coverage-gate.js');
  const copied = new Module(filename, module); copied.filename = filename; copied.paths = module.paths;
  copied._compile(fs.readFileSync(process.env.C10_COVERAGE_COPY, 'utf8'), filename); coverage = copied.exports;
}
const { fixture: makeFixture, snapshot, NOW } = require('./stale-quarter-reload.test.js');
const { baseline, rows } = require('./reload-keep-history.test.js');
const override = process.env.C10_PULL_COPY ? fs.readFileSync(process.env.C10_PULL_COPY, 'utf8') : null;
const fixture = opts => makeFixture({ ...opts, ...(override ? { pullSource: override } : {}) });
const cp = path.join(root, 'fundamentals-cache/OLD.json');
const vals = a => a.map(x => x?.value ?? x);
const clone = x => JSON.parse(JSON.stringify(x));
const cases = {};

cases['ordinary-failures'] = async () => {
  for (const mode of ['manual', 'old', 'schema', 'currency']) for (const failure of ['annualFails', 'quarterFails']) {
    const s = await baseline();
    if (mode === 'old') s.meta.asOf = '2026-09-01T03:00:00Z';
    if (mode === 'schema') s.annual.annualBalance = [{}];
    if (mode === 'currency') { s.meta.reportingCurrency = 'EUR'; delete s.meta.reportingCurrencyOriginal; delete s.meta.fxConverted; }
    const f = fixture({ snapshots: [s], annualResponses: rows(), [failure]: failure === 'annualFails' ? 'balance-sheet' : true,
      manual: mode === 'manual' ? ['OLD'] : [] });
    f.files.delete(cp);
    const m = await f.run();
    // P137: ordinary full pull now protects against a lost reporting period
    if ((mode === 'manual' || mode === 'old') && failure === 'quarterFails') {
      assert.equal(m.results[0].status, 'price-only', mode + '/' + failure);
      assert.deepEqual(f.stored('OLD').annual, s.annual); assert.deepEqual(f.stored('OLD').timeseries, s.timeseries);
      assert.equal(m.n_full_period_regression_blocked, 1);
      // The selected provider attempt keeps its existing diagnostics; this is not a reload fallback.
      for (const key of ['selected', 'pulled', 'fetch_failed']) assert.equal(m['n_stale_quarter_' + key], 1);
      for (const key of ['newer', 'still_old_yahoo']) assert.equal(m['n_stale_quarter_' + key], 0);
    } else assert.equal(m.results[0].status, 'ok', mode + '/' + failure);
    assert.equal(f.stored('OLD').meta.asOf, new Date(NOW).toISOString());
    assert.equal(m.n_stale_quarter_reload_failed, 0);
    assert(!f.logs.some(l => l.includes('stale-quarter-reload: reload-failed')));
  }
};
cases['window-slide'] = async () => {
  const s = await baseline();
  s.timeseries.revenueQ.push({ value: 1 }); s.timeseries.revenueQEnds.push('2025-03-31');
  const quarterlyRows = [
    { date: '2025-12-31', totalRevenue: 90, grossProfit: 30, operatingIncome: 15, netIncome: 8 },
    { date: '2026-03-31', totalRevenue: 100, grossProfit: 40, operatingIncome: 20, netIncome: 10 },
    { date: '2026-06-30', totalRevenue: 110, grossProfit: 45, operatingIncome: 25, netIncome: 12 },
  ];
  const f = fixture({ snapshots: [s], annualResponses: rows(), quarterlyRows });
  const before = f.files.get(cp).toString(), m = await f.run();
  assert.equal(m.results[0].status, 'ok'); assert.equal(m.n_stale_quarter_reload_failed, 0);
  assert.deepEqual(vals(f.stored('OLD').timeseries.revenueQ), [110, 100, 90]);
  assert.notEqual(f.files.get(cp).toString(), before, 'legitimate cache window slide must write');
};
cases['manual-shared-loss'] = async () => {
  const s = await baseline(), a = rows();
  a.financials[2].totalRevenue = 777; delete a.financials[2].operatingIncome;
  const f = fixture({ snapshots: [s], annualResponses: a, manual: ['OLD'] }); f.files.delete(cp);
  const m = await f.run(), out = f.stored('OLD');
  assert.equal(m.results[0].status, 'ok'); assert.equal(out.annual.annualRev[1].value, 777);
  assert.equal(out.annual.annualOpInc[1], null);
  assert(!f.logs.some(l => l.includes('stale-quarter-reload: reload-failed')));
};
cases['year-roll'] = async () => {
  const s = await baseline(), a = rows();
  for (const group of Object.values(a)) {
    group.shift(); group.push({ ...group.at(-1), date: '2026-12-31', totalRevenue: 104, operatingIncome: null });
  }
  // Use a reported fiscal year within the test clock, not a future-dated statement.
  for (const group of Object.values(a)) group.at(-1).date = '2026-06-30';
  const f = fixture({ snapshots: [s], annualResponses: a }), m = await f.run(), out = f.stored('OLD');
  assert.equal(m.results[0].status, 'ok'); assert.equal(out.annual.annualRev[0].value, 104);
  assert.equal(out.annual.annualRevEnds[0], '2026-06-30'); assert.equal(out.annual.annualOpInc[0], null);
  assert.equal(out.annual.annualOpInc.filter(x => x?.value != null).length, 3);
  assert.equal(out.meta.asOf, new Date(NOW).toISOString());
};
cases['shrink-with-new-values'] = async () => {
  const s = await baseline(), a = rows();
  a.financials.push({ ...a.financials.at(-1), date: '2026-06-30', totalRevenue: 200, operatingIncome: 30 });
  a['cash-flow'].shift();
  const f = fixture({ snapshots: [s], annualResponses: a });
  assert.equal((await f.run()).results[0].status, 'ok');
  assert.equal(f.stored('OLD').annual.annualRev.length, 5);
  assert.equal(f.stored('OLD').annual.annualFCF.length, 3);
  assert.equal(f.stored('OLD').annual.annualRev[0].value, 200);
};
for (const shape of ['newest-quarter-only', 'newest-year-only', 'middle-year-missing']) {
  cases[shape] = async () => {
    for (const manual of [false, true]) {
      const s = await baseline(), a = rows();
      const options = { snapshots: [s], annualResponses: a, manual: manual ? ['OLD'] : [], quotePrice: 123, quoteMarketCap: 2e12 };
      if (shape === 'newest-quarter-only') {
        const dates = ['2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30', '2025-03-31'];
        for (const field of ['revenueQ', 'grossProfitQ', 'opIncQ', 'netIncomeQ']) {
          s.timeseries[field] = dates.map((_, i) => ({ value: 100 - i }));
          if (field !== 'netIncomeQ') s.timeseries[field + 'Ends'] = dates.slice();
        }
        options.quarterlyRows = [{ date: '2026-06-30', totalRevenue: 120, grossProfit: 40, operatingIncome: 20, netIncome: 10 }];
      } else for (const key of Object.keys(a)) {
        if (shape === 'newest-year-only') a[key] = a[key].slice(-1);
        else a[key].splice(1, 1);
      }
      const f = fixture(options);
      if (manual) f.files.delete(cp); // Exercise the provider answer, not the ordinary warm-cache path.
      const cache = f.files.get(cp)?.toString(), m = await f.run(), out = f.stored('OLD');
      assert.equal(m.results[0].status, manual ? 'ok' : 'reload-retained');
      assert.equal(m.n_stale_quarter_reload_failed, manual ? 0 : 1);
      if (manual) {
        assert.equal(shape === 'newest-quarter-only' ? out.timeseries.revenueQ.length : out.annual.annualRev.length,
          shape === 'middle-year-missing' ? 3 : 1, 'Ordinary full pulls keep their existing behavior');
        assert(f.files.has(cp));
      } else {
        assert.deepEqual(out.annual, s.annual); assert.deepEqual(out.timeseries, s.timeseries);
        for (const key of ['fetchedAt', 'fundamentalsAsOf', 'fundamentalsTimeseriesFetchedAt']) assert.equal(out.meta[key], s.meta[key]);
        assert.equal(out.meta.reloadHistoryArchive, s.meta.reloadHistoryArchive);
        assert.equal(out.price.regularMarketPrice, 123); assert.equal(out.marketCap.value, 2e12);
        assert.equal(f.files.get(cp).toString(), cache);
      }
      assert.equal(out.meta.asOf, new Date(NOW).toISOString());
    }
  };
}
cases['shared-loss-price-refresh'] = async () => {
  const s = await baseline(), a = rows();
  a.financials[2].totalRevenue = 777; delete a.financials[2].operatingIncome;
  a.financials.push({ ...a.financials.at(-1), date: '2026-06-30', totalRevenue: 200, operatingIncome: 30 });
  const f = fixture({ snapshots: [s], annualResponses: a, quotePrice: 123, quoteMarketCap: 2e12 });
  const cache = f.files.get(cp).toString(), m = await f.run(), out = f.stored('OLD');
  assert.equal(m.results[0].status, 'reload-retained');
  assert.equal(m.n_stale_quarter_reload_failed, 1);
  assert.equal(m.results[0].fundamentalsRetainedReason, 'shared-period fundamentals missing');
  assert.deepEqual(out.annual, s.annual); assert.deepEqual(out.timeseries, s.timeseries);
  for (const k of ['fetchedAt', 'fundamentalsAsOf', 'fundamentalsTimeseriesFetchedAt']) assert.equal(out.meta[k], s.meta[k]);
  assert.equal(out.price?.regularMarketPrice, 123); assert.equal(out.marketCap.value, 2e12);
  assert.equal(out.meta.asOf, new Date(NOW).toISOString()); assert.equal(f.files.get(cp).toString(), cache);
  const full = JSON.parse(f.files.get(path.join(f.out, '_manifest-full.json')));
  assert.equal(full.results[0].quarterReload.cause, 'shared-period fundamentals missing');
  const slim = JSON.parse(f.files.get(path.join(f.out, '_manifest.json')));
  for (const manifest of [slim, require('../scripts/merge-shard-manifests.js').mergeManifests([slim], 1, 1)]) {
    assert.equal(manifest.n_retained, 1); assert.equal(manifest.n_priceonly, 0);
    assert.equal(manifest.n_full, 0); assert.equal(manifest.n_ok, 1);
    assert.equal(coverage.manifestNumbersSane(manifest, 1), true);
    const marker = coverage.buildMarker(coverage.classify(manifest, 1, 1), manifest);
    assert.equal(marker.n_retained, 1); assert.deepEqual(coverage.validateMarker(marker), []);
  }
};
cases['revenue-conflict'] = async () => {
  const f = fixture(), periods = ['2025-12-31', '2024-12-31', '2023-12-31', '2022-12-31'];
  const descriptor = end => ({ end, duration: '12M', currency: 'USD', unit: 'currency', basis: 'reported' });
  const qs = { annualRev: [2000, 1000, 800, 700], annualRevEnds: periods, annualOpInc: [], _periods: periods.map(descriptor) };
  for (const delta of [5, 5.01]) {
    const other = { ...qs, annualRev: [null, 1000 + delta, 800, 700], annualOpInc: [null, 10, 8, 7] };
    const winner = f.Y.mergeAnnualIncomeBundle(qs, other);
    if (delta === 5) assert.equal(winner.annualOpInc.filter(Number.isFinite).length, 3);
    else { assert.equal(winner, qs); assert.deepEqual(winner.annualRev, qs.annualRev); }
  }
};
cases['coverage-retained'] = async () => {
  const m = { n_total: 10000, n_ok: 9000, n_full: 400, n_priceonly: 8500, n_retained: 100, n_failed: 0, partial: false };
  assert.equal(coverage.manifestNumbersSane(m, 10000), true);
  const marker = coverage.buildMarker(coverage.classify(m, 10000, 9000), m);
  assert.equal(marker.n_retained, 100); assert.deepEqual(coverage.validateMarker(marker), []);
  for (const bad of [-1, 101, '100', Infinity]) {
    assert.equal(coverage.manifestNumbersSane({ ...m, n_retained: bad }, 10000), false);
    assert(coverage.validateMarker({ ...marker, n_retained: bad }).length > 0);
  }
  assert.equal(coverage.manifestNumbersSane({ ...m, n_priceonly: 8600, n_retained: undefined }), true);
  assert.equal(coverage.manifestNumbersSane({ n_total: 10000, n_ok: 9000, n_retained: 999999 }), false);
  assert(coverage.validateMarker({ ...marker, n_full: null, n_priceonly: null, n_retained: 999999 }).length > 0);
};
cases['annual-period-regression'] = async () => {
  const old = await baseline(), a = rows();
  for (const group of Object.values(a)) for (const r of group) r.date = String(Number(r.date.slice(0, 4)) - 1) + r.date.slice(4);
  const f = fixture({ snapshots: [old], annualResponses: a, quotePrice: 123 }), cache = f.files.get(cp).toString();
  assert.equal((await f.run()).results[0].status, 'reload-retained');
  assert.deepEqual(f.stored('OLD').annual.annualRevEnds, old.annual.annualRevEnds);
  assert.equal(f.stored('OLD').price?.regularMarketPrice, 123); assert.equal(f.files.get(cp).toString(), cache);
};
cases['trimmed-quarter-cache-ni'] = async () => {
  const old = await baseline();
  const quarterlyRows = [
    { date: '2025-12-31', totalRevenue: 90, grossProfit: 30, operatingIncome: 15, netIncome: 8 },
    { date: '2026-03-31', totalRevenue: 100, grossProfit: 40, operatingIncome: 20 },
    { date: '2026-06-30' },
  ];
  const f = fixture({ snapshots: [old], annualResponses: rows(), quarterlyRows }), before = f.files.get(cp).toString();
  assert.equal((await f.run()).results[0].status, 'ok');
  assert.deepEqual(vals(f.stored('OLD').timeseries.netIncomeQ), [10, 8]);
  assert.equal(f.files.get(cp).toString(), before, 'trimmed empty lead must not hide shared NI loss');
};
cases['empty-annual-scope'] = async () => {
  for (const manual of [false, true]) {
    const old = await baseline(), f = fixture({ snapshots: [old], annualEmpty: true, manual: manual ? ['OLD'] : [] }); f.files.delete(cp);
    const m = await f.run();
    // P137: ordinary full pull now protects against a lost reporting period
    assert.equal(m.results[0].status, manual ? 'price-only' : 'reload-retained');
    if (!manual) assert.deepEqual(f.stored('OLD').annual, old.annual);
    else { assert.deepEqual(f.stored('OLD').annual, old.annual); assert.equal(m.n_full_period_regression_blocked, 1); }
  }
};
cases['archive-bounded'] = async () => {
  const old = await baseline(), next = clone(old);
  old.annual.annualSGA.push(999); old.annual.annualSGAEnds.push('2010-12-31');
  old.meta.reloadHistoryArchive = [2008, 2009].map(y => ({ field: 'annualSGA', end: y + '-12-31', value: y }));
  history.preserveReloadHistory(next, old, { archiveLimit: 2 });
  assert.equal(next.meta.reloadHistoryArchive.length, 2);
  assert.equal(next.meta.reloadHistoryArchive.at(-1).value, 999);
  const zero = clone(old); history.preserveReloadHistory(zero, old, { archiveLimit: 0 }); assert.equal(zero.meta.reloadHistoryArchive, undefined);
};
cases['archive-no-noise'] = async () => {
  const old = await baseline(), next = clone(old);
  delete old.annual.annualSGAEnds; old.annual.annualSGA.push(999);
  old.annual.annualBalanceEnds = old.annual.annualBalanceEnds.map(end => '2010' + end.slice(4));
  history.preserveReloadHistory(next, old);
  assert.equal(next.meta.reloadHistoryArchive, undefined);
};
cases['fx-rate-is-intentional'] = async () => {
  const old = await baseline(), next = clone(old);
  next.annual.annualSGA[1] = null; next.meta.fxRateApplied = 2;
  history.preserveReloadHistory(next, old);
  assert.equal(next.annual.annualSGA[1], null);
  assert(next.meta.reloadHistoryGaps.some(g => g.field === 'annualSGA' && g.reason === 'statement-basis-unverified'));
};
cases['warn-only-unsafe'] = async () => {
  for (const unsafe of [false, true]) {
    const old = await baseline(), a = rows(); delete a.financials[1].sellingGeneralAndAdministration;
    if (unsafe) old.meta.statementPeriods.annualSGA[2].basis = 'other-statement';
    else old.annual.annualSGA[2] = null;
    const f = fixture({ snapshots: [old], annualResponses: a }); await f.run();
    assert.equal(f.logs.some(l => /\[WARN\].*Historische Werte/.test(l)), unsafe);
  }
};
cases['cache-shared-periods'] = async () => {
  const pack = (ends, values) => ({ ftsAnnual: { annualRev: values, annualRevEnds: ends } });
  const old = pack(['2025-12-31', '2024-12-31', '2023-12-31'], [3, 2, 1]);
  assert.equal(history.cacheIsThinner(pack(['2025-12-31', '2024-12-31'], [3, 2]), old), false);
  assert.equal(history.cacheIsThinner(pack(['2026-06-30', '2025-12-31', '2024-12-31'], [null, 3, 2]), old), false);
  assert.equal(history.cacheIsThinner(pack(['2026-06-30', '2025-12-31', '2024-12-31', '2023-12-31'], [4, null, 2, 1]), old), true);
  assert.equal(history.cacheIsThinner(pack([], []), { ftsAnnual: { annualRev: [1, 2, 3] } }), false);
  const oldSide = { ftsAnnualSGA: [3, 2, 1], ftsPeriods: { income: old.ftsAnnual.annualRevEnds.map(end => ({ end })) } };
  assert.equal(history.cacheIsThinner({ ftsAnnualSGA: [null, 2, 1], ftsPeriods: oldSide.ftsPeriods }, oldSide), true);
};

async function main() {
  let passed = 0;
  for (const [name, run] of Object.entries(cases)) {
    if (process.env.C10_CASE && process.env.C10_CASE !== name) continue;
    await run(); passed++; console.log('PASS ' + name);
  }
  assert(passed > 0); console.log(`c10-reload-boundaries.test.js: ${passed} passed, 0 failed`);
}
if (require.main === module) main().catch(e => { console.error(e.stack); process.exitCode = 1; });
module.exports = { cases, main };
