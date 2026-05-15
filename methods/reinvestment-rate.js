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
function _rawVals(stock, path) {
  var arr = H.val(stock, path);
  if (!Array.isArray(arr)) return [];
  return arr.map(function(v){ return v == null ? null : (typeof v === 'number' ? v : v.value); });
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
  // Use raw (positionally aligned) arrays for parallel indexing
  var rawCapexRaw = _rawVals(stock, 'annual.annualCapex');
  var rawCapex = rawCapexRaw.map(function(v){ return v == null ? null : Math.abs(v); });
  var rawOcfDirect = _rawVals(stock, 'annual.annualOCF');
  var rawFcf = _rawVals(stock, 'annual.annualFCF');
  var rawRnd = _rawVals(stock, 'annual.annualRnD');
  var rawRev = _rawVals(stock, 'annual.annualRev');
  // Filtered arrays for length checks
  var capex = rawCapex.filter(function(v){ return Number.isFinite(v); });
  var ocfDirect = rawOcfDirect.filter(function(v){ return Number.isFinite(v); });
  var fcf = rawFcf.filter(function(v){ return Number.isFinite(v); });
  var rnd = rawRnd.filter(function(v){ return Number.isFinite(v); });

  var ocfSource;
  var ocf, rawOcf;
  if (ocfDirect.length >= 3) {
    ocf = ocfDirect; rawOcf = rawOcfDirect; ocfSource = 'direct';
  } else if (fcf.length >= 3 && capex.length >= 3) {
    // Build positionally-aligned OCF from raw arrays
    var yrs = Math.min(rawFcf.length, rawCapex.length);
    rawOcf = [];
    for (var i = 0; i < yrs; i++) {
      var fv = rawFcf[i], cv = rawCapex[i];
      rawOcf.push((Number.isFinite(fv) && Number.isFinite(cv)) ? fv + cv : null);
    }
    ocf = rawOcf.filter(function(v){ return Number.isFinite(v); });
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
  var yearsAvail = Math.min(5, rawCapex.length, rawOcf.length);
  for (var j = 0; j < yearsAvail; j++) {
    // Bug #30 fix: skip years where capex data is missing instead of substituting 0.
    // Using 0 pulls the median reinvestment-rate down for R&D/capex-heavy companies.
    var c = rawCapex[j];
    if (!Number.isFinite(c)) continue;  // skip years with no capex data
    var r = (j < rawRnd.length && Number.isFinite(rawRnd[j])) ? rawRnd[j] : 0;
    var o = rawOcf[j];
    if (!Number.isFinite(o) || o <= 0) continue;
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

  // Asset-light fallback: when annualRnD is entirely missing from cache AND median
  // capex/revenue < 2% (asset-light IP-heavy model — e.g. NVDA, MSFT, ASML software side),
  // the Capex+RnD ratio dramatically understates true reinvestment (R&D booked as opex,
  // not capitalized). For these companies we relax the threshold to 10%. Without this
  // path, virtually every R&D-driven Quality-Compounder fails reinvestment-rate when
  // upstream cache misses ftsAnnualRnD.
  var capexRevMed = null;
  if (rawRev.length >= 3 && rawCapex.length >= 3) {
    var capexRevRatios = [];
    var nrs = Math.min(rawRev.length, rawCapex.length);
    for (var k = 0; k < nrs; k++) {
      if (Number.isFinite(rawRev[k]) && rawRev[k] > 0 && Number.isFinite(rawCapex[k])) {
        capexRevRatios.push(rawCapex[k] / rawRev[k]);
      }
    }
    if (capexRevRatios.length) capexRevMed = _median(capexRevRatios);
  }
  var assetLight = !usedRnD && capexRevMed != null && capexRevMed < 0.02;
  var effectiveThreshold = assetLight ? 0.10 : THRESHOLD;
  var pass = med >= effectiveThreshold;

  return H.buildResult({
    computable: true,
    pass: pass,
    value: med,
    components: {
      median: med, ratios: ratios,
      yearsConsidered: ratios.length,
      capexUsed: true, rndUsed: usedRnD, ocfSource: ocfSource,
      assetLight: assetLight, capexRevMedian: capexRevMed,
      effectiveThreshold: effectiveThreshold
    },
    reason: '5Y-Median (Capex' + (usedRnD ? '+R&D' : '') + ')/OCF[' + ocfSource + '] = ' + (med*100).toFixed(1) + '% (vs ' + (effectiveThreshold*100).toFixed(0) + '%' + (assetLight ? ' asset-light' : '') + ', ' + ratios.length + 'y)',
    threshold: effectiveThreshold, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Direct Reinvestment Rate: 5Y Median (Capex+R&D)/OCF >= 20% (OCF=FCF+Capex Fallback)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate: evaluate
};
