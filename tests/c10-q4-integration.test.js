'use strict';
// Real pullAll and real Q4 receipts; all snapshot/cache writes are virtual.
// Break only copied production source, never a disk-writing test or live data.
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
if (process.env.C10_Q4_HISTORY_COPY) require.cache[require.resolve('../lib/reload-history.js')] = { exports: require(process.env.C10_Q4_HISTORY_COPY) };
const { historyIsThinner, cacheIsThinner } = require('../lib/reload-history.js');
const { mergeManifests } = require('../scripts/merge-shard-manifests.js');
const { fixture, snapshot, NOW } = require('./stale-quarter-reload.test.js');
const evidence = require('./fixtures/yahoo-q4-known-cases.json');
const root = path.resolve(__dirname, '..'), sourcePath = path.join(root, 'pull-yahoo.js');
const source = fs.readFileSync(process.env.C10_Q4_PULL_COPY || sourcePath, 'utf8');
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const beforeHash = hash(sourcePath), evidenceHash = hash(path.join(__dirname, 'fixtures/yahoo-q4-known-cases.json'));
const receipt = evidence.receipts['GEST.MC'];
const options = {
  pullSource: source,
  summaryResponse: { price: { currency: 'EUR', regularMarketPrice: 5, marketCap: 1e12 }, financialData: { financialCurrency: 'EUR' },
    quoteType: { quoteType: 'EQUITY' }, summaryProfile: { sector: 'Consumer Cyclical', industry: 'Auto Parts' } },
  annualResponses: { financials: receipt.annual,
    'cash-flow': receipt.annual.map(r => ({ date: r.date, freeCashFlow: 10, operatingCashFlow: 20 })),
    'balance-sheet': receipt.annual.map(r => ({ date: r.date, totalAssets: 1000, currentAssets: 200, currentLiabilities: 100, totalDebt: 50 })) },
  quarterlyRows: receipt.quarterly.filter(r => r.date.slice(0, 10) <= '2026-03-31')
};
const val = x => typeof x === 'number' ? x : x?.value;
const cells = evidence.cells.filter(c => c.ticker === 'GEST.MC' && c.verdict === 'WRONG');
async function baseline(ticker) {
  const f = fixture({ ...options, snapshots: [snapshot(ticker)], manual: [ticker] });
  f.files.delete(path.join(root, 'fundamentals-cache', ticker + '.json'));
  assert.equal((await f.run()).results[0].status, 'ok');
  return f.stored(ticker);
}
(async () => {
  const corrected = await baseline('GEST.MC'); let passed = 0;
  for (const priorAnnual of ['same', 'missing', 'revised']) for (const descriptors of [false, true]) for (const manual of [false, true]) {
    const old = structuredClone(corrected);
    Object.assign(old.meta, { asOf: '2026-09-26T03:00:00Z', fundamentalsAsOf: '2026-09-26T03:00:00Z',
      fetchedAt: '2026-09-26T03:00:00Z', fundamentalsTimeseriesFetchedAt: '2026-09-20T02:17:00Z' });
    for (const c of cells) {
      const i = old.timeseries[c.field + 'Ends'].indexOf(c.period); assert(i >= 0);
      old.timeseries[c.field][i] = { value: c.vendorNative * old.meta.fxRateApplied };
    }
    for (const field of ['annualRev', 'annualOpInc']) {
      const i = old.annual[field + 'Ends'].indexOf('2025-12-31'); assert(i >= 0);
      old.annual[field][i] = priorAnnual === 'missing' ? null : priorAnnual === 'revised'
        ? { value: val(old.annual[field][i]) + 1e8 } : old.annual[field][i];
    }
    if (!descriptors) delete old.meta.statementPeriods;
    const original = JSON.stringify(old);
    const f = fixture({ ...options, snapshots: [old], manual: manual ? ['GEST.MC'] : [] });
    f.files.delete(path.join(root, 'fundamentals-cache/GEST.MC.json'));
    const m = await f.run(), next = f.stored('GEST.MC');
    assert.equal(m.results[0].status, 'ok', 'Known Q4 gaps must not reject an otherwise valid reload');
    assert.equal(m.n_stale_quarter_reload_failed, 0);
    if (!manual) assert.equal(m.n_stale_quarter_selected, 1, 'Exercise optional reload, not ordinary full pull');
    assert.equal(next.meta.asOf, new Date(NOW).toISOString());
    for (const c of cells) {
      const i = next.timeseries[c.field + 'Ends'].indexOf(c.period);
      assert.equal(val(next.timeseries[c.field][i]), null, c.field + ': known bad Q4 must not be restored');
      assert(next.timeseries[c.field][i].yahooQ4Correction, c.field + ': visible correction reason must survive');
    }
    assert.equal(JSON.stringify(old), original, 'Prior snapshot remains unchanged');
    passed++; console.log('PASS Q4 gaps with prior annual=' + priorAnnual + ', descriptors=' + descriptors + ', manual=' + manual);
  }
  const control = await baseline('UNLISTED');
  for (const c of cells) {
    const i = control.timeseries[c.field + 'Ends'].indexOf(c.period);
    assert.equal(val(control.timeseries[c.field][i]), c.vendorNative * control.meta.fxRateApplied, 'Unlisted control untouched');
  }
  passed++; console.log('PASS unlisted control keeps reported values');
  const unmarked = structuredClone(control), field = 'revenueQ';
  const i = unmarked.timeseries.revenueQEnds.indexOf('2025-12-31');
  unmarked.timeseries[field][i] = { value: null };
  assert(historyIsThinner(unmarked, control), 'An unmarked provider hole remains a loss');
  unmarked.timeseries[field][i].yahooQ4Correction = { replacementNativeValue: 123 };
  assert(historyIsThinner(unmarked, control), 'Only an explicit missing decision exempts the gap');
  passed++; console.log('PASS unmarked or mismatched gap still rejects');
  const cache = row => ({ ftsQuarterly: { revenueQ: [row], revenueQEnds: ['2025-12-31'] } });
  assert(cacheIsThinner(cache({ value: null, yahooQ4Correction: { replacementNativeValue: null } }), cache({ value: 10 })),
    'Raw cache comparison must not exempt canonical correction metadata');
  passed++; console.log('PASS raw cache loss remains protected');
  const shard = { n_total: 10, n_ok: 8, n_failed: 0, n_full: 3, n_priceonly: 4, n_retained: 1,
    partial: false, yahooQ4HandTable: { observed: 1, corrected: 2, missing: 2, stale: 0, alreadyCorrected: 1 } };
  const merged = mergeManifests([shard, structuredClone(shard)], 20, 2);
  assert.equal(merged.n_shards_invalid, 0); assert.equal(merged.n_ok, 16);
  assert.equal(merged.n_full, 6); assert.equal(merged.n_priceonly, 8); assert.equal(merged.n_retained, 2);
  assert.equal(merged.yahooQ4HandTable.corrected, 4); assert.equal(merged.yahooQ4HandTable.missing, 4);
  passed++; console.log('PASS shard merge retains C10 classification and Q4 counters together');
  assert.equal(hash(sourcePath), beforeHash);
  assert.equal(hash(path.join(__dirname, 'fixtures/yahoo-q4-known-cases.json')), evidenceHash);
  console.log(passed + ' tests passed; live source and real receipt unchanged.');
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
