'use strict';
// DL13 K-ads-hand-table, T-04: no DL3/DL8 defect asserted; missing-input outcomes were unproven.
// Synthetic inputs only; run standalone from the repository tests directory.
const assert = require('node:assert/strict');
const { applyAdsHandTable, applyShareCountTable } = require('../lib/ads-hand-table.js');
const row = { ordinaryPerAds: 2, yahooOrdinaryShares: 100, validFrom: '2026-01-01' };
const table = { SYN: row };
const snap = () => ({ marketCap: { value: 1000, source: 'yahoo_quote', asOf: '2026-10-07' },
  meta: { sharesOutstanding: 100 }, metrics: { enterpriseValue: { value: 1100 } } });
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok ' + name); }
test('absent or inherited rows do not authorize an ADS correction', () => {
  for (const missing of [null, undefined, {}, Object.create(table)]) {
    const s = snap(), before = structuredClone(s);
    assert.deepEqual(applyAdsHandTable(s, 'SYN', 10, missing), { status: 'no-row' });
    assert.deepEqual(s, before);
  }
});
test('each missing ADS input independently returns stale and preserves market cap', () => {
  for (const [name, edit, price] of [
    ['market cap', s => { delete s.marketCap; }, 10],
    ['shares', s => { delete s.meta.sharesOutstanding; }, 10],
    ['price', () => {}, null],
    ['asOf', s => { delete s.marketCap.asOf; }, 10],
  ]) {
    const s = snap(); edit(s); const before = structuredClone(s.marketCap);
    assert.equal(applyAdsHandTable(s, 'SYN', price, table).status, 'stale', name);
    assert.deepEqual(s.marketCap, before, name);
    assert.equal(typeof s.meta._adsHandTableStale, 'string', name);
  }
  assert.equal(applyAdsHandTable(null, 'SYN', 10, table).status, 'stale');
});
test('positive control corrects once even when optional metrics are absent', () => {
  const s = snap(); delete s.metrics;
  assert.equal(applyAdsHandTable(s, 'SYN', 10, table).status, 'corrected');
  assert.equal(s.marketCap.value, 500);
  const before = structuredClone(s);
  assert.equal(applyAdsHandTable(s, 'SYN', 10, table).status, 'already-corrected');
  assert.deepEqual(s, before);
});
test('share-count missing value is stale while an absent row stays untouched', () => {
  const shares = { SYN: { shares: 50, wrongShares: [100], reviewBy: '2026-12-31' } };
  const s = snap(); delete s.marketCap;
  assert.equal(applyShareCountTable(s, 'SYN', 10, shares).status, 'stale');
  const other = snap(), before = structuredClone(other);
  assert.equal(applyShareCountTable(other, 'SYN', 10, Object.create(shares)).status, 'no-row');
  assert.deepEqual(other, before);
});
console.log(passed + ' tests passed');
