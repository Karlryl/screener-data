'use strict';
/**
 * Tag 214a: SG&A-to-Revenue Trend (cost-discipline detector)
 * ============================================================
 * Tracks whether selling/general/admin expense is growing FASTER than revenue
 * over the last 3 fiscal years — a leading indicator of operational bloat.
 * Companies with disciplined cost structures show falling or stable SGA/Rev
 * ratios as they scale; companies losing discipline show rising ratios.
 *
 * Activated by Tag 211l extracting annualSGA from FTS into snapshot.annual.
 * Before Tag 211l this method's data was unavailable; now it can fire on
 * any stock with 3+ years of SG&A + Revenue.
 *
 * Formula (latest-first arrays):
 *   For each of the last 3 fiscal years:
 *     sgaRatio_i = annualSGA[i] / annualRev[i]
 *   trendSlope = simple linear regression slope of (sgaRatio_0..2) vs year-index
 *                  — positive slope = ratio rising = cost discipline eroding
 *
 * Pass: trendSlope <= 0.005 (slope ≤ +0.5pp / year — discipline holding or
 *       improving). Threshold is conservative — 0.5pp per year of SGA bloat
 *       is the line between "normal cost creep" and "real discipline problem".
 *
 * Failure mode this catches:
 *   Mature firms whose top-line growth masks rising overhead (executive comp,
 *   sales-team expansion, M&A integration costs). A company with $10B rev and
 *   SGA going 12% → 14% → 16% looks healthy on margin metrics for years
 *   before the bloat starts compressing operating income.
 *
 * Not computable:
 *   - <3 valid (SGA, Rev>0) years → cannot compute trend
 *   - annualSGA absent (snapshot from before Tag 211l rollout)
 *   - All ratios > 1 (degenerate — SGA exceeds revenue, usually pre-IPO/loss)
 *
 * Anchor headcheck (post-Tag-211l pulls):
 *   - MSFT/COST/V: SGA discipline tight, slope ≈ 0 → PASS
 *   - NVDA: SGA grew slower than revenue (operating leverage) → slope negative → PASS
 *   - CRDO/post-IPO names: SGA absorption volatile, may FAIL or be incomputable
 *
 * DIAGNOSTIC, defaultActive: true, NOT in SCORE_WEIGHTS — fixture-hash safe.
 *
 * References:
 *   - Damodaran on operating leverage and cost rigidity.
 *   - Lev & Thiagarajan (1993, JAR) — "Fundamental Information Analysis" lists
 *     SGA-growth-vs-sales-growth as one of 12 fundamental signals correlated
 *     with future earnings.
 */
const H = require('./_helpers.js');

const ID = 'sga-revenue-trend';
const LABEL = 'SG&A / Revenue Trend (3y slope)';
const THRESHOLD = 0.005;     // 0.5pp per year — anything above suggests cost discipline eroding
const THRESHOLD_OP = 'lte';
const MIN_YEARS = 3;
const WINDOW = 3;

function _unwrap(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && Number.isFinite(v.value)) return v.value;
  return null;
}

// Simple least-squares slope of y vs x where x = [0..n-1].
// Returns slope in "y-units per x-unit" (= per year, since x is year-index).
function _slope(ys) {
  const n = ys.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) {
    sx  += i;
    sy  += ys[i];
    sxy += i * ys[i];
    sxx += i * i;
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
  const sgaArr = (stock.annual && stock.annual.annualSGA) || [];
  const revArr = (stock.annual && stock.annual.annualRev) || [];
  if (!Array.isArray(sgaArr) || !Array.isArray(revArr)) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'annualSGA or annualRev not array',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // Build the last 3 (SGA, Rev) pairs.
  const maxYears = Math.min(WINDOW, sgaArr.length, revArr.length);
  const sgaRatios = [];  // latest-first
  for (let i = 0; i < maxYears; i++) {
    const sga = _unwrap(sgaArr[i]);
    const rev = _unwrap(revArr[i]);
    if (sga == null || rev == null || rev <= 0) continue;
    sgaRatios.push(sga / rev);
  }

  if (sgaRatios.length < MIN_YEARS) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'only ' + sgaRatios.length + ' valid (SGA,Rev>0) years (need >= ' + MIN_YEARS +
              '; annualSGA may be absent — requires Tag 211l-or-later snapshot)',
      components: { yearsUsed: sgaRatios.length },
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // Degenerate guard: SGA > Revenue means pre-IPO / loss-making profile where
  // the trend signal is uninformative.
  if (sgaRatios.every(r => r > 1)) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'all 3 years SGA > Revenue (pre-revenue or extreme-loss profile — trend signal not meaningful)',
      components: { sgaRatios },
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // _slope expects oldest-first chronological order so the slope's sign
  // matches "ratio over time" intuition (positive = rising).
  const chrono = sgaRatios.slice().reverse();
  const slope = _slope(chrono);
  if (slope == null) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'slope computation failed (degenerate variance)',
      components: { sgaRatios },
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const pass = slope <= THRESHOLD;
  const reason = 'SGA/Rev slope ' + (slope * 100).toFixed(2) + 'pp/yr over ' +
                 sgaRatios.length + 'y (latest=' + (sgaRatios[0] * 100).toFixed(1) +
                 '%, oldest=' + (sgaRatios[sgaRatios.length - 1] * 100).toFixed(1) + '%)' +
                 (pass ? ' [discipline holding]' : ' [discipline eroding]');

  return H.buildResult({
    value: slope,
    pass,
    computable: true,
    components: {
      slope,
      sgaRatios,         // latest-first [pct as fraction]
      latestRatio: sgaRatios[0],
      oldestRatio: sgaRatios[sgaRatios.length - 1],
      yearsUsed: sgaRatios.length
    },
    reason,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'SG&A-to-Revenue trend slope over 3y; pass if slope <= +0.5pp/year (cost discipline holding)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'pp/yr',
  evaluate
};
