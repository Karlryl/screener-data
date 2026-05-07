'use strict';
const H = require('./_helpers.js');

const ID = 'revenue-growth-3y';
const LABEL = 'Revenue-Growth-3Y CAGR';
const THRESHOLD = 25;  // %
const THRESHOLD_OP = 'gte';

function evaluate(stock) {
  const arr = (stock && stock.annual && stock.annual.annualRev) || [];
  if (arr.length < 4) {
    return H.buildResult({
      computable: false,
      reason: `need ≥ 4 annual revenues, got ${arr.length}`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const cagr = H.cagr3y(arr);
  if (cagr == null) {
    return H.buildResult({
      computable: false,
      reason: 'cagr calc failed (zero or negative oldest)',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  return H.buildResult({
    value: cagr,
    pass: cagr >= THRESHOLD,
    computable: true,
    components: { latest: arr[0].value, oldest: arr[3].value },
    reason: `3y CAGR = ${cagr.toFixed(1)}% (${(arr[0].value/1e9).toFixed(1)}B vs ${(arr[3].value/1e9).toFixed(1)}B)`,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Revenue Growth 3-Year-CAGR ≥ 25% (Hypergrowth-Konsistenz über 3 Jahre)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'percent',
  evaluate
};
