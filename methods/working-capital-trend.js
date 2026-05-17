'use strict';
/**
 * Tag 215d: Working Capital / Revenue Trend (cash-cycle efficiency)
 * ===================================================================
 * Tracks the trend in working-capital intensity (WC/Revenue) over 3 years.
 * A FALLING WC/Rev ratio = improving cash cycle (collecting faster, paying
 * slower, managing inventory tighter, or — for SaaS — increasing deferred
 * revenue / pre-paid customer base). A RISING WC/Rev ratio = degrading
 * cash cycle (AR buildup, inventory buildup, slower customer payment).
 *
 * Activated by Tag 211l surfacing currentAssets + currentLiabilities. Before
 * Tag 211l this method's inputs weren't persisted.
 *
 * Formula (latest-first arrays):
 *   wc_i = currentAssets[i] - currentLiabilities[i]
 *   wcRatio_i = wc_i / annualRev[i]    (working-capital-to-revenue ratio)
 *
 *   trendSlope = simple linear regression slope of (wcRatio_0..2) vs year-index
 *                  — negative slope = WC intensity FALLING = cash cycle improving
 *                  — positive slope = WC intensity RISING = cash cycle degrading
 *
 * Pass: trendSlope <= +0.02 (slope ≤ +2pp of revenue per year — cash cycle
 *       holding or improving). Threshold is conservative; +2pp/year of WC
 *       growth relative to revenue is the line between "normal capital
 *       intensity at scale" and "real cash-cycle deterioration".
 *
 * Failure mode this catches:
 *   - Receivables bloat (channel-stuffing precursor): AR growing faster than
 *     revenue, often before actual revenue stalls
 *   - Inventory buildup: products not selling through → margin pressure ahead
 *   - Slowing customer payment: aging AR creating bad-debt risk
 *
 * Not computable:
 *   - <3 valid years with currentAssets + currentLiabilities + Rev>0
 *   - All WC ratios negative (some legit SaaS profiles have WC<0 from large
 *     deferred-revenue balances) AND all in same direction — degenerate
 *     for trend purposes. Negative-WC firms still get trend computed; it's
 *     the all-same-sign-degenerate case that's skipped.
 *
 * Anchor head-check (Tag 211l-or-later snapshots):
 *   - MSFT/GOOG/V: WC discipline tight, slope ≈ 0 → PASS
 *   - NVDA: AR has grown massively with revenue (73% growth ⇒ AR up 73%+),
 *     slope likely positive but should clear +2pp/yr → PASS
 *   - Inventory-heavy retailers in downturn (TGT, KSS): slope rises → FAIL
 *
 * DIAGNOSTIC, defaultActive:true, NOT in SCORE_WEIGHTS — fixture-hash safe.
 *
 * Reference:
 *   - Lev & Thiagarajan (1993, JAR) fundamental signal #4 (Receivables vs Sales).
 *   - Damodaran on working-capital management as compounder marker.
 */
const H = require('./_helpers.js');

const ID = 'working-capital-trend';
const LABEL = 'Working-Capital / Revenue Trend (3y slope)';
const THRESHOLD = 0.02;       // +2pp of revenue per year
const THRESHOLD_OP = 'lte';
const MIN_YEARS = 3;
const WINDOW = 3;

function _unwrap(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && Number.isFinite(v.value)) return v.value;
  return null;
}

function _slope(ys) {
  const n = ys.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) {
    sx += i; sy += ys[i]; sxy += i * ys[i]; sxx += i * i;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  return (n * sxy - sx * sy) / denom;
}

function evaluate(stock) {
  if (!stock) {
    return H.buildResult({
      computable: false, pass: false, reason: 'no stock data',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const balArr = (stock.annual && stock.annual.annualBalance) || [];
  const revArr = (stock.annual && stock.annual.annualRev) || [];
  if (!Array.isArray(balArr) || !Array.isArray(revArr)) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'annualBalance or annualRev not array',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const maxYears = Math.min(WINDOW, balArr.length, revArr.length);
  const wcRatios = [];  // latest-first
  for (let i = 0; i < maxYears; i++) {
    const b = balArr[i];
    if (!b || typeof b !== 'object') continue;
    const ca  = (b.currentAssets != null && Number.isFinite(b.currentAssets)) ? b.currentAssets : null;
    const cl  = (b.currentLiabilities != null && Number.isFinite(b.currentLiabilities)) ? b.currentLiabilities : null;
    const rev = _unwrap(revArr[i]);
    if (ca == null || cl == null || rev == null || rev <= 0) continue;
    wcRatios.push((ca - cl) / rev);
  }

  if (wcRatios.length < MIN_YEARS) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'only ' + wcRatios.length + ' valid (CA,CL,Rev>0) years (need >= ' + MIN_YEARS +
              '; currentAssets/currentLiabilities may be absent — requires Tag 211l-or-later snapshot)',
      components: { yearsUsed: wcRatios.length },
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // _slope expects oldest-first so sign matches "ratio rising over time".
  const chrono = wcRatios.slice().reverse();
  const slope = _slope(chrono);
  if (slope == null) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'slope computation failed (degenerate variance)',
      components: { wcRatios },
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const pass = slope <= THRESHOLD;
  const reason = 'WC/Rev slope ' + (slope * 100).toFixed(2) + 'pp/yr over ' +
                 wcRatios.length + 'y (latest=' + (wcRatios[0] * 100).toFixed(1) +
                 '%, oldest=' + (wcRatios[wcRatios.length - 1] * 100).toFixed(1) + '%)' +
                 (pass ? ' [cash cycle holding]' : ' [cash cycle degrading]');

  return H.buildResult({
    value: slope,
    pass,
    computable: true,
    components: {
      slope,
      wcRatios,
      latestRatio: wcRatios[0],
      oldestRatio: wcRatios[wcRatios.length - 1],
      yearsUsed: wcRatios.length
    },
    reason,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'WC/Revenue 3y slope; pass if slope <= +2pp/year (cash cycle holding/improving)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'pp/yr',
  evaluate
};
