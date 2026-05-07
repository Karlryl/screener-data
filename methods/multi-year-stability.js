'use strict';
const H = require('./_helpers.js');

const ID = 'multi-year-stability';
const LABEL = 'Multi-Year Profitable';
const THRESHOLD = 4;  // alle 4 Jahre profitable
const THRESHOLD_OP = 'gte';

// Profitable in jedem Jahr: NetIncome > 0 AND FCF > 0 AND OpInc > 0
function evaluate(stock) {
  const ni = (stock.annual && stock.annual.annualNetIncome) || [];
  const fcf = (stock.annual && stock.annual.annualFCF) || [];
  const oi = (stock.annual && stock.annual.annualOpInc) || [];
  if (ni.length < 4 || fcf.length < 4 || oi.length < 4) {
    return H.buildResult({
      computable: false,
      reason: `need 4y all metrics (ni=${ni.length} fcf=${fcf.length} oi=${oi.length})`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  let profitableYears = 0;
  for (let i = 0; i < 4; i++) {
    const niV = ni[i] && ni[i].value;
    const fcfV = fcf[i] && fcf[i].value;
    const oiV = oi[i] && oi[i].value;
    if (niV != null && fcfV != null && oiV != null && niV > 0 && fcfV > 0 && oiV > 0) {
      profitableYears++;
    }
  }
  return H.buildResult({
    value: profitableYears,
    pass: profitableYears >= THRESHOLD,
    computable: true,
    components: { profitableYears, totalYears: 4 },
    reason: `${profitableYears} / 4 Jahre profitable (NI+FCF+OpInc alle > 0)`,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'NetIncome + FCF + OpInc alle > 0 in jedem der letzten 4 Jahre',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'composite',
  evaluate
};
