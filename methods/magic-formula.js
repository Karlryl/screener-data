'use strict';
const H = require('./_helpers.js');

const ID = 'magic-formula';
const LABEL = 'Magic Formula (Greenblatt)';
const THRESHOLD = 0.06;  // EarningsYield ≥ 6% (mit ROIC-Pass-Voraussetzung)
const THRESHOLD_OP = 'gte';

// Greenblatt Magic Formula = ROIC × Earnings-Yield. Karl-Variante:
// ROIC ≥ 15% AND Earnings-Yield ≥ 6% = pass.
// Earnings-Yield = NetIncome / Market Cap (inverse PE)
function evaluate(stock) {
  const netIncome = H.latestAnnual(stock, 'annualNetIncome');
  const totalAssets = H.latestBalance(stock, 'totalAssets');
  const totalCash = H.latestBalance(stock, 'totalCash');
  const mcap = stock && stock.marketCap && (typeof stock.marketCap === 'number' ? stock.marketCap : stock.marketCap.value);
  if (netIncome == null || totalAssets == null || mcap == null || mcap <= 0) {
    return H.buildResult({
      computable: false,
      reason: `missing inputs: ni=${netIncome}, assets=${totalAssets}, mcap=${mcap}`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const investedCapital = totalAssets - (totalCash || 0);
  if (investedCapital <= 0) {
    return H.buildResult({
      computable: false, reason: 'invested capital <= 0', threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const roic = netIncome / investedCapital;
  const earningsYield = netIncome / mcap;
  // Karl-Variant: BEIDE müssen pass'n
  const roicPass = roic >= 0.15;
  const eyPass = earningsYield >= THRESHOLD;
  const value = earningsYield;  // primary value
  return H.buildResult({
    value,
    pass: roicPass && eyPass,
    computable: true,
    components: { roic, earningsYield, netIncome, investedCapital, mcap, roicPass, eyPass },
    reason: `EY=${(earningsYield*100).toFixed(1)}% ROIC=${(roic*100).toFixed(1)}% — both must pass`,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Greenblatt: ROIC ≥ 15% AND Earnings-Yield ≥ 6%',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
