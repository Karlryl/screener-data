'use strict';

const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const py = require('../pull-yahoo.js');
const { captureSnapshot } = require('../lib/export-provenance.js');

// NPN/SBK cap, currency and NPN price facts: P164, quote captured 2026-10-08.
// FX: 2026-10-10. SBK price, EV, targets, statements and the ILA listing are synthetic.
const rates = { ZAR: 0.060606062, ILS: 0.32680807 };
const previousRates = Object.fromEntries(Object.keys(rates).map(key => [key, py._FX_TO_USD[key]]));
before(() => Object.assign(py._FX_TO_USD, rates));
after(() => Object.assign(py._FX_TO_USD, previousRates));
const cases = [
  { ticker: 'NPN.JO', currency: 'ZAc', reporting: 'USD', major: 'ZAR', cap: 525967327232, price: 70305 },
  { ticker: 'SBK.JO', currency: 'ZAc', reporting: 'ZAR', major: 'ZAR', cap: 471140368384, price: 17000 },
  { ticker: 'SYNTHETIC.TA', currency: 'ILA', reporting: 'ILS', major: 'ILS', cap: 100e9, price: 12345 },
];
const near = (actual, expected) => assert.ok(Number.isFinite(actual)
  && Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * 1e-12,
`expected ${expected}, got ${actual}`);

function fixture(c, reporting = c.reporting) {
  const raw = {
    price: { currency: c.currency, marketCap: c.cap, regularMarketPrice: c.price,
      exchangeName: c.currency === 'ZAc' ? 'JNB' : 'TLV' },
    financialData: { financialCurrency: reporting, totalRevenue: 200e9,
      targetMeanPrice: c.price, targetMedianPrice: c.price * 1.1 },
    defaultKeyStatistics: { enterpriseValue: c.cap * 1.2, sharesOutstanding: 123456789,
      enterpriseToRevenue: 4 },
    summaryDetail: { fiftyTwoWeekHigh: c.price * 1.3, priceToSalesTrailing12Months: 3 },
  };
  const snap = py.mapYahooToCanonical(raw, { ticker: c.ticker, yahoo_symbol: c.ticker }, '2026-10-10T09:44:18.451Z');
  snap.annual.annualRev = [{ value: 200e9 }, { value: 150e9 }];
  snap.annual.annualShares = [{ value: 123456789 }];
  return snap;
}

// Execute the actual skip branch with in-memory I/O; never remove a snapshot.
const source = fs.readFileSync(path.join(__dirname, '..', 'pull-yahoo.js'), 'utf8');
const skipStart = source.indexOf('      if (canonical.meta && canonical.meta.fxConversionFailed === true) {');
const skipEnd = source.indexOf('\n      // T322:', skipStart);
assert.ok(skipStart >= 0 && skipEnd > skipStart, 'full-pull FX skip branch must exist');
const skip = new Function('canonical', 'stock', 'outputDir', 'path', 'safeSnapshotFilename',
  '_removeStaleFiles', '_log', 'failures', 'results', source.slice(skipStart, skipEnd));
function skipResult(snap) {
  const results = [], removals = [], failures = [];
  skip(snap, { ticker: snap.meta.ticker }, 'in-memory-only', path, py.safeSnapshotFilename,
    files => { removals.push(...files); return []; }, () => {}, failures, results);
  assert.deepEqual(failures, []);
  return { results, removals };
}

for (const c of cases) {
  test(`${c.ticker}: full mapper accepts explicit reporting and preserves aggregate units`, () => {
    const snap = fixture(c);
    py._convertSnapshotToUSD(snap);
    assert.equal(snap.meta.fxConverted, true);
    assert.notEqual(snap.meta.fxConversionFailed, true);
    assert.deepEqual(skipResult(snap), { results: [], removals: [] });
    const majorRate = rates[c.major], reportingRate = py._FX_TO_USD[c.reporting];
    near(snap.marketCap.value, c.cap * majorRate);
    near(snap.metrics.enterpriseValue.value, c.cap * 1.2 * majorRate);
    near(snap.metrics.enterpriseValue.value / snap.marketCap.value, 1.2);
    near(snap.metrics.targetMeanPrice.value, c.price * majorRate / 100);
    near(snap.metrics.targetMedianPrice.value, c.price * 1.1 * majorRate / 100);
    near(snap.metrics.fiftyTwoWeekHigh.value, c.price * 1.3 * majorRate / 100);
    near(snap.metrics.revenueTTM.value, 200e9 * reportingRate);
    near(snap.annual.annualRev[0].value, 200e9 * reportingRate);
    near(snap.metrics.priceSales.value, 3 * majorRate / reportingRate);
    near(snap.metrics.enterpriseToRevenue.value, 4 * majorRate / reportingRate);
    assert.equal(snap.meta.sharesOutstanding, 123456789);
    assert.deepEqual(snap.annual.annualShares, [{ value: 123456789 }]);
    assert.equal(snap.meta.tradingCurrencyOriginal, c.currency);
    near(snap.meta.tradingFxRateApplied, majorRate / 100);
  });

  test(`${c.ticker}: successful USD normalization is byte-idempotent`, () => {
    const snap = fixture(c);
    py._convertSnapshotToUSD(snap);
    assert.equal(snap.meta.fxConverted, true, 'idempotence must not pass on a rejected snapshot');
    const once = JSON.stringify(snap);
    py._convertSnapshotToUSD(snap);
    assert.equal(JSON.stringify(snap), once);
  });
}

for (const c of [cases[0], cases[2]]) {
  test(`${c.currency}: reporting variants and missing optional prices`, () => {
    for (const reporting of [c.major, 'USD', 'EUR', 'GBP']) {
      const snap = fixture(c, reporting);
      py._convertSnapshotToUSD(snap);
      assert.equal(snap.meta.fxConverted, true);
      near(snap.marketCap.value, c.cap * rates[c.major]);
      near(snap.metrics.revenueTTM.value, 200e9 * py._FX_TO_USD[reporting]);
      near(snap.metrics.targetMeanPrice.value, c.price * rates[c.major] / 100);
    }
    const snap = fixture(c);
    snap.metrics.targetMeanPrice = null;
    snap.metrics.targetMedianPrice = null;
    snap.metrics.fiftyTwoWeekHigh = null;
    py._convertSnapshotToUSD(snap);
    assert.equal(snap.meta.fxConverted, true);
    for (const field of ['targetMeanPrice', 'targetMedianPrice', 'fiftyTwoWeekHigh']) {
      assert.equal(snap.metrics[field], null);
    }
  });

  test(`${c.currency}: quote and cached price-only factors and stamps`, () => {
    for (const source of ['quote', 'snapshot-price', 'meta']) {
      const snap = { meta: { reportingCurrencyOriginal: c.reporting, fxConverted: true,
        tradingCurrency: c.currency, tradingCurrencyAssumed: false } };
      if (source === 'snapshot-price') snap.price = { currency: c.currency };
      const fx = py._resolveTradingFx(source === 'quote' ? { currency: c.currency } : null, snap);
      assert.equal(fx.ok, true);
      assert.equal(fx.quelle, source);
      near(c.price * fx.factor, c.price * rates[c.major] / 100);
      near(c.cap * fx.factorMajorUnit, c.cap * rates[c.major]);
      py._stampeHandelskurs(snap.meta, fx);
      assert.equal(snap.meta.tradingCurrencyOriginal, c.currency);
      near(snap.meta.tradingFxRateApplied, rates[c.major] / 100);
    }
  });

  test(`${c.currency}: missing reporting currency remains fx-unknown`, () => {
    for (const missing of [undefined, null, '']) {
      const snap = fixture(c, null);
      // Exercise undefined separately; a default parameter would replace it.
      const raw = { price: { currency: c.currency, marketCap: c.cap, financialCurrency: missing },
        financialData: { financialCurrency: missing } };
      const mapped = py.mapYahooToCanonical(raw, { ticker: c.ticker }, snap.meta.asOf);
      const ambiguous = mapped.meta.ccyAmbiguous;
      assert.equal(mapped.meta.reportingCurrency, c.currency);
      py._convertSnapshotToUSD(mapped);
      assert.equal(mapped.meta.fxConversionFailed, true);
      assert.equal(mapped.meta.fxConverted, false);
      assert.equal(mapped.meta.ccyAmbiguous, ambiguous);
      assert.equal(mapped.marketCap.value, c.cap);
      const outcome = skipResult(mapped);
      assert.equal(outcome.results[0].status, 'fx-unknown');
      assert.equal(outcome.removals.length, 1);
    }
  });

  test(`${c.currency}: missing or invalid major FX stays closed`, () => {
    for (const invalid of [undefined, 0, -1, NaN, Infinity]) {
      const saved = py._FX_TO_USD[c.major];
      try {
        py._FX_TO_USD[c.major] = invalid;
        assert.equal(py._fxFactorFor(c.currency), null);
        const snap = fixture(c, 'USD');
        py._convertSnapshotToUSD(snap);
        assert.equal(snap.meta.fxConversionFailed, true);
        assert.equal(skipResult(snap).results[0].status, 'fx-unknown');
      } finally { py._FX_TO_USD[c.major] = saved; }
    }
  });

  test(`${c.currency}: cap provenance uses the major currency and rate exactly once`, () => {
    const snap = fixture(c, c.major);
    py._convertSnapshotToUSD(snap);
    assert.equal(snap.meta.fxConverted, true);
    for (const stamped of [true, false]) {
      if (!stamped) delete snap.meta.tradingFxRateApplied;
      const cap = captureSnapshot(snap).marketCap;
      assert.equal(cap.nativeCurrency, c.major);
      assert.equal(cap.fx.fromCurrency, c.major);
      near(cap.fx.rate, rates[c.major]);
      near(cap.normalizedValue, c.cap * rates[c.major]);
    }
  });
}

test('existing pence and major-currency factors remain unchanged; unknown aliases stay closed', () => {
  for (const alias of ['GBp', 'GBX', 'GBPENCE']) {
    const fx = py._fxFactorFor(alias);
    near(fx.factor, py._FX_TO_USD.GBP / 100);
    assert.equal(fx.factorMajorUnit, py._FX_TO_USD.GBP);
  }
  for (const currency of ['GBP', 'ZAR', 'ILS', 'USD', 'EUR', 'HKD', 'TWD']) {
    const fx = py._fxFactorFor(currency);
    assert.equal(fx.factor, py._FX_TO_USD[currency]);
    assert.equal(fx.factorMajorUnit, fx.factor);
  }
  for (const currency of ['ZAC', 'zac', 'ila', 'ZZZ']) assert.equal(py._fxFactorFor(currency), null);
});
