'use strict';
/**
 * Tag 117: Reinvestment-Rate (Quality-Compounder MUST 4)
 * Konsens nach 5-Runden-Battle: Direct = 5Y Median (Capex + R&D) / OCF
 *   - Standard Quality-Compounder: >= 20%
 *   - Premium-Compounder: >= 30%
 * OCF nicht direkt im Snapshot - Fallback: OCF approximiert via FCF + Capex.
 */
var H = require('./_helpers.js');

var ID = 'reinvestment-rate';
var LABEL = 'Reinvestment-Rate';
var THRESHOLD = 0.20;
var THRESHOLD_OP = 'gte';

function _arrVals(stock, path) {
  var arr = H.val(stock, path);
  if (!Array.isArray(arr)) return [];
  return arr.map(function(v){ return v == null ? null : (typeof v === 'number' ? v : v.value); }).filter(function(v){ return Number.isFinite(v); });
}

function _median(arr) {
  if (!arr.length) return null;
  var s = arr.slice().sort(function(a, b){ return a - b; });
  var mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function evaluate(stock) {
  if (!stock) {
    return H.buildResult({ computable: false, pass: false, reason: 'no stock data' });
  }
  var capexRaw = _arrVals(stock, 'annual.annualCapex');
  var capex = capexRaw.map(function(v){ return Math.abs(v); });
  var ocfDirect = _arrVals(stock, 'annual.annualOCF');
  var fcf = _arrVals(stock, 'annual.annualFCF');
  var rnd = _arrVals(stock, 'annual.annualRnD');

  var ocfSource;
  var ocf;
  if (ocfDirect.length >= 3) {
    ocf = ocfDirect; ocfSource = 'direct';
  } else if (fcf.length >= 3 && capex.length >= 3) {
    var yrs = Math.min(fcf.length, capex.length);
    ocf = [];
    for (var i = 0; i < yrs; i++) ocf.push(fcf[i] + capex[i]);
    ocfSource = 'fcf+capex';
  } else {
    return H.buildResult({
      computable: false,
      reason: 'OCF not derivable: ocfDirect=' + ocfDirect.length + ', fcf=' + fcf.length + ', capex=' + capex.length,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  if (capex.length < 3 || ocf.length < 3) {
    return H.buildResult({
      computable: false,
      reason: 'need >=3 annual capex+ocf, got capex=' + capex.length + ' ocf=' + ocf.length,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  var ratios = [];
  var yearsAvail = Math.min(5, capex.length, ocf.length);
  for (var j = 0; j < yearsAvail; j++) {
    var c = capex[j] || 0;
    var r = (rnd[j] != null && Number.isFinite(rnd[j])) ? rnd[j] : 0;
    var o = ocf[j];
    if (o == null || o <= 0) continue;
    ratios.push((c + r) / o);
  }

  if (ratios.length < 3) {
    return H.buildResult({
      computable: false,
      reason: 'usable ratios < 3 (got ' + ratios.length + '); OCF positive needed',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  var med = _median(ratios);
  var usedRnD = rnd.length > 0;

  return H.buildResult({
    computable: true,
    pass: med >= THRESHOLD,
    value: med,
    components: {
      median: med, ratios: ratios,
      yearsConsidered: ratios.length,
      capexUsed: true, rndUsed: usedRnD, ocfSource: ocfSource
    },
    reason: '5Y-Median (Capex' + (usedRnD ? '+R&D' : '') + ')/OCF[' + ocfSource + '] = ' + (med*100).toFixed(1) + '% (vs ' + (THRESHOLD*100).toFixed(0) + '%, ' + ratios.length + 'y)',
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Direct Reinvestment Rate: 5Y Median (Capex+R&D)/OCF >= 20% (OCF=FCF+Capex Fallback)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate: evaluate
};
