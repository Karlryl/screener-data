'use strict';
/**
 * Anchor-fixture test for annual-currency-guard.
 * Standalone — run with:  node lib/annual-currency-guard.test.js
 * MUST flag the AKRBP.OL / GMAB.CO shape (annual revenue leaked in trading currency) and
 * MUST NOT flag: same-currency discontinuities (the 128 naive-ratio FPs), quarterly-defect
 * shapes (broken quarterly TTM), the deflationary direction, or healthy snapshots.
 */
const assert = require('assert');
const { detectAnnualCurrencyLeak } = require('./annual-currency-guard.js');

const env = (arr) => arr.map(v => (v == null ? null : { value: v }));
// marketCap (optional, 6th arg): a number -> top-level marketCap:{value}; omitted -> no marketCap key.
const snap = (repOrig, trade, annual0, revQ, revTTM, marketCap) => ({
  meta: { reportingCurrencyOriginal: repOrig, tradingCurrency: trade },
  annual: { annualRev: env([annual0]) },
  timeseries: { revenueQ: env(revQ) },
  metrics: { revenueTTM: revTTM == null ? null : { value: revTTM } },
  ...(marketCap == null ? {} : { marketCap: { value: marketCap } }),
});

let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); }
  else { console.error(`  ✗ FAIL: ${name}`); failed++; }
}

// 1) AKRBP.OL — USD reporter, NOK trading, annual leaked ~9.3x; quarterly TTM healthy. MUST FLAG.
{
  const r = detectAnnualCurrencyLeak(snap('USD', 'NOK', 104.3e9,
    [2.99e9, 2.49e9, 2.53e9, 3.15e9], 10.8e9));
  check('AKRBP.OL-shape flagged', r.suspect === true && /leaked/.test(r.reason || ''));
}

// 2) GMAB.CO — USD reporter, DKK trading, annual leaked ~6x; quarterly TTM healthy. MUST FLAG.
{
  const r = detectAnnualCurrencyLeak(snap('USD', 'DKK', 18.0e9,
    [0.78e9, 0.74e9, 0.71e9, 0.77e9], 3.0e9));
  check('GMAB.CO-shape flagged', r.suspect === true);
}

// 3) Same-currency discontinuity (BDC/spin-off, ratio huge but repOrig==trade). MUST NOT flag.
{
  const r = detectAnnualCurrencyLeak(snap('USD', 'USD', 1000e9,
    [0.01e9, 0.01e9, 0.02e9, 0.02e9], 0.06e9));
  check('same-currency discontinuity NOT flagged', r.suspect === false);
}

// 4) Quarterly-defect shape: currencies differ, annual >> qTTM, BUT metrics.revenueTTM does
//    NOT agree with the broken quarterly sum (ttmRatio out of [0.6,1.6]). MUST NOT flag.
{
  const r = detectAnnualCurrencyLeak(snap('CNY', 'HKD', 100e9,
    [0.5e9, 0.5e9, 0.5e9, 0.5e9], 90e9)); // qTTM=2e9, ttmRatio=45 -> excluded
  check('quarterly-defect NOT flagged', r.suspect === false);
}

// 5) Deflationary direction (annual much SMALLER than qTTM, ratio<1/3). MUST NOT flag.
{
  const r = detectAnnualCurrencyLeak(snap('JPY', 'USD', 1.0e9,
    [3e9, 3e9, 3e9, 3e9], 12e9)); // ratio ~0.083 -> not >3
  check('deflationary direction NOT flagged', r.suspect === false);
}

// 6) Healthy normal (annual ~= qTTM ~= revTTM, currencies differ but no leak). MUST NOT flag.
{
  const r = detectAnnualCurrencyLeak(snap('USD', 'NOK', 12e9,
    [3e9, 3e9, 3e9, 3e9], 12e9)); // ratio=1 -> not >3
  check('healthy snapshot NOT flagged', r.suspect === false);
}

// 7) Edges: fewer than 4 quarters, nulls, missing annual/metrics -> no flag, no throw.
check('short quarterly history NOT flagged',
  detectAnnualCurrencyLeak(snap('USD', 'NOK', 100e9, [3e9, 3e9, 3e9], 11e9)).suspect === false);
check('null quarters NOT flagged',
  detectAnnualCurrencyLeak(snap('USD', 'NOK', 100e9, [3e9, null, 3e9, 3e9], 11e9)).suspect === false);
check('missing revenueTTM NOT flagged',
  detectAnnualCurrencyLeak(snap('USD', 'NOK', 100e9, [3e9, 3e9, 3e9, 3e9], null)).suspect === false);
check('empty snapshot NOT flagged', detectAnnualCurrencyLeak({}).suspect === false);
check('undefined snapshot NOT flagged', detectAnnualCurrencyLeak(undefined).suspect === false);

// 8) USD/USD POSITIVE branch (INFY-shape): annual INR-sized vs USD quarters, quarterly side
//    healthy, market cap corroborates (a0/mcap = 21.4 > 10). MUST FLAG with the envelope reason.
{
  const r = detectAnnualCurrencyLeak(snap('USD', 'USD', 1500e9, [4e9, 4e9, 4e9, 4e9], 16.5e9, 70e9));
  check('USD/USD INFY-shape flagged', r.suspect === true);
  check('USD/USD reason carries annual/qTTM ratio x93.8', /x93\.8/.test(r.reason || ''));
  check('USD/USD reason carries market-cap evidence x21.4', /x21\.4 market cap/.test(r.reason || ''));
  check('USD/USD reason names the envelope', /despite a USD\/USD envelope/.test(r.reason || ''));
}

// 9) USD/USD branch requires a positive market cap: missing or {value:0} -> no flag.
check('USD/USD without marketCap NOT flagged',
  detectAnnualCurrencyLeak(snap('USD', 'USD', 1500e9, [4e9, 4e9, 4e9, 4e9], 16.5e9)).suspect === false);
check('USD/USD marketCap {value:0} NOT flagged',
  detectAnnualCurrencyLeak(snap('USD', 'USD', 1500e9, [4e9, 4e9, 4e9, 4e9], 16.5e9, 0)).suspect === false);

// 10) SAME_USD_ANNUAL_TO_MARKET_CAP_MIN = 10 is strict (>): exactly 10 -> no flag, 10.01 -> flag.
check('a0/marketCap exactly 10 NOT flagged (strict >)',
  detectAnnualCurrencyLeak(snap('USD', 'USD', 1000e9, [4e9, 4e9, 4e9, 4e9], 16e9, 100e9)).suspect === false);
check('a0/marketCap 10.01 flagged',
  detectAnnualCurrencyLeak(snap('USD', 'USD', 1000e9, [4e9, 4e9, 4e9, 4e9], 16e9, 1000e9 / 10.01)).suspect === true);

// 11) SAME_USD_ANNUAL_TO_QTTM_MIN = 20 is strict (>): ratio exactly 20 -> no flag, 20.01 -> flag.
check('USD/USD ratio exactly 20 NOT flagged (strict >)',
  detectAnnualCurrencyLeak(snap('USD', 'USD', 320e9, [4e9, 4e9, 4e9, 4e9], 16e9, 1e9)).suspect === false);
check('USD/USD ratio 20.01 flagged',
  detectAnnualCurrencyLeak(snap('USD', 'USD', 320.16e9, [4e9, 4e9, 4e9, 4e9], 16e9, 1e9)).suspect === true);

// 12) CROSS_CURRENCY_ANNUAL_TO_QTTM_MIN = 3 is strict (>): ratio exactly 3 -> no flag, 3.01 -> flag.
check('cross-currency ratio exactly 3 NOT flagged (strict >)',
  detectAnnualCurrencyLeak(snap('USD', 'NOK', 48e9, [4e9, 4e9, 4e9, 4e9], 16e9)).suspect === false);
check('cross-currency ratio 3.01 flagged',
  detectAnnualCurrencyLeak(snap('USD', 'NOK', 48.16e9, [4e9, 4e9, 4e9, 4e9], 16e9)).suspect === true);

// 13) HEALTHY_TTM_TO_QUARTERS_MIN/MAX = [0.6, 1.6] are INCLUSIVE; just outside -> no flag.
check('ttmRatio exactly 0.6 flagged (inclusive lower bound)',
  detectAnnualCurrencyLeak(snap('USD', 'NOK', 100e9, [4e9, 4e9, 4e9, 4e9], 9.6e9)).suspect === true);
check('ttmRatio exactly 1.6 flagged (inclusive upper bound)',
  detectAnnualCurrencyLeak(snap('USD', 'NOK', 100e9, [4e9, 4e9, 4e9, 4e9], 25.6e9)).suspect === true);
check('ttmRatio 0.59 NOT flagged',
  detectAnnualCurrencyLeak(snap('USD', 'NOK', 100e9, [4e9, 4e9, 4e9, 4e9], 9.44e9)).suspect === false);
check('ttmRatio 1.61 NOT flagged',
  detectAnnualCurrencyLeak(snap('USD', 'NOK', 100e9, [4e9, 4e9, 4e9, 4e9], 25.76e9)).suspect === false);

// 14) Raw numbers instead of {value} envelopes are accepted; cross-currency reason text is exact.
{
  const r = detectAnnualCurrencyLeak({
    meta: { reportingCurrencyOriginal: 'USD', tradingCurrency: 'NOK' },
    annual: { annualRev: [160e9] },
    timeseries: { revenueQ: [4e9, 4e9, 4e9, 4e9] },
    metrics: { revenueTTM: 16e9 },
  });
  check('raw-number snapshot flagged', r.suspect === true);
  check('raw-number reason carries x10.0', /x10\.0/.test(r.reason || ''));
  check('cross-currency reason names trading + reporter currency',
    /appears leaked in trading currency NOK \(reporter USD\)/.test(r.reason || ''));
}

// 15) annualRev[0] not a positive finite number ({value:NaN}, {value:'12'}, negative, zero) -> no flag.
const withA0 = (a0) => ({ ...snap('USD', 'NOK', 0, [4e9, 4e9, 4e9, 4e9], 16e9), annual: { annualRev: [a0] } });
check('annualRev[0] {value:NaN} NOT flagged', detectAnnualCurrencyLeak(withA0({ value: NaN })).suspect === false);
check('annualRev[0] {value:"12"} (string) NOT flagged', detectAnnualCurrencyLeak(withA0({ value: '12' })).suspect === false);
check('annualRev[0] negative NOT flagged', detectAnnualCurrencyLeak(withA0({ value: -160e9 })).suspect === false);
check('annualRev[0] zero NOT flagged', detectAnnualCurrencyLeak(withA0({ value: 0 })).suspect === false);

// 16) Only the first 4 quarters count: huge extra quarters at index 4/5 do not enter qTTM.
check('revenueQ with 6 elements uses only the first 4',
  detectAnnualCurrencyLeak(snap('USD', 'NOK', 48.16e9, [4e9, 4e9, 4e9, 4e9, 1e15, 1e15], 16e9)).suspect === true);

// 17) Negative quarters with qTTM <= 0 -> no flag, no throw.
check('all-negative quarters NOT flagged',
  detectAnnualCurrencyLeak(snap('USD', 'NOK', 160e9, [-4e9, -4e9, -4e9, -4e9], 16e9)).suspect === false);
check('quarters summing to zero NOT flagged',
  detectAnnualCurrencyLeak(snap('USD', 'NOK', 160e9, [4e9, 4e9, -4e9, -4e9], 16e9)).suspect === false);

// 18) meta missing one side of the envelope -> no flag; non-string codes are stringified, no throw.
check('meta without tradingCurrency NOT flagged',
  detectAnnualCurrencyLeak(snap('USD', undefined, 160e9, [4e9, 4e9, 4e9, 4e9], 16e9)).suspect === false);
check('meta without reportingCurrencyOriginal NOT flagged',
  detectAnnualCurrencyLeak(snap(undefined, 'NOK', 160e9, [4e9, 4e9, 4e9, 4e9], 16e9)).suspect === false);
{
  const r = detectAnnualCurrencyLeak(snap(123, 456, 160e9, [4e9, 4e9, 4e9, 4e9], 16e9));
  check('numeric currency codes do not throw and are reported verbatim',
    r.suspect === true && /trading currency 456 \(reporter 123\)/.test(r.reason || ''));
}

if (failed) { console.error(`\nannual-currency-guard: ${failed} assertion(s) FAILED`); process.exit(1); }
console.log('\nannual-currency-guard: all anchor + edge assertions passed');
