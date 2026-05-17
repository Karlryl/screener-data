'use strict';
/**
 * Tag 212a: Operating-Leverage (Margin-Acceleration variant)
 * ===========================================================
 * RESEARCH BASIS:
 *   Mauboussin, M. (Counterpoint Global, 2014). "Capital Allocation: Evidence,
 *   Analytical Methods, and Assessment Guidance." Discusses operating leverage
 *   as the rate at which margin expands with scale — a core quality-compounder
 *   signal. Damodaran, A. (NYU Stern) treats operating leverage as a structural
 *   determinant of risk and quality: high-quality compounders show margin
 *   EXPANDING as revenue grows; weak businesses show flat or compressing
 *   margins despite growth (scale dis-economies).
 *
 * DISTINCT FROM existing operating-leverage.js (Tag 196):
 *   - Tag 196 (operating-leverage): single 3-year window incremental margin
 *     ΔOI/ΔRev — "cents of OI per $1 of new revenue." Practitioner-style
 *     point estimate; sensitive to endpoint years.
 *   - Tag 212a (this method, operating-leverage-margin-accel): year-by-year
 *     margin-acceleration averaged across multiple positive-growth pairs —
 *     "pp of margin expansion per 100% revenue growth." Mauboussin-style
 *     averaged signal; robust to endpoint noise; explicitly conditions on
 *     positive-growth years so contraction years don't pollute the average.
 *   The two are complementary: 196 answers "what's the incremental flow-
 *   through?", 212a answers "is the margin trajectory expanding as the
 *   business scales?".
 *
 * Formula (latest-first arrays, like every other annual.* field):
 *   For each consecutive pair (year i, year i+1) within the last 4+ years:
 *     revGrowth_i   = (annualRev[i] - annualRev[i+1]) / annualRev[i+1]
 *     opMargin_i    = annualOpInc[i]   / annualRev[i]
 *     opMargin_prev = annualOpInc[i+1] / annualRev[i+1]
 *     marginDelta_i = opMargin_i - opMargin_prev    (in pp, e.g. 0.02 = +2pp)
 *   For pairs where revGrowth_i > 0.05 (positive growth, 5% noise floor):
 *     leverage_i = marginDelta_i / revGrowth_i
 *   value = arithmetic mean of leverage_i across all positive-growth pairs.
 *
 * Gates:
 *   - need >= 4 years of annualRev AND annualOpInc, all with rev > 0
 *   - need >= 2 positive-growth pairs (no signal possible without growth periods)
 *
 * Pass: value > 0.05 (5pp of margin expansion per 100% revenue growth).
 *       Pure-software compounders typically show 0.10+; mature businesses
 *       near 0; scale-dis-economies businesses are negative.
 *
 * FAILURE MODE THIS DETECTS:
 *   - Operating-margin compression while revenue grows (scale dis-economies,
 *     commoditization, cost-of-revenue inflation outpacing pricing).
 *   - "Growth without leverage": companies adding revenue at flat OpM cannot
 *     compound earnings faster than top-line; the durable-quality signal is
 *     specifically about whether the operating engine is improving with scale.
 *
 * Edge cases / why it might be incomputable:
 *   - Fewer than 4 valid (OpInc, Rev>0) years.
 *   - Fewer than 2 positive-growth (>5%) pairs: company hasn't actually
 *     grown — operating leverage is undefined.
 *
 * NOT in SCORE_WEIGHTS -> DIAGNOSTIC-only -> fixture-hash safe by construction.
 */
const H = require('./_helpers.js');

const ID = 'operating-leverage-margin-accel';
const LABEL = 'Op-Leverage (Margin-Acceleration)';
const THRESHOLD = 0.05;
const THRESHOLD_OP = 'gt';
const MIN_YEARS = 4;
const MIN_POS_PAIRS = 2;
const POS_GROWTH_FLOOR = 0.05; // 5% noise gate

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
  const revArr = (stock.annual && stock.annual.annualRev)   || [];
  const oiArr  = (stock.annual && stock.annual.annualOpInc) || [];
  if (!Array.isArray(revArr) || !Array.isArray(oiArr)) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'annualRev or annualOpInc not array',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // Collect aligned (rev, oi) tuples for the latest N years where rev>0 and oi is finite.
  const horizon = Math.min(revArr.length, oiArr.length);
  const years = [];
  for (let i = 0; i < horizon; i++) {
    const rev = _unwrap(revArr[i]);
    const oi  = _unwrap(oiArr[i]);
    if (rev == null || oi == null || rev <= 0) continue;
    years.push({ rev, oi, opMargin: oi / rev });
  }

  if (years.length < MIN_YEARS) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'only ' + years.length + ' valid (OpInc, Rev>0) years (need >= ' + MIN_YEARS + ')',
      components: { yearsUsed: years.length },
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // Iterate consecutive pairs (i = newer, i+1 = older). Latest-first arrays.
  const leveragePairs = [];
  for (let i = 0; i < years.length - 1; i++) {
    const newer = years[i];
    const older = years[i + 1];
    const revGrowth = (newer.rev - older.rev) / older.rev;
    if (!Number.isFinite(revGrowth) || revGrowth <= POS_GROWTH_FLOOR) continue;
    const marginDelta = newer.opMargin - older.opMargin;
    const leverage = marginDelta / revGrowth;
    if (!Number.isFinite(leverage)) continue;
    leveragePairs.push({
      growth: Math.round(revGrowth * 10000) / 10000,
      marginDelta: Math.round(marginDelta * 10000) / 10000,
      leverage: Math.round(leverage * 10000) / 10000
    });
  }

  if (leveragePairs.length < MIN_POS_PAIRS) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'only ' + leveragePairs.length + ' positive-growth pairs (>' + (POS_GROWTH_FLOOR * 100).toFixed(0)
            + '%) in ' + years.length + 'y (need >= ' + MIN_POS_PAIRS + ')',
      components: { yearsUsed: years.length, positiveGrowthPairs: leveragePairs.length },
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const score = leveragePairs.reduce((s, p) => s + p.leverage, 0) / leveragePairs.length;
  const pass = score > THRESHOLD;

  return H.buildResult({
    value: score,
    pass,
    computable: true,
    components: {
      score: Math.round(score * 10000) / 10000,
      leveragePairs,
      yearsUsed: years.length,
      positiveGrowthPairs: leveragePairs.length,
      threshold: THRESHOLD
    },
    reason: 'leverage=' + score.toFixed(3) + ' (pp margin / unit rev growth) across '
          + leveragePairs.length + ' positive-growth pairs in ' + years.length + 'y window (floor > '
          + THRESHOLD + ')',
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Operating-Leverage (Margin-Acceleration) > 0.05 — pp of op-margin expansion per unit revenue growth, averaged across positive-growth pairs (Mauboussin 2014, Damodaran)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
