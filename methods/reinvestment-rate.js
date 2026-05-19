'use strict';
/**
 * Tag 117: Reinvestment-Rate (Quality-Compounder MUST 4)
 * Konsens nach 5-Runden-Battle: Direct = 5Y Median (Capex + R&D) / OCF
 *   - Standard Quality-Compounder: >= 20%
 *   - Premium-Compounder: >= 30%
 * OCF preferentially from annualOCF (Tag 211l direct extract); falls back to
 * FCF+|Capex| for snapshots predating the field.
 * Tag 232d-3: OCF.annualOCF available since Tag 211l — using FCF+Capex synthesis
 * introduced rounding error when Yahoo's reported FCF/Capex disagreed with reported
 * OCF by 1-5%.
 */
var H = require('./_helpers.js');

var ID = 'reinvestment-rate';
var LABEL = 'Reinvestment-Rate';
var THRESHOLD = 0.20;
var THRESHOLD_OP = 'gte';

// Tag 225e-1: Sector-aware threshold map. The 20% baseline was calibrated
// for industrials/software where Capex+R&D dominates reinvestment. For
// balance-sheet-light financial-services models (V, MA, MCO, asset managers,
// REITs, insurers) reinvestment naturally runs 5-10% of OCF because growth
// is funded via opex (marketing, distribution, partnerships), not capex.
// Damodaran's reinvestment-rate page documents this sector dispersion:
// financials run materially lower without being lower-quality compounders.
// Without this calibration V failed the QC MUST gate at 5.7% (mis-applied
// industrial threshold) despite being a textbook quality compounder.
//
// Match keys are case-insensitive regex tested against meta.sector (Yahoo
// sectorKey/sector). Industry is checked as a secondary fallback for
// finer-grained excludes (e.g. "Credit Services" inside Financial Services).
var SECTOR_THRESHOLD_OVERRIDES = [
  // Asset-light financials: payment networks (V, MA), exchanges (ICE, CME),
  // asset managers (BLK, MCO), credit-rating agencies, insurance brokers (MMC).
  // Damodaran's US-sector reinvestment table puts these in the 3-7% band.
  { match: /financial services|financials/i, threshold: 0.05 },
  // REITs: capital recycling shows up as acquisitions/dispositions, not capex.
  { match: /real estate|reit/i,                threshold: 0.08 },
  // Insurance: reinvestment is float-funded; capex is immaterial.
  { match: /insurance/i,                       threshold: 0.05 }
];

function _sectorThresholdFor(stock) {
  var sector = stock && stock.meta && stock.meta.sector;
  var industry = stock && stock.meta && stock.meta.industry;
  if (!sector && !industry) return null;
  for (var i = 0; i < SECTOR_THRESHOLD_OVERRIDES.length; i++) {
    var rule = SECTOR_THRESHOLD_OVERRIDES[i];
    if ((sector && rule.match.test(sector)) || (industry && rule.match.test(industry))) {
      return rule.threshold;
    }
  }
  return null;
}

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

  // Tag 232d-3: build per-year OCF array preferring annualOCF[i] (reported) over
  // FCF+|Capex| synthesis. This is more accurate than the all-or-nothing array
  // selection because some snapshots have partial annualOCF coverage.
  var ocfReportedCount = 0;
  var ocfSynthesizedCount = 0;
  var maxYrs = Math.max(rawOcfDirect.length, Math.min(rawFcf.length, rawCapex.length));
  var rawOcf = [];
  for (var i = 0; i < maxYrs; i++) {
    var directVal = (i < rawOcfDirect.length) ? rawOcfDirect[i] : null;
    if (Number.isFinite(directVal)) {
      rawOcf.push(directVal);
      ocfReportedCount++;
    } else {
      var fv = (i < rawFcf.length) ? rawFcf[i] : null;
      var cv = (i < rawCapex.length) ? rawCapex[i] : null;
      if (Number.isFinite(fv) && Number.isFinite(cv)) {
        rawOcf.push(fv + cv);
        ocfSynthesizedCount++;
      } else {
        rawOcf.push(null);
      }
    }
  }
  var ocf = rawOcf.filter(function(v){ return Number.isFinite(v); });
  var ocfSource = ocfReportedCount > 0
    ? (ocfSynthesizedCount > 0 ? 'mixed' : 'direct')
    : 'fcf+capex';

  if (ocf.length < 3) {
    return H.buildResult({
      computable: false,
      reason: 'OCF not derivable: ocfDirect=' + ocfDirect.length + ', fcf=' + fcf.length + ', capex=' + capex.length,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  if (capex.length < 3) {
    return H.buildResult({
      computable: false,
      reason: 'need >=3 annual capex data, got capex=' + capex.length,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  var ratios = [];
  var rndSkippedYears = 0;
  var yearsAvail = Math.min(5, rawCapex.length, rawOcf.length);
  for (var j = 0; j < yearsAvail; j++) {
    // Bug #30 fix: skip years where capex data is missing instead of substituting 0.
    // Using 0 pulls the median reinvestment-rate down for R&D/capex-heavy companies.
    var c = rawCapex[j];
    if (!Number.isFinite(c)) continue;  // skip years with no capex data
    // F-ME-008 fix (Tag 233b): symmetric to capex treatment — when the company HAS
    // non-null R&D in at least one year (rnd.length > 0) but this specific year is
    // null, skip rather than substitute 0. Substituting 0 understates reinvestment
    // for R&D-active companies with mid-window data gaps (Yahoo schema changes).
    // Guard: use rnd (filtered non-null) not rawRnd — rawRnd can be all-null for
    // companies Yahoo populates but always returns null (COST, V), which would
    // wrongly skip all years and produce 0 usable ratios.
    if (rnd.length > 0 && (j >= rawRnd.length || !Number.isFinite(rawRnd[j]))) {
      rndSkippedYears++;
      continue;
    }
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
  // Tag 225e-1: sector-aware threshold overrides the default for
  // balance-sheet-light financial-services / REIT / insurance models.
  // Precedence: sector-override > asset-light-fallback > default 20%.
  var sectorThreshold = _sectorThresholdFor(stock);
  var thresholdSource = 'default';
  var effectiveThreshold = THRESHOLD;
  if (sectorThreshold != null) {
    effectiveThreshold = sectorThreshold;
    thresholdSource = 'sector';
  } else if (assetLight) {
    effectiveThreshold = 0.10;
    thresholdSource = 'asset-light';
  }
  var pass = med >= effectiveThreshold;

  return H.buildResult({
    computable: true,
    pass: pass,
    value: med,
    components: {
      median: med, ratios: ratios,
      yearsConsidered: ratios.length,
      capexUsed: true, rndUsed: usedRnD, rndSkippedYears: rndSkippedYears, ocfSource: ocfSource,
      _ocfSource: { reported: ocfReportedCount, synthesized: ocfSynthesizedCount },
      assetLight: assetLight, capexRevMedian: capexRevMed,
      effectiveThreshold: effectiveThreshold,
      thresholdSource: thresholdSource
    },
    reason: '5Y-Median (Capex' + (usedRnD ? '+R&D' : '') + ')/OCF[' + ocfSource + '] = ' + (med*100).toFixed(1) + '% (vs ' + (effectiveThreshold*100).toFixed(0) + '%' + (thresholdSource !== 'default' ? ' ' + thresholdSource : '') + ', ' + ratios.length + 'y)',
    threshold: effectiveThreshold, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Direct Reinvestment Rate: 5Y Median (Capex+R&D)/OCF >= 20% (OCF from annualOCF; FCF+|Capex| fallback)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate: evaluate
};
