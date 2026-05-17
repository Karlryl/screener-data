'use strict';
const H = require('./_helpers.js');

// Tag 206e (Bug-Hunt Agent C HIGH-3): id was truncated 'quarterly-rev-acceleration'
// but the file is named quarterly-revenue-acceleration.js. Neither name was in
// REGISTRY or SCORE_WEIGHTS — method was loaded but completely unread. Align id
// to the file name and register in method-types.js.
//
// Tag 221c (audit F-220a-03): this method intentionally does NOT use a
// materiality check (it operates on a single QoQ ratio, not absolute revenue),
// so it is unaffected by the engine-v7.3 isRevenueMaterial FX-mismatch bug.
// The companion fix in engine-v7.3.js threads reportingCurrency + fxRates
// into isRevenueMaterial for the dormant Track-A/B path.
const ID = 'quarterly-revenue-acceleration';
const LABEL = 'Quarterly-Rev-Acceleration';
const THRESHOLD = 1.10;
const THRESHOLD_OP = 'gte';

// Latest quarter Revenue / Previous quarter Revenue ≥ 1.10 = 10% QoQ-Wachstum
function evaluate(stock) {
  const ts = (stock && stock.timeseries && stock.timeseries.revenueQ) || [];
  if (ts.length < 2) {
    return H.buildResult({
      computable: false, reason: `need ≥ 2 quarterly rev (got ${ts.length})`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  // F-ME-004 (Tag 183): unwrap either plain number or {value: x} envelope.
  // Previously `ts[0] && ts[0].value` returned undefined when ts[0] was a plain
  // number (e.g. older snapshots), silently making the method incomputable for
  // those tickers.
  function _unwrap(v) {
    if (v == null) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'object' && Number.isFinite(v.value)) return v.value;
    return null;
  }
  const latest = _unwrap(ts[0]);
  const prev = _unwrap(ts[1]);
  if (latest == null || prev == null || prev <= 0) {
    return H.buildResult({
      computable: false, reason: 'missing/zero values',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const value = latest / prev;
  return H.buildResult({
    value,
    pass: value >= THRESHOLD,
    computable: true,
    components: { latestQ: latest, prevQ: prev },
    reason: `Q-1=${(prev/1e9).toFixed(2)}B → Q=${(latest/1e9).toFixed(2)}B (×${value.toFixed(2)})`,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Quarterly Revenue QoQ ≥ 1.10 (10% Beschleunigung)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
