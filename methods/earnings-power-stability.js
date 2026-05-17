'use strict';
/**
 * Tag 211d: Earnings-Power-Stability (Operating-Margin CoV over 5y)
 * ==================================================================
 * RESEARCH BASIS:
 *   Lepetit, F., Cherief, A., Ly, Y. & Sekine, T. (2024). "Revisiting Quality
 *   Investing." SSRN 3877161. The Lepetit et al. quality framework defines
 *   FOUR pillars: profitability, growth, SAFETY, and payout. The SAFETY
 *   pillar uses the volatility/stability of earnings power as a primary
 *   marker — boring, consistent operators command higher multiples and exhibit
 *   better risk-adjusted returns. This method implements the Safety-pillar
 *   proxy via the coefficient-of-variation of operating margin (OI/Rev) over
 *   the most recent 5 fiscal years.
 *
 * Companion of fcf-stability.js (Tag 204) which measures FCF-margin CoV:
 *   - fcf-stability:           "is cash generation reliable across cycles?"
 *   - earnings-power-stability: "is the underlying operating engine reliable?"
 *   The two together triangulate the QMJ/Lepetit Safety pillar: a company
 *   stable on BOTH margins is a textbook quality compounder; stable FCF with
 *   unstable OI suggests one-time cash items; stable OI with lumpy FCF
 *   suggests working-capital cyclicality.
 *
 * Formula (latest-first arrays, like every other annual.* field):
 *   For each of the last 5 fiscal years where annualRev[i] > 0 and
 *   annualOpInc[i] is finite:
 *     opMargin[i] = annualOpInc[i] / annualRev[i]
 *   Require at least 4 valid years. Then:
 *     CoV = stdev(opMargin[]) / |mean(opMargin[])|
 *
 * Pass (TWO gates, both must hold):
 *   1. CoV <= 0.30        (≤30% relative dispersion — boring/stable operator)
 *   2. mean(opMargin) > 0.05  (mean op-margin > 5% — avoid passing "stably bad"
 *                              companies whose CoV looks fine only because
 *                              they're consistently unprofitable)
 *
 * FAILURE MODE THIS DETECTS:
 *   Cyclicals with wild margin swings that score well on a single latest-year
 *   ROIC/op-margin snapshot but cannot be relied on across a holding period.
 *   Also catches "stable disasters" via the mean-margin floor — a company
 *   with a -2% op-margin every year would have a low CoV but is the opposite
 *   of a quality compounder.
 *
 * Edge cases / why it might be incomputable:
 *   - Fewer than 4 valid (OpInc, Rev>0) years → incomputable (need at least
 *     4 of 5 for the CoV to be statistically meaningful).
 *   - mean(opMargin) <= 0 → CoV is uninformative (positive denominator
 *     required for the |mean| normalization to be interpretable as relative
 *     dispersion). Marked incomputable rather than emitting a misleading
 *     "stable" pass for a perennially loss-making firm.
 *   - annualRev[i] <= 0 → year skipped; the absolute-value-of-mean denominator
 *     can otherwise produce false stability signals.
 *
 * Anchor headcheck (pattern-based, no ticker hardcodes):
 *   - MSFT/COST/ADP: op-margin remarkably stable across 5y, CoV typically
 *     < 0.10 and mean OpM > 15% → clean PASS.
 *   - Pure cyclicals (steel, airlines, chemicals): CoV 0.5+ → clean FAIL.
 *   - Hyper-growth pre-profit (NET, IONQ): mean OpM <= 0 → NOT COMPUTABLE
 *     (correct behavior — we can't measure stability of an absent margin).
 *
 * NOT in SCORE_WEIGHTS → DIAGNOSTIC-only → fixture-hash safe by construction.
 */
const H = require('./_helpers.js');

const ID = 'earnings-power-stability';
const LABEL = 'Earnings-Power-Stability (OpM CoV 5y)';
const THRESHOLD = 0.30;
const THRESHOLD_OP = 'lte';
const MIN_YEARS = 4;
const WINDOW = 5;
const MEAN_MARGIN_FLOOR = 0.05; // mean OpM must exceed 5% to avoid passing "stably bad"

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
  const oiArr  = (stock.annual && stock.annual.annualOpInc) || [];
  const revArr = (stock.annual && stock.annual.annualRev)   || [];
  if (!Array.isArray(oiArr) || !Array.isArray(revArr)) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'annualOpInc or annualRev not array',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const maxYears = Math.min(WINDOW, oiArr.length, revArr.length);
  const opMargins = [];
  for (let i = 0; i < maxYears; i++) {
    const oi  = _unwrap(oiArr[i]);
    const rev = _unwrap(revArr[i]);
    if (oi == null || rev == null || rev <= 0) continue;
    opMargins.push(oi / rev);
  }

  if (opMargins.length < MIN_YEARS) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'only ' + opMargins.length + ' valid (OpInc,Rev>0) years (need >= ' + MIN_YEARS + ')',
      components: { yearsUsed: opMargins.length },
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const n = opMargins.length;
  const mean = opMargins.reduce((s, x) => s + x, 0) / n;

  if (mean <= 0) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'mean op-margin <= 0 (' + (mean * 100).toFixed(1) + '%) — CoV uninformative for loss-making firm',
      components: { meanOpMargin: Math.round(mean * 10000) / 10000, yearsUsed: n,
                    opMargins: opMargins.map(m => Math.round(m * 10000) / 10000) },
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const variance = opMargins.reduce((s, x) => s + (x - mean) * (x - mean), 0) / n;
  const stdev = Math.sqrt(variance);
  const cov = stdev / Math.abs(mean);

  const covPass  = cov <= THRESHOLD;
  const meanPass = mean > MEAN_MARGIN_FLOOR;
  const pass = covPass && meanPass;

  let reason = 'OpM mean=' + (mean * 100).toFixed(1) + '% sigma=' + (stdev * 100).toFixed(1)
             + '% CoV=' + cov.toFixed(2) + ' (n=' + n + ', floors CoV<=' + THRESHOLD
             + ' & mean>' + (MEAN_MARGIN_FLOOR * 100).toFixed(0) + '%)';
  if (!covPass) reason += ' — CoV breach';
  if (!meanPass) reason += ' — mean-margin breach';

  return H.buildResult({
    value: cov,
    pass,
    computable: true,
    components: {
      cov: Math.round(cov * 10000) / 10000,
      meanOpMargin: Math.round(mean * 10000) / 10000,
      stdevOpMargin: Math.round(stdev * 10000) / 10000,
      opMargins: opMargins.map(m => Math.round(m * 10000) / 10000),
      yearsUsed: n,
      covPass, meanPass,
      thresholds: { cov: THRESHOLD, meanFloor: MEAN_MARGIN_FLOOR }
    },
    reason,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Operating-Margin CoV <= 0.30 over 5y AND mean OpM > 5% — Safety pillar (Lepetit et al. 2024, SSRN 3877161)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
