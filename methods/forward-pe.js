'use strict';
const H = require('./_helpers.js');

const ID = 'forward-pe';
const LABEL = 'Forward-PE';
const THRESHOLD = 40;
const THRESHOLD_OP = 'lte';

function evaluate(stock) {
  const fpe = H.metricValue(stock, 'forwardPE');
  if (fpe == null) {
    return H.buildResult({
      computable: false, reason: 'no forwardPE in Yahoo data',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  if (fpe <= 0) {
    return H.buildResult({
      computable: false, reason: 'forwardPE ≤ 0 (negative earnings forecast)',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  return H.buildResult({
    value: fpe,
    pass: fpe <= THRESHOLD,
    computable: true,
    components: { forwardPE: fpe },
    reason: `Forward-PE ${fpe.toFixed(1)} (vs ≤${THRESHOLD})`,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Forward-PE ≤ 40 (Bewertungs-Sanity, Hypergrowth toleriert mehr)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'composite',
  evaluate
};
