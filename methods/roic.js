'use strict';
const H = require('./_helpers.js');

const ID = 'roic';
const LABEL = 'ROIC';
const THRESHOLD = 0.15;
const THRESHOLD_OP = 'gte';

function evaluate(stock) {
  // ROIC = NetIncome (TTM) / InvestedCapital
  // InvestedCapital = TotalDebt + Equity (approximation: TotalAssets - TotalDebt - Cash, OR TotalAssets - Cash)
  // Yahoo FTS gives totalDebt, totalAssets, cash. Equity = TotalAssets - TotalDebt - other liabs (not direct).
  // Pragmatic Approximation: InvestedCapital = TotalAssets - TotalCash (Operating Assets minus Cash).
  const netIncome = H.latestAnnual(stock, 'annualNetIncome');
  const totalAssets = H.latestBalance(stock, 'totalAssets');
  const totalCash = H.latestBalance(stock, 'totalCash');
  if (netIncome == null || totalAssets == null) {
    return H.buildResult({
      computable: false,
      reason: `missing inputs: netIncome=${netIncome}, totalAssets=${totalAssets}`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const investedCapital = totalAssets - (totalCash || 0);
  if (investedCapital <= 0) {
    return H.buildResult({
      computable: false,
      reason: `invested capital <= 0 (assets=${totalAssets}, cash=${totalCash})`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const value = netIncome / investedCapital;
  return H.buildResult({
    value,
    pass: value >= THRESHOLD,
    computable: true,
    components: { netIncome, investedCapital, totalAssets, totalCash: totalCash || 0 },
    reason: `${(netIncome/1e9).toFixed(1)}B / ${(investedCapital/1e9).toFixed(1)}B = ${(value*100).toFixed(1)}%`,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL, description: 'Return on Invested Capital ≥ 15% (NetIncome / (TotalAssets - Cash))',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
