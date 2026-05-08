'use strict';
const H = require('./_helpers.js');

const ID = 'recent-profitability';
const LABEL = 'Recent Profitability (2y)';
const THRESHOLD = 2;
const THRESHOLD_OP = 'gte';

// Letzte 2 Jahre profitable (NI+FCF+OpInc alle > 0).
// Für früh-stage Compounder, Hypergrowth-Stocks die seit 2 Jahren konsistent profitable.
function evaluate(stock) {
  const ni = (stock.annual?.annualNetIncome) || [];
  const fcf = (stock.annual?.annualFCF) || [];
  const oi = (stock.annual?.annualOpInc) || [];
  if (ni.length < 2 || fcf.length < 2 || oi.length < 2) {
    return H.buildResult({
      computable: false,
      reason: `need 2y all metrics (ni=${ni.length} fcf=${fcf.length} oi=${oi.length})`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  let profitable = 0;
  for (let i = 0; i < 2; i++) {
    const niV = ni[i]?.value, fcfV = fcf[i]?.value, oiV = oi[i]?.value;
    if (niV != null && fcfV != null && oiV != null && niV > 0 && fcfV > 0 && oiV > 0) profitable++;
  }
  return H.buildResult({
    value: profitable,
    pass: profitable >= THRESHOLD,
    computable: true,
    components: { profitable, total: 2 },
    reason: `${profitable} / 2 letzte Jahre profitable`,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'NI+FCF+OpInc alle > 0 in beiden letzten Jahren (für früh-stage Compounder)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'composite',
  evaluate
};
