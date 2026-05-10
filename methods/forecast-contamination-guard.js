'use strict';
/**
 * Tag 118: Forecast-Contamination-Guard
 * =======================================
 * Live-Befund 3SBio (1530.HK): Yahoo's annualRev[0] enthÃ¤lt manchmal
 * FORECAST-Werte (Prognose) statt actuals. Beispiel:
 *   - Yahoo annualRev[0] = 17.7B HKD
 *   - Sum letzte 4 Quartals-Revs = ~720M HKD
 *   - Faktor 24x! Look-Ahead-Bias.
 *
 * Filter berechnete YoY 182%, Rule-of-40 Score 223 -> Hypergrowth-perfekt.
 * In Wirklichkeit: flacher Mid-Cap-Biotech mit 7B Mcap.
 *
 * Cross-Validation: annualRev[0] vs sum(letzte 4 Quartals-Revs).
 * Wenn Divergenz > 1.5x: FORECAST_CONTAMINATION = FAIL.
 *
 * Dieser Guard schuetzt ALLE Modi (Hypergrowth + Quality-Compounder).
 */
var H = require('./_helpers.js');

var ID = 'forecast-contamination-guard';
var LABEL = 'Forecast-Contamination';
var DIVERGENCE_THRESHOLD = 1.5; // annualRev[0] / sum(Q-letzte-4) > 1.5 = Forecast-Inflation

function _arrVals(stock, path) {
  var arr = H.val(stock, path);
  if (!Array.isArray(arr)) return [];
  return arr.map(function(v){ return v == null ? null : (typeof v === 'number' ? v : v.value); }).filter(function(v){ return Number.isFinite(v); });
}

function evaluate(stock) {
  if (!stock) {
    return H.buildResult({ computable: false, pass: false, reason: 'no stock data' });
  }
  var annualRev = _arrVals(stock, 'annual.annualRev');
  var qRev = _arrVals(stock, 'timeseries.revenueQ');

  if (annualRev.length < 1 || qRev.length < 4) {
    return H.buildResult({
      computable: false,
      reason: 'need annualRev[0] + >=4 quarters: annualRev=' + annualRev.length + ' qRev=' + qRev.length
    });
  }

  var annualLatest = annualRev[0];
  var q4Sum = qRev[0] + qRev[1] + qRev[2] + qRev[3];

  if (annualLatest == null || q4Sum == null || q4Sum <= 0) {
    return H.buildResult({
      computable: false,
      reason: 'invalid: annualLatest=' + annualLatest + ' q4Sum=' + q4Sum
    });
  }

  var ratio = annualLatest / q4Sum;
  var pass = ratio <= DIVERGENCE_THRESHOLD;

  // Auch sehr niedrige Ratio (< 0.5) ist verdaechtig (Annual deutlich kleiner als Q-Sum)
  // aber das ist seltener und nicht Look-Ahead-typisch â daher nur upper-bound check.

  return H.buildResult({
    computable: true,
    pass: pass,
    value: ratio,
    components: {
      annualLatest: annualLatest,
      q4Sum: q4Sum,
      ratio: ratio,
      threshold: DIVERGENCE_THRESHOLD
    },
    reason: 'Annual=' + (annualLatest/1e9).toFixed(2) + 'B vs Q-Sum=' + (q4Sum/1e9).toFixed(2) + 'B = ' + ratio.toFixed(2) + 'x' + (pass ? ' OK' : ' FORECAST_CONTAMINATION'),
    threshold: DIVERGENCE_THRESHOLD, thresholdOp: 'lte'
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Forecast-Contamination-Guard: annualRev[0]/sum(Q-letzte-4) <= 1.5 (Yahoo-Forecast-Inflation)',
  threshold: DIVERGENCE_THRESHOLD, thresholdOp: 'lte', unit: 'ratio',
  evaluate: evaluate
};
