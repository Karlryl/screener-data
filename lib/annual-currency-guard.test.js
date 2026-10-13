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
const snap = (repOrig, trade, annual0, revQ, revTTM) => ({
  meta: { reportingCurrencyOriginal: repOrig, tradingCurrency: trade },
  annual: { annualRev: env([annual0]) },
  timeseries: { revenueQ: env(revQ) },
  metrics: { revenueTTM: revTTM == null ? null : { value: revTTM } },
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

if (failed) { console.error(`\nannual-currency-guard: ${failed} assertion(s) FAILED`); process.exit(1); }
console.log('\nannual-currency-guard: all anchor + edge assertions passed');
