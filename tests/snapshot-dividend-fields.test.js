'use strict';
// Guard for the W6 filter-tab fields (26.09.2026): dividendYield, payoutRatio and
// fiftyTwoWeekHigh from Yahoo summaryDetail must land in snapshot.metrics.
// Runs the real mapper and the real converter (no source-text scan) and checks:
//   presence  - all three written in the {value, source, confidence, asOf} shape
//   absence   - Yahoo without the fields -> null, never 0
//   units     - the 52-week high converts with exactly the price's factor (GBp/FX),
//               yield and payout stay unscaled (ratios)
const assert = require('assert');
const py = require('../pull-yahoo.js');

let ok = 0, fail = 0;
function check(name, fn) {
  try { fn(); ok++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + ': ' + (e && e.message)); }
}

const AS_OF = '2026-09-26T00:00:00.000Z';
const near = (a, b) => Math.abs(a - b) <= Math.abs(b) * 1e-9;

function mapped(summaryDetail, price) {
  return py.mapYahooToCanonical(
    { summaryDetail, price: Object.assign({ marketCap: 5e9, regularMarketPrice: 100 }, price) },
    { ticker: 'FIXT', name: 'Fixture' }, AS_OF);
}

check('presence: three fields in the neighbour shape, ratios in percent', () => {
  const s = mapped({ dividendYield: 0.0312, payoutRatio: 0.45, fiftyTwoWeekHigh: 123.4, trailingPE: 20 },
    { currency: 'USD', financialCurrency: 'USD' });
  const shape = Object.keys(s.metrics.pe).sort().join(',');
  for (const k of ['dividendYield', 'payoutRatio', 'fiftyTwoWeekHigh']) {
    const m = s.metrics[k];
    assert.ok(m && typeof m === 'object', k + ' missing');
    assert.strictEqual(Object.keys(m).sort().join(','), shape, k + ' shape differs from pe');
    assert.strictEqual(m.source, s.metrics.pe.source, k + ' source');
    assert.strictEqual(m.asOf, AS_OF, k + ' asOf');
  }
  assert.ok(near(s.metrics.dividendYield.value, 3.12), 'yield in percent');
  assert.ok(near(s.metrics.payoutRatio.value, 45), 'payout in percent');
  assert.strictEqual(s.metrics.fiftyTwoWeekHigh.value, 123.4);
});

check('absence: Yahoo without the fields -> null, not 0', () => {
  const s = mapped({ trailingPE: 20 }, { currency: 'USD', financialCurrency: 'USD' });
  for (const k of ['dividendYield', 'payoutRatio', 'fiftyTwoWeekHigh']) {
    assert.strictEqual(s.metrics[k], null, k + ' must be null, got ' + JSON.stringify(s.metrics[k]));
  }
});

// Unit consistency: the stored price is regularMarketPrice * _resolveTradingFx(q, snap).factor
// (price-only path). The 52-week high must come out with that same factor.
for (const [rc, tc] of [['GBP', 'GBp'], ['USD', 'GBp'], ['EUR', 'GBp'], ['JPY', 'JPY'], ['TWD', 'USD']]) {
  check('units: 52-week high converts like the price (' + rc + ' reporter, ' + tc + ' quote)', () => {
    const RAW_PRICE = 7674.4, RAW_HIGH = 8123.5;
    const s = mapped({ dividendYield: 0.04, payoutRatio: 0.5, fiftyTwoWeekHigh: RAW_HIGH },
      { currency: tc, financialCurrency: rc, regularMarketPrice: RAW_PRICE });
    py._convertSnapshotToUSD(s);
    assert.strictEqual(s.meta.fxConverted, true, 'converted');
    const priceFx = py._resolveTradingFx({ currency: tc, regularMarketPrice: RAW_PRICE }, s);
    assert.ok(priceFx.ok, 'price factor resolvable');
    const priceUsd = RAW_PRICE * priceFx.factor;
    const highUsd = s.metrics.fiftyTwoWeekHigh.value;
    assert.ok(near(highUsd / priceUsd, RAW_HIGH / RAW_PRICE),
      '52w high / price = ' + (highUsd / priceUsd) + ', raw ratio ' + (RAW_HIGH / RAW_PRICE));
    if (tc === 'GBp') {
      assert.ok(near(highUsd, RAW_HIGH * py._FX_TO_USD.GBP / 100), 'GBp: pence divisor applied');
    }
    assert.ok(near(s.metrics.dividendYield.value, 4), 'yield untouched by FX');
    assert.ok(near(s.metrics.payoutRatio.value, 50), 'payout untouched by FX');
  });
}

console.log(`\nsnapshot-dividend-fields: ${ok} ok, ${fail} fail`);
if (fail > 0) process.exit(1);
