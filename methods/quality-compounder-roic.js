'use strict';
/**
 * Tag 117: Quality-Compounder ROIC (MUST 2)
 * ===========================================
 * Konsens: PreTax-ROIC = OperatingIncome / InvestedCapital
 *   - Standard-Pass: PreTax-ROIC >= 20%
 *   - High-Turnover-Override: PreTax-ROIC >= 17% UND AssetTurnover >= 2.0
 *   - Sektor-blind (Quality-Compounder = absolute Premium-Quality)
 *
 * InvestedCapital = TotalAssets - TotalCash (pragmatic Yahoo-Approximation)
 * AssetTurnover = Revenue / TotalAssets
 *
 * Yahoo-Felder: annual.annualOpInc, annual.annualBalance[0].{totalAssets,totalCash}, annual.annualRev
 */
const H = require('./_helpers.js');

const ID = 'quality-compounder-roic';
const LABEL = 'QC-ROIC (PreTax + AT-Override)';
const THRESHOLD_STD = 0.20;
const THRESHOLD_OVERRIDE = 0.17;
const AT_OVERRIDE = 2.0;
const THRESHOLD_OP = 'gte';

function evaluate(stock) {
  if (!stock) {
    return H.buildResult({ computable: false, pass: false, reason: 'no stock data' });
  }
  const opInc = H.latestAnnual(stock, 'annualOpInc');
  const totalAssets = H.latestBalance(stock, 'totalAssets');
  const totalCash = H.latestBalance(stock, 'totalCash');
  const rev = H.latestAnnual(stock, 'annualRev');

  if (opInc == null || totalAssets == null) {
    return H.buildResult({
      computable: false,
      reason: `missing inputs: opInc=${opInc}, totalAssets=${totalAssets}`,
      threshold: THRESHOLD_STD, thresholdOp: THRESHOLD_OP
    });
  }

  const investedCapital = totalAssets - (totalCash || 0);
  if (investedCapital <= 0) {
    return H.buildResult({
      computable: false,
      reason: `invested capital <= 0`,
      threshold: THRESHOLD_STD, thresholdOp: THRESHOLD_OP
    });
  }

  const preTaxROIC = opInc / investedCapital;
  const at = (rev != null && totalAssets > 0) ? rev / totalAssets : null;

  // Standard pass
  let pass = preTaxROIC >= THRESHOLD_STD;
  let pathUsed = 'standard';
  // High-Turnover Override
  if (!pass && at != null && at >= AT_OVERRIDE && preTaxROIC >= THRESHOLD_OVERRIDE) {
    pass = true;
    pathUsed = 'high-turnover-override';
  }

  return H.buildResult({
    computable: true,
    pass,
    value: preTaxROIC,
    components: {
      preTaxROIC,
      assetTurnover: at,
      pathUsed,
      opInc,
      investedCapital,
      totalAssets,
      totalCash: totalCash || 0,
      revenue: rev
    },
    reason: `PreTax-ROIC = ${(opInc/1e9).toFixed(1)}B / ${(investedCapital/1e9).toFixed(1)}B = ${(preTaxROIC*100).toFixed(1)}% (AT=${at != null ? at.toFixed(2) : 'n/a'}, ${pathUsed})`,
    threshold: THRESHOLD_STD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'PreTax-ROIC >= 20% ODER >= 17% mit AssetTurnover >= 2.0',
  threshold: THRESHOLD_STD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
