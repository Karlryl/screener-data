'use strict';
/**
 * FCF-Yield (Tag 118: SBC-Adjusted nach Battle-Konsens)
 * =======================================================
 * Battle-Befund Gemini: Hypergrowth-SaaS taeuscht FCF-Profitabilitaet vor,
 * weil SBC (Stock-Based-Comp) im Cashflow nicht ausreichend abgezogen wird.
 *
 * Formel: FCF_Adj = annualFCF - annualSBC (wenn SBC vorhanden)
 * Yield = FCF_Adj / MarketCap
 *
 * Wenn annualSBC nicht vorhanden: Fallback auf reines annualFCF (alte Logik).
 */
var H = require('./_helpers.js');

var ID = 'fcf-yield';
var LABEL = 'FCF-Yield (SBC-adj)';
var THRESHOLD = 0.05;
var THRESHOLD_OP = 'gte';

function evaluate(stock) {
  var fcf = H.latestAnnual(stock, 'annualFCF');
  var sbc = H.latestAnnual(stock, 'annualSBC');
  var mcap = stock && stock.marketCap && (typeof stock.marketCap === 'number' ? stock.marketCap : stock.marketCap.value);
  var eff = H.effectiveThreshold(stock, ID, THRESHOLD);

  if (fcf == null || mcap == null) {
    return H.buildResult({
      computable: false,
      reason: 'missing inputs: fcf=' + fcf + ', marketCap=' + mcap,
      threshold: eff.threshold, thresholdOp: THRESHOLD_OP
    });
  }
  if (mcap <= 0) {
    return H.buildResult({
      computable: false,
      reason: 'marketCap <= 0',
      threshold: eff.threshold, thresholdOp: THRESHOLD_OP
    });
  }

  // SBC-Adjustment (Tag 118): wenn SBC vorhanden, abziehen
  var sbcUsed = false;
  var fcfAdj = fcf;
  // Bug #16: sbc > 0 guard silently skips SBC when stored as negative (e.g. -500M).
  // Math.abs() handles sign — just check non-zero.
  if (sbc != null && Number.isFinite(sbc) && sbc !== 0) {
    fcfAdj = fcf - Math.abs(sbc);
    sbcUsed = true;
  }

  var value = fcfAdj / mcap;
  return H.buildResult({
    value: value,
    pass: value >= eff.threshold,
    computable: true,
    components: { fcf: fcf, sbc: sbc, fcfAdj: fcfAdj, marketCap: mcap, sbcUsed: sbcUsed, thresholdSource: eff.source },
    reason: (sbcUsed ? '(' + (fcf/1e9).toFixed(2) + 'B - SBC ' + (Math.abs(sbc)/1e9).toFixed(2) + 'B) ' : '') + (fcfAdj/1e9).toFixed(2) + 'B / ' + (mcap/1e9).toFixed(1) + 'B = ' + (value*100).toFixed(2) + '%' + (sbcUsed ? ' [SBC-adj]' : ''),
    threshold: eff.threshold, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'FCF-adj / Market Cap >= 5% (SBC-adjusted bei Yahoo-annualSBC vorhanden)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate: evaluate
};
