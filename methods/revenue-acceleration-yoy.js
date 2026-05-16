'use strict';
/**
 * Tag 199i: Revenue-YoY-Acceleration
 * ====================================
 * Pre-Breakout signal: this-year YoY growth > last-year YoY growth.
 * Captures the "growth re-acceleration" pattern that precedes
 * classification flips from RECENT → STABLE compounder profiles.
 *
 *   yoyT0   = annualRev[0] / annualRev[1] - 1
 *   yoyT-1  = annualRev[1] / annualRev[2] - 1
 *
 *   delta   = yoyT0 - yoyT-1  (percentage-points)
 *
 *   pass    = delta > 0       (this-year growing faster than last-year)
 *
 * Why this method over revenue-growth-3y (CAGR):
 *   - CAGR averages over the window; this measures the LATEST inflection
 *   - Acceleration is the leading-indicator signal; CAGR is the trailing
 *     summary
 *
 * Audit-trace examples (computed from current snapshots):
 *   PLTR: yoyT0=84.7%  yoyT-1=28.8%   Δ=+55.9pp  PASS — clean PB pattern
 *   CRDO: yoyT0=201.5% yoyT-1=4.8%    Δ=+196.7pp PASS — dramatic accel
 *   NVDA: yoyT0=73.2%  yoyT-1=114.2%  Δ=-41pp    FAIL — mature decel
 *   ALAB: yoyT0=93.4%  yoyT-1=242%    Δ=-148pp   FAIL — early-stage cool
 *
 * NVDA failing is the CORRECT outcome — it's a hypergrowth-mature stock,
 * not a Pre-Breakout candidate. PLTR and CRDO passing is what we want.
 *
 * Requires 3 annual revenue points (newest-first) with positive values.
 */
const H = require('./_helpers.js');

const ID = 'revenue-acceleration-yoy';
const LABEL = 'Rev-YoY-Acceleration';
const THRESHOLD = 0;
const THRESHOLD_OP = 'gt';

function _unwrap(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && Number.isFinite(v.value)) return v.value;
  return null;
}

function evaluate(stock) {
  const revArr = (stock && stock.annual && stock.annual.annualRev) || [];
  if (revArr.length < 3) {
    return H.buildResult({
      computable: false,
      reason: 'need ≥ 3 annual revenue points (got ' + revArr.length + ')',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const r0 = _unwrap(revArr[0]);
  const r1 = _unwrap(revArr[1]);
  const r2 = _unwrap(revArr[2]);
  if (r0 == null || r1 == null || r2 == null || r1 <= 0 || r2 <= 0) {
    return H.buildResult({
      computable: false,
      reason: 'invalid rev[0..2] = ' + r0 + ', ' + r1 + ', ' + r2,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const yoyT0 = (r0 - r1) / r1;
  const yoyT1 = (r1 - r2) / r2;
  const delta = (yoyT0 - yoyT1) * 100;  // pp

  return H.buildResult({
    value: delta,
    pass: delta > THRESHOLD,
    computable: true,
    components: {
      yoyT0: Math.round(yoyT0 * 10000) / 10000,
      yoyT1: Math.round(yoyT1 * 10000) / 10000,
      accelerating: delta > 0
    },
    reason: 'YoY T-1=' + (yoyT1*100).toFixed(1) + '% → T0=' + (yoyT0*100).toFixed(1) +
            '% Δ=' + (delta >= 0 ? '+' : '') + delta.toFixed(1) + 'pp',
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Revenue-YoY-Wachstum beschleunigt sich (T0 > T-1) — Pre-Breakout-Signal',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'pp',
  evaluate
};
