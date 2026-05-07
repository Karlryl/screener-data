'use strict';
const H = require('./_helpers.js');

const ID = 'quarterly-rev-acceleration';
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
  const latest = ts[0] && ts[0].value;
  const prev = ts[1] && ts[1].value;
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
