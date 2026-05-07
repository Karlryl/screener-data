'use strict';
const H = require('./_helpers.js');

const ID = 'sloan-ratio';
const LABEL = 'Sloan-Ratio';
const THRESHOLD = 0.10;  // |Sloan| <= 0.10 = pass (low accruals)
const THRESHOLD_OP = 'lte_abs';  // absolute value comparison

function evaluate(stock) {
  // Sloan (1996): (NetIncome - CashFlowFromOps) / TotalAssets
  // Approximation: use FCF instead of CFO (FCF = CFO - Capex; the diff is Capex which we don't strip).
  // Real Sloan needs CFO, we have FCF. But for screen-purpose, FCF-based Sloan is acceptable proxy.
  const netIncome = H.latestAnnual(stock, 'annualNetIncome');
  const fcf = H.latestAnnual(stock, 'annualFCF');
  const totalAssets = H.latestBalance(stock, 'totalAssets');
  if (netIncome == null || fcf == null || totalAssets == null) {
    return H.buildResult({
      computable: false,
      reason: `missing inputs: netIncome=${netIncome}, fcf=${fcf}, totalAssets=${totalAssets}`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  if (totalAssets <= 0) {
    return H.buildResult({
      computable: false,
      reason: `totalAssets <= 0`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const accruals = netIncome - fcf;
  const value = accruals / totalAssets;
  return H.buildResult({
    value,
    pass: Math.abs(value) <= THRESHOLD,
    computable: true,
    components: { netIncome, fcf, accruals, totalAssets },
    reason: `(${(netIncome/1e9).toFixed(1)}B - ${(fcf/1e9).toFixed(1)}B) / ${(totalAssets/1e9).toFixed(1)}B = ${(value*100).toFixed(2)}%`,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Sloan Accruals (|NI-FCF|/TotalAssets) ≤ 10% (Earnings-Manipulation-Detector)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
