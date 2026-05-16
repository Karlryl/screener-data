'use strict';
/**
 * Tag 117: Quality-Compounder ROIC (MUST 2)
 * ===========================================
 * Konsens: PreTax-ROIC = OperatingIncome / InvestedCapital
 *   - Standard-Pass: PreTax-ROIC >= 20%
 *   - High-Turnover-Override: PreTax-ROIC >= 17% UND AssetTurnover >= 2.0
 *   - Sektor-blind (Quality-Compounder = absolute Premium-Quality)
 *
 * Tag 202: High-Turnover-Retail-Tier (pattern-based, NOT sector/ticker)
 * --------------------------------------------------------------------
 *   - AT >= 3.0 UND OpMargin-Median >= 3.5% lockert ROIC-Floor auf 15%.
 *   - Begruendung: Retail-Compounder (COST-Muster) sind strukturell
 *     anders als Software: niedrige GM (~13%) wird durch sehr hohen
 *     Asset-Turnover (~3.5x) kompensiert — der eigentliche Cash-Compounder
 *     ist die Velocity, nicht die Marge. Software laeuft umgekehrt:
 *     hohe GM (~70%) bei AT < 1.
 *   - Gate ist eng (AT>=3 + OpM>=3.5%) — Software-Anchor (MSFT/ASML/NVDA)
 *     haben AT<1 und triggert nicht. Fixture-Stock hat AT=0.33 — auch nicht.
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
// Tag 202: High-Turnover-Retail-Tier
const AT_RETAIL_TIER = 3.0;
const THRESHOLD_RETAIL_TIER = 0.15;
const OPMARGIN_RETAIL_GATE = 0.035;
const THRESHOLD_OP = 'gte';

function _rawVals(stock, path) {
  const arr = H.val(stock, path);
  if (!Array.isArray(arr)) return [];
  return arr.map(v => v == null ? null : (typeof v === 'number' ? v : v.value));
}
function _median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

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

  // Tag 202: compute OpMargin-Median (up to 5y) for the retail-tier gate.
  // We need it ONLY when at >= AT_RETAIL_TIER — but compute unconditionally
  // for transparency in components. Fail-soft: null if data insufficient.
  const rawRevs = _rawVals(stock, 'annual.annualRev');
  const rawOpIncs = _rawVals(stock, 'annual.annualOpInc');
  const opMs = [];
  const ylen = Math.min(5, rawRevs.length, rawOpIncs.length);
  for (let i = 0; i < ylen; i++) {
    if (Number.isFinite(rawRevs[i]) && rawRevs[i] > 0 && Number.isFinite(rawOpIncs[i])) {
      opMs.push(rawOpIncs[i] / rawRevs[i]);
    }
  }
  const opMarginMedian = opMs.length >= 3 ? _median(opMs) : null;

  // Standard pass
  let pass = preTaxROIC >= THRESHOLD_STD;
  let pathUsed = 'standard';
  // High-Turnover Override (AT >= 2.0, ROIC >= 17%)
  if (!pass && at != null && at >= AT_OVERRIDE && preTaxROIC >= THRESHOLD_OVERRIDE) {
    pass = true;
    pathUsed = 'high-turnover-override';
  }
  // Tag 202: High-Turnover-Retail-Tier (AT >= 3.0 + OpM-Median >= 3.5% → ROIC floor 15%)
  // Gated by BOTH conditions so software/megacaps (AT<1) cannot accidentally use this path.
  if (!pass && at != null && at >= AT_RETAIL_TIER
      && opMarginMedian != null && opMarginMedian >= OPMARGIN_RETAIL_GATE
      && preTaxROIC >= THRESHOLD_RETAIL_TIER) {
    pass = true;
    pathUsed = 'high-turnover-retail-tier';
  }

  return H.buildResult({
    computable: true,
    pass,
    value: preTaxROIC,
    components: {
      preTaxROIC,
      assetTurnover: at,
      opMarginMedian,
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
  description: 'PreTax-ROIC >= 20% ODER >= 17% mit AT>=2.0 ODER >= 15% mit AT>=3.0 + OpM-Median>=3.5% (Retail-Tier)',
  threshold: THRESHOLD_STD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
