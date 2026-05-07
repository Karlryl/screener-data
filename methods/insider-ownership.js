'use strict';
const H = require('./_helpers.js');

const ID = 'insider-ownership';
const LABEL = 'Insider Ownership';
const THRESHOLD = 0.05;  // 5%
const THRESHOLD_OP = 'gte';

// Insider haben Skin in the Game wenn ≥5% des outstanding shares.
// Yahoo: heldPercentInsiders (als 0.05 = 5% repräsentiert)
function evaluate(stock) {
  const ins = H.metricValue(stock, 'insidersOwnership');
  if (ins == null) {
    return H.buildResult({
      computable: false, reason: 'no insider data in Yahoo (heldPercentInsiders missing)',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  return H.buildResult({
    value: ins,
    pass: ins >= THRESHOLD,
    computable: true,
    components: { insidersOwnership: ins },
    reason: `Insiders halten ${(ins*100).toFixed(1)}%`,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Insider-Anteil ≥ 5% (Skin in the Game)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
