'use strict';
const H = require('./_helpers.js');

const ID = 'roic';
const LABEL = 'ROIC';
const THRESHOLD = 0.15;
const THRESHOLD_OP = 'gte';

function evaluate(stock) {
  const netIncome = H.latestAnnual(stock, 'annualNetIncome');
  const totalAssets = H.latestBalance(stock, 'totalAssets');
  const totalCash = H.latestBalance(stock, 'totalCash');
  // Tag-38: sektor-relative Schwelle für BANK/REIT/etc.
  const eff = H.effectiveThreshold(stock, ID, THRESHOLD);
  if (netIncome == null || totalAssets == null) {
    return H.buildResult({
      computable: false,
      reason: `missing inputs: netIncome=${netIncome}, totalAssets=${totalAssets}`,
      threshold: eff.threshold, thresholdOp: THRESHOLD_OP
    });
  }
  // audit F-A-2026-06-22: prevents NaN/Infinity balance fields (corrupt/schema-drifted
  // snapshot) producing a phantom computable FAIL instead of computable:false.
  // latestBalance() only null-checks (no Number.isFinite), so a non-finite totalAssets
  // slips past the null guard above; NaN<=0 / Infinity arithmetic then yields value=NaN,
  // which buildResult nulls while still returning computable:true, pass:false.
  if (!Number.isFinite(totalAssets) || !Number.isFinite(netIncome)) {
    return H.buildResult({
      computable: false,
      reason: `non-finite inputs: netIncome=${netIncome}, totalAssets=${totalAssets}`,
      threshold: eff.threshold, thresholdOp: THRESHOLD_OP
    });
  }
  // audit F-A-2026-06-22: a non-finite (but non-null) totalCash would corrupt
  // investedCapital (Infinity||0 stays Infinity); null/absent still falls back to 0.
  if (totalCash != null && !Number.isFinite(totalCash)) {
    return H.buildResult({
      computable: false,
      reason: `non-finite totalCash=${totalCash}`,
      threshold: eff.threshold, thresholdOp: THRESHOLD_OP
    });
  }
  const investedCapital = totalAssets - (totalCash || 0);
  if (investedCapital <= 0) {
    return H.buildResult({
      computable: false,
      reason: `invested capital <= 0 (assets=${totalAssets}, cash=${totalCash})`,
      threshold: eff.threshold, thresholdOp: THRESHOLD_OP
    });
  }
  const value = netIncome / investedCapital;
  return H.buildResult({
    value,
    pass: value >= eff.threshold,
    computable: true,
    components: { netIncome, investedCapital, totalAssets, totalCash: totalCash || 0, thresholdSource: eff.source },
    reason: `${(netIncome/1e9).toFixed(1)}B / ${(investedCapital/1e9).toFixed(1)}B = ${(value*100).toFixed(1)}% (vs ${(eff.threshold*100).toFixed(0)}%, ${eff.source})`,
    threshold: eff.threshold, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL, description: 'Return on Invested Capital ≥ 15% (NetIncome / (TotalAssets - Cash))',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
