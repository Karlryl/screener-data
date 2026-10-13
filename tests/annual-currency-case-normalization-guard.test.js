'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { detectAnnualCurrencyLeak } = require('../lib/annual-currency-guard.js');

function fixture(reportingCurrencyOriginal, tradingCurrency) {
  return {
    meta: { reportingCurrencyOriginal, tradingCurrency },
    annual: { annualRev: [{ value: 400 }] },
    timeseries: { revenueQ: [25, 25, 25, 25].map(value => ({ value })) },
    metrics: { revenueTTM: { value: 100 } },
    marketCap: { value: 100 },
  };
}

test('cross-currency envelope retains the lower leak threshold', () => {
  assert.equal(detectAnnualCurrencyLeak(fixture('USD', 'NOK')).suspect, true);
});

test('currency code casing alone does not create a cross-currency leak', () => {
  assert.deepEqual(
    detectAnnualCurrencyLeak(fixture('usd', 'USD')),
    { suspect: false, reason: null },
  );
  assert.deepEqual(
    detectAnnualCurrencyLeak(fixture('USD', 'usd')),
    { suspect: false, reason: null },
  );
});
