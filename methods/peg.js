'use strict';
const H = require('./_helpers.js');

const ID = 'peg';
const LABEL = 'PEG (Lynch)';
const THRESHOLD = 1.5;
const THRESHOLD_OP = 'lte';

function evaluate(stock) {
  const pe_val = H.metricValue(stock, 'pe');
  const pe = (pe_val != null) ? pe_val : H.metricValue(stock, 'forwardPE');
  const growth = H.metricValue(stock, 'revenueGrowthYoY');
  if (pe == null || growth == null) {
    return H.buildResult({
      computable: false, reason: `missing pe=${pe} growth=${growth}`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  if (pe <= 0 || growth <= 0) {
    return H.buildResult({
      computable: false, reason: `pe ≤ 0 or negative growth`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  // PEG: PE / Growth-as-percent (so growth=20% → 20)
  const value = pe / growth;
  return H.buildResult({
    value,
    pass: value <= THRESHOLD,
    computable: true,
    components: { pe, growthYoY: growth },
    reason: `PE=${pe.toFixed(1)} / Growth=${growth.toFixed(1)}% → PEG=${value.toFixed(2)}`,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'PEG (P/E ÷ Growth) ≤ 1.5 (Lynch)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
