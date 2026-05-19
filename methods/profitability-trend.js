'use strict';
/**
 * Tag 98: Profitability-Trend (CORE)
 * ===================================
 * Misst die RICHTUNG der Profitability-Entwicklung - orthogonal zu profitability-state.
 *
 *   IMPROVING     - netIncome wächst meaningful YoY ODER signs flippen positiv
 *   FLAT          - netIncome stabil (±20% YoY)
 *   DETERIORATING - netIncome fällt >20% YoY ODER signs flippen negativ
 *
 * Pass-Logik: pass = trend ∈ {IMPROVING, FLAT}. DETERIORATING failt.
 *
 * 2-Achsen-Matrix mit profitability-state:
 *
 *                IMPROVING    FLAT    DETERIORATING
 *   STABLE       Compounder   Solid   Quality-Erosion
 *   EMERGING     Turnaround   Fragile Risky
 *   LOSS         Improving    Stuck   Death-Spiral
 *
 * Karl filtert nach "STABLE × IMPROVING" für Compounder oder "EMERGING × IMPROVING"
 * für Turnaround-Discovery. "LOSS × IMPROVING" wird über Rule-of-40 gefangen wenn growth da ist.
 */
const H = require('./_helpers.js');

const ID = 'profitability-trend';
const LABEL = 'Profitability Trend';
const THRESHOLD = 'FLAT';
const THRESHOLD_OP = 'gte';

function _getNetIncomeArr(stock) {
  const arr = H.val(stock, 'annual.annualNetIncome');
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr.map(v => (v == null ? null : (typeof v === 'number' ? v : v.value)));
}

function _classify(niArr) {
  // Brauchen mindestens Y-0 und Y-1 für Trend.
  if (!niArr || niArr.length < 2) return null;
  const y0 = niArr[0];
  const y1 = niArr[1];
  if (y0 == null || y1 == null) return null;

  // Sign-Flip-Cases first (require minimum $1M absolute swing for materiality)
  if (y0 > 0 && y1 <= 0) return Math.abs(y0 - y1) > 1e6 ? 'IMPROVING' : 'FLAT';   // turnaround
  if (y0 <= 0 && y1 > 0) return 'DETERIORATING'; // erosion

  // Same-sign-Cases - relative change
  if (y0 > 0 && y1 > 0) {
    const change = (y0 - y1) / y1;
    if (change > 0.20) return 'IMPROVING';
    if (change < -0.20) return 'DETERIORATING';
    return 'FLAT';
  }
  // Both negative: less negative = improving
  if (y0 < 0 && y1 < 0) {
    // y0 > y1 wenn loss kleiner geworden ist (e.g. -30 > -50 -> improving)
    const absChange = Math.abs(y0) - Math.abs(y1);
    if (absChange < -Math.abs(y1) * 0.20) return 'IMPROVING';  // loss shrunk by >20%
    if (absChange > Math.abs(y1) * 0.20) return 'DETERIORATING'; // loss grew by >20%
    return 'FLAT';
  }
  // Both zero - incomputable (no meaningful trend)
  if (y0 === 0 && y1 === 0) return null;
  return 'FLAT';
}

function evaluate(stock) {
  const niArr = _getNetIncomeArr(stock);
  if (!niArr || niArr.length < 2) {
    return H.buildResult({
      computable: false,
      reason: 'insufficient netIncome history (need ≥2 years)',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const trend = _classify(niArr);
  if (trend == null) {
    return H.buildResult({
      computable: false,
      reason: 'cannot classify trend - null netIncome',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const trendRank = { DETERIORATING: 0, FLAT: 1, IMPROVING: 2 }[trend];
  const pass = trendRank >= 1;  // FLAT oder IMPROVING
  return H.buildResult({
    value: trendRank,
    pass,
    computable: true,
    components: { trend, y0: niArr[0], y1: niArr[1] },
    reason: `trend=${trend} (Y-0=${niArr[0]}, Y-1=${niArr[1]})`,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'IMPROVING / FLAT / DETERIORATING - direction of netIncome change',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'trend',
  evaluate
};
