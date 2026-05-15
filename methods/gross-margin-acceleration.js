'use strict';
/**
 * Tag 195: Gross-Margin-Acceleration
 * ===================================
 * Pre-Breakout signal: gross margin improved across 3 consecutive periods.
 * Quarterly preferred (faster signal); annual fallback when quarterly GP
 * series is too short.
 *
 *   pass     = 3 consecutive period-over-period GM improvements (min delta > 0)
 *   trend    = accelerating (all 3 deltas > 0) |
 *              decelerating (all 3 deltas < 0) |
 *              stable       (mixed)
 *
 * Why a separate method from gross-margin-stability:
 *   - stability measures dispersion (CoV) — rewards flat GM.
 *   - acceleration measures direction — rewards rising GM, which is the
 *     leading-indicator signal that PLTR/CRDO/ALAB-style pre-breakouts share.
 *
 * Unit basis: gross-margin in percentage-points (pp). value is the minimum
 * of the 3 consecutive deltas. pass when min > 0 (every step improved).
 *
 * Periods used: 4 GM points → 3 deltas. Quarterly preferred when
 * timeseries.revenueQ + timeseries.grossProfitQ each have ≥ 4 entries,
 * otherwise falls back to annual.annualRev + annual.annualGP (≥ 4 years).
 */
const H = require('./_helpers.js');

const ID = 'gross-margin-acceleration';
const LABEL = 'GM-Acceleration';
const THRESHOLD = 0;          // pp; min(deltas) > 0 means 3 consecutive improvements
const THRESHOLD_OP = 'gt';
const PERIODS_REQUIRED = 4;   // 4 GM points → 3 deltas

function _unwrap(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && Number.isFinite(v.value)) return v.value;
  return null;
}

function _computeMargins(revArr, gpArr, n) {
  const margins = [];
  for (let i = 0; i < n; i++) {
    const r = _unwrap(revArr[i]);
    const g = _unwrap(gpArr[i]);
    if (r == null || g == null || r <= 0) return null;
    margins.push(g / r * 100);  // percentage-points
  }
  return margins;
}

function _classify(deltas) {
  const min = Math.min(...deltas);
  const max = Math.max(...deltas);
  if (min > 0) return 'accelerating';
  if (max < 0) return 'decelerating';
  return 'stable';
}

function evaluate(stock) {
  const revQ = (stock && stock.timeseries && stock.timeseries.revenueQ) || [];
  const gpQ  = (stock && stock.timeseries && stock.timeseries.grossProfitQ) || [];
  const revY = (stock && stock.annual && stock.annual.annualRev) || [];
  const gpY  = (stock && stock.annual && stock.annual.annualGP) || [];

  let margins = null;
  let periodsUsed = null;

  if (revQ.length >= PERIODS_REQUIRED && gpQ.length >= PERIODS_REQUIRED) {
    margins = _computeMargins(revQ, gpQ, PERIODS_REQUIRED);
    if (margins) periodsUsed = 'quarterly';
  }
  if (!margins && revY.length >= PERIODS_REQUIRED && gpY.length >= PERIODS_REQUIRED) {
    margins = _computeMargins(revY, gpY, PERIODS_REQUIRED);
    if (margins) periodsUsed = 'annual';
  }

  if (!margins) {
    return H.buildResult({
      computable: false,
      reason: 'need 4 consecutive rev+gp points; got q=' + revQ.length + '/' + gpQ.length +
              ' y=' + revY.length + '/' + gpY.length,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // margins[0] is the latest. Delta-from-previous: margins[i] - margins[i+1].
  // 3 deltas: latest-vs-prev, prev-vs-prev2, prev2-vs-prev3.
  const deltas = [
    margins[0] - margins[1],
    margins[1] - margins[2],
    margins[2] - margins[3]
  ];
  const minDelta = Math.min(...deltas);
  const trend = _classify(deltas);
  const change3periods = margins[0] - margins[3];  // pp change over the 3-period span

  return H.buildResult({
    value: minDelta,
    pass: minDelta > THRESHOLD,
    computable: true,
    components: {
      trend,
      change3periods,
      periodsUsed,
      gm: margins.map(m => Math.round(m * 100) / 100),
      deltas: deltas.map(d => Math.round(d * 100) / 100)
    },
    reason: trend + ' (' + periodsUsed + '): ' +
            margins.slice().reverse().map(m => m.toFixed(1) + '%').join(' → ') +
            ' Δ3=' + (change3periods >= 0 ? '+' : '') + change3periods.toFixed(2) + 'pp',
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Gross-Margin verbessert sich in 3 aufeinanderfolgenden Perioden (quartalsweise bevorzugt) — Pre-Breakout-Signal',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'pp',
  evaluate
};
