'use strict';
const H = require('./_helpers.js');

const ID = 'roce';
const LABEL = 'ROCE';
const THRESHOLD = 0.15;
const THRESHOLD_OP = 'gte';

// ROCE = OpInc / (TotalAssets - Cash). Alternative zu ROIC mit OpInc statt NetIncome.
// EU-Standard Quality-Indicator. Weniger manipulierbar als ROIC weil OpInc.
function evaluate(stock) {
  const opInc = H.latestAnnual(stock, 'annualOpInc');
  const totalAssets = H.latestBalance(stock, 'totalAssets');
  const totalCash = H.latestBalance(stock, 'totalCash');
  const eff = H.effectiveThreshold(stock, ID, THRESHOLD);
  if (opInc == null || totalAssets == null) {
    return H.buildResult({
      computable: false,
      reason: `missing inputs: opInc=${opInc}, totalAssets=${totalAssets}`,
      threshold: eff.threshold, thresholdOp: THRESHOLD_OP
    });
  }
  const capitalEmployed = totalAssets - (totalCash || 0);
  if (capitalEmployed <= 0) {
    return H.buildResult({
      computable: false,
      reason: `capital employed <= 0`,
      threshold: eff.threshold, thresholdOp: THRESHOLD_OP
    });
  }
  const value = opInc / capitalEmployed;
  return H.buildResult({
    value,
    pass: value >= eff.threshold,
    computable: true,
    components: { opInc, capitalEmployed, totalAssets, totalCash: totalCash || 0, thresholdSource: eff.source },
    reason: `${(opInc/1e9).toFixed(1)}B / ${(capitalEmployed/1e9).toFixed(1)}B = ${(value*100).toFixed(1)}% (vs ${(eff.threshold*100).toFixed(0)}%, ${eff.source})`,
    threshold: eff.threshold, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'ROCE = OpInc / Capital Employed ≥ 15% (EU-Standard, weniger manipulierbar als ROIC)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
