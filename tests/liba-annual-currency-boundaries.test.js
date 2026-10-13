'use strict';
// DL13 K-annual-currency-guard, T-05. No formula change: pins the existing documented boundaries.
// No DL3/DL8 defect asserted. Runs the current repository module directly.
const assert = require('node:assert/strict');
const { detectAnnualCurrencyLeak } = require('../lib/annual-currency-guard.js');
const snap = (annual=400, ttm=100, trade='NOK', cap=10) => ({
  meta: { reportingCurrencyOriginal:'USD', tradingCurrency:trade },
  annual:{annualRev:[{value:annual}]}, timeseries:{revenueQ:[25,25,25,25]},
  metrics:{revenueTTM:{value:ttm}}, marketCap:{value:cap},
});
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok '+name); }
test('cross-currency ratio must strictly exceed 3, with positive control', () => {
  assert.equal(detectAnnualCurrencyLeak(snap(300)).suspect, false);
  assert.equal(detectAnnualCurrencyLeak(snap(300.01)).suspect, true);
});
test('same-USD evidence must strictly exceed both 20 times quarters and 10 times cap', () => {
  assert.equal(detectAnnualCurrencyLeak(snap(2000,100,'USD',100)).suspect, false);
  assert.equal(detectAnnualCurrencyLeak(snap(2000.01,100,'USD',100)).suspect, true);
  assert.equal(detectAnnualCurrencyLeak(snap(3000,100,'USD',300)).suspect, false);
  assert.equal(detectAnnualCurrencyLeak(snap(3000,100,'USD',299)).suspect, true);
});
test('quarter health interval is inclusive at 0.6 and 1.6 only', () => {
  for (const [ttm, expected] of [[59.99,false],[60,true],[160,true],[160.01,false]]) {
    assert.equal(detectAnnualCurrencyLeak(snap(400,ttm)).suspect, expected, String(ttm));
  }
});
test('unknown or unusable magnitudes do not raise a currency-leak flag', () => {
  for (const value of [null, undefined, NaN, Infinity, -Infinity, '400']) {
    const annual = snap(); annual.annual.annualRev[0].value = value;
    const cap = snap(3000,100,'USD'); cap.marketCap.value = value;
    assert.equal(detectAnnualCurrencyLeak(annual).suspect, false);
    assert.equal(detectAnnualCurrencyLeak(cap).suspect, false);
  }
  const s = snap(); s.timeseries.revenueQ = [0,0,0,0];
  assert.equal(detectAnnualCurrencyLeak(s).suspect, false);
});
console.log(passed+' tests passed');
