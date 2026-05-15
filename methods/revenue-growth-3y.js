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
  // Bug #1: arr elements can be plain numbers or {value:...} objects — handle both
  const latestVal = typeof arr[0] === 'number' ? arr[0] : (arr[0] && arr[0].value);
  const oldestVal = typeof arr[3] === 'number' ? arr[3] : (arr[3] && arr[3].value);
  return H.buildResult({
    value: cagr,
    pass: cagr >= THRESHOLD,
    computable: true,
    components: { latest: latestVal, oldest: oldestVal },
    reason: `3y CAGR = ${cagr.toFixed(1)}% (${(latestVal/1e9).toFixed(1)}B vs ${(oldestVal/1e9).toFixed(1)}B)`,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Revenue Growth 3-Year-CAGR ≥ 25% (Hypergrowth-Konsistenz über 3 Jahre)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'percent',
  evaluate
};
