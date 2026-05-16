'use strict';
/**
 * Tag 204: FCF-Margin-Stability (Coefficient-of-Variation over 4y)
 * ================================================================
 * RESEARCH BASIS:
 *   Asness, Frazzini, Pedersen (2019) "Quality Minus Junk", Review of
 *   Accounting Studies. The QMJ score defines quality across four pillars:
 *   profitability, growth, safety, and payout. The SAFETY pillar explicitly
 *   uses LOW VOLATILITY OF PROFITABILITY as a quality marker — companies
 *   whose earnings/cashflow series are stable command higher multiples and
 *   exhibit better risk-adjusted returns over long horizons. This method
 *   adapts the SAFETY pillar to FCF margin (FCF/Revenue), which is harder
 *   to manipulate via accruals than reported NI.
 *
 * Distinct from existing fcf-yield (current FCF/MCap) and the existing
 * gross-margin-stability (which measures GM, not FCF):
 *   - fcf-yield: "is FCF generation high enough RIGHT NOW?"
 *   - gross-margin-stability: "is pricing power stable?"
 *   - fcf-stability: "is the cash-generating engine reliable across cycles?"
 *
 * Formula (latest-first arrays, like every other annual.* field):
 *   For each of the last 4 fiscal years where BOTH annualFCF[i] and
 *   annualRev[i] are finite and annualRev[i] > 0:
 *     fcfMargin[i] = annualFCF[i] / annualRev[i]
 *   Then compute coefficient of variation:
 *     CoV = stdev(fcfMargin[]) / |mean(fcfMargin[])|
 *
 * Pass: CoV <= 0.40 (40% relative dispersion — calibrated to let modest
 *       cyclicality through while flagging genuinely lumpy cash generation).
 *
 * FAILURE MODE THIS DETECTS:
 *   A company with one giant FCF year (driven by a working-capital release,
 *   tax timing, or one-time milestone payment) masking 3 weak years. Score
 *   aggregators that consume the most-recent FCF margin score these stocks
 *   as quality compounders when in fact the cash-generation is non-recurring.
 *   The Sloan-Ratio catches accrual-driven NI inflation but does NOT catch
 *   genuine but volatile FCF; this method is the independent cross-check.
 *
 * Edge cases:
 *   - <3 clean (FCF, Rev) pairs → incomputable (need at least 3 of 4 years).
 *   - mean(margins) === 0 → degenerate denominator; flag as incomputable
 *     with a structured reason rather than emitting Infinity.
 *   - Mixed-sign margins (e.g. one negative FCF year amid positives) → still
 *     computable; the |mean| absolute-value denominator keeps CoV finite as
 *     long as the average isn't exactly zero, and a mixed-sign series is
 *     EXACTLY the lumpy-FCF pattern we want to catch.
 *   - FCF/Rev envelopes ({value:N}) OR raw numbers → both supported via
 *     _unwrap helper (same pattern as roic-trend / buyback-yield / sbc-trend).
 *
 * Anchor headcheck (per design spec — pattern-based, no ticker hardcodes):
 *   MSFT/GOOG/MA all have FCF/Rev CoV < 0.15 (very stable cash engines).
 *   PLTR/CRDO higher (recent IPO, ramping FCF) but expected < 0.40 still pass.
 *
 * NOT in SCORE_WEIGHTS → DIAGNOSTIC-only → fixture-hash safe.
 */
const H = require('./_helpers.js');

const ID = 'fcf-stability';
const LABEL = 'FCF-Margin-Stability (CoV 4y)';
const THRESHOLD = 0.40;
const THRESHOLD_OP = 'lte';
const MIN_PAIRS = 3;
const WINDOW = 4;

function _unwrap(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && Number.isFinite(v.value)) return v.value;
  return null;
}

function evaluate(stock) {
  if (!stock) {
    return H.buildResult({
      computable: false, pass: false, reason: 'no stock data',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const fcfArr = (stock.annual && stock.annual.annualFCF) || [];
  const revArr = (stock.annual && stock.annual.annualRev) || [];
  if (!Array.isArray(fcfArr) || !Array.isArray(revArr)) {
    return H.buildResult({
      computable: false,
      reason: 'annualFCF or annualRev not array',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const maxYears = Math.min(WINDOW, fcfArr.length, revArr.length);
  const margins = [];
  for (let i = 0; i < maxYears; i++) {
    const fcf = _unwrap(fcfArr[i]);
    const rev = _unwrap(revArr[i]);
    // Require positive revenue — a 0/negative-rev year has no meaningful margin.
    if (fcf == null || rev == null || rev <= 0) continue;
    margins.push(fcf / rev);
  }
  if (margins.length < MIN_PAIRS) {
    return H.buildResult({
      computable: false,
      reason: 'only ' + margins.length + ' clean (FCF,Rev) pairs (need >= ' + MIN_PAIRS + ')',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const n = margins.length;
  const mean = margins.reduce((s, x) => s + x, 0) / n;
  if (mean === 0) {
    return H.buildResult({
      computable: false,
      reason: 'mean FCF margin = 0 (degenerate denominator)',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const variance = margins.reduce((s, x) => s + (x - mean) * (x - mean), 0) / n;
  const stdev = Math.sqrt(variance);
  const cov = stdev / Math.abs(mean);

  return H.buildResult({
    value: cov,
    pass: cov <= THRESHOLD,
    computable: true,
    components: {
      cov: Math.round(cov * 10000) / 10000,
      meanMarginPct: Math.round(mean * 10000) / 100,
      stdevMarginPct: Math.round(stdev * 10000) / 100,
      n,
      margins: margins.map(m => Math.round(m * 10000) / 10000)
    },
    reason: 'FCF/Rev mean=' + (mean * 100).toFixed(1) + '% σ=' +
            (stdev * 100).toFixed(1) + '% CoV=' + cov.toFixed(2) +
            ' (n=' + n + ')',
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'FCF-Margin CoV ≤ 0.40 über 4y — Safety-Säule (Asness/Frazzini/Pedersen QMJ)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
