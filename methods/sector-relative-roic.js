'use strict';
/**
 * Tag 209b: Sector-Relative ROIC Percentile (DIAGNOSTIC)
 * ========================================================
 * Converts absolute ROIC into a SECTOR-relative percentile signal.
 *
 * Why this matters
 * ----------------
 * A 12% ROIC software company is BAD (peer SAAS median ~8-15%, top quartile ~25%+).
 * A 12% ROIC utility / industrial is GREAT (peer median ~5%, top quartile ~10%).
 * The existing `roic.js` uses an absolute 15% threshold (with sector-median override
 * via effectiveThreshold), but it does NOT expose where a stock SITS within its
 * peer-group distribution — Stock Rover, Koyfin, Tikr, Simply Wall St all treat
 * peer-relative percentile ranking as table-stakes.
 *
 * Formula (from Tag 208 competitive-research report, Method A)
 * ------------------------------------------------------------
 *   roic_now      = annualNetIncome[0] / (totalAssets[0] - totalCash[0])
 *   sector_p50    = sector-median ROIC for stock's sub-profile (peer-group)
 *   sector_p75    = sector-75th-percentile ROIC for stock's sub-profile
 *
 *   rank =   0  if roic_now <= 0
 *           25  if roic_now <  sector_p50 * 0.5
 *           50  if roic_now <  sector_p50
 *           75  if roic_now <  sector_p75
 *           90  if roic_now >= sector_p75
 *          100  if roic_now >= sector_p75 * 1.5
 *
 *   pass = rank >= 75   (top quartile of sector)
 *
 * Method type
 * -----------
 * DIAGNOSTIC, defaultActive: true. NOT added to SCORE_WEIGHTS — fixture-hash
 * invariant safe (diagnostic methods cannot move the aggregator score).
 *
 * Failure modes (clean computable:false, no hard fail)
 * ----------------------------------------------------
 *   - missing netIncome / totalAssets         → cannot compute roic_now
 *   - invested capital <= 0                   → cannot compute roic_now
 *   - sub-profile not classifiable            → no peer group
 *   - sub-profile has < 5 stocks in medians   → unreliable percentile (per
 *                                               lookupPercentile minN guard)
 *   - sector-medians-auto.json has no _p75_ key for this metric (pre-Tag-209b
 *     generated file, before first re-pull)  → not-found, computable:false
 *
 * Pattern-based, no hardcoded tickers. No hardcoded sector names — relies on
 * the existing sub-profile classifier (engine-v7.3.classifySubProfile) and
 * the sector-medians-auto.json file produced by sector-medians-compute.js.
 */
const fs = require('fs');
const path = require('path');
const H = require('./_helpers.js');
const { lookupMedian, lookupPercentile } = require('./sector-median-lookup.js');

const ID = 'sector-relative-roic';
const LABEL = 'ROIC (Sector-Relative Percentile)';
const THRESHOLD = 75;          // pass if percentile rank >= 75 (top quartile of sector)
const THRESHOLD_OP = 'gte';
const METRIC_KEY = 'roic';     // key under which medians/percentiles are stored
const MIN_SECTOR_N = 5;        // minimum sector sample count for the percentile to be trustworthy

// Cache the sector-medians file. Re-uses the same loader pattern as _helpers.js
// but kept local so this method doesn't depend on _helpers internals.
let _autoMediansCache = null;
function _loadAutoMedians() {
  if (_autoMediansCache !== null) return _autoMediansCache;
  try {
    const p = path.join(__dirname, 'sector-medians-auto.json');
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (raw && raw._version === 2 && raw.byRegion) {
      _autoMediansCache = raw;
    } else if (raw && raw.medians) {
      _autoMediansCache = { _version: 2, byRegion: { _GLOBAL: raw.medians } };
    } else {
      _autoMediansCache = {};
    }
  } catch (e) {
    _autoMediansCache = {};
  }
  return _autoMediansCache;
}

function _computeRoic(stock) {
  // Mirror roic.js exactly — methods do not receive sibling-method results.
  const ni = H.latestAnnual(stock, 'annualNetIncome');
  const ta = H.latestBalance(stock, 'totalAssets');
  const tc = H.latestBalance(stock, 'totalCash');
  if (ni == null || ta == null) return null;
  const ic = ta - (tc || 0);
  if (ic <= 0) return null;
  return ni / ic;
}

function _rankRoic(roic, p50, p75) {
  if (roic == null) return null;
  if (roic <= 0) return 0;
  // Guard inverted/degenerate sector distributions (p50 <= 0).
  if (p50 == null || p75 == null) return null;
  if (p50 <= 0) return null;
  if (roic >= p75 * 1.5) return 100;
  if (roic >= p75)        return 90;
  if (roic >= p50)        return 75;
  if (roic >= p50 * 0.5)  return 50;
  return 25;
}

function evaluate(stock) {
  // --- 1. Compute the stock's ROIC (same formula as roic.js) ---
  const roicValue = _computeRoic(stock);
  if (roicValue == null) {
    return H.buildResult({
      computable: false,
      reason: 'roic not computable (missing netIncome/totalAssets or invested capital <= 0)',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // --- 2. Resolve peer group (sub-profile) ---
  const sp = H.classifySubProfile(stock);
  if (!sp || !sp.id) {
    return H.buildResult({
      value: roicValue,
      computable: false,
      reason: 'sub-profile not classifiable — no peer group',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // --- 3. Load percentiles ---
  const medians = _loadAutoMedians();
  const p50Lookup = lookupPercentile(medians, stock, sp.id, METRIC_KEY, 50, MIN_SECTOR_N);
  const p75Lookup = lookupPercentile(medians, stock, sp.id, METRIC_KEY, 75, MIN_SECTOR_N);

  // Fallback to plain median (p50) when _p50_ key absent — happens when the
  // medians file pre-dates Tag 209b and hasn't been regenerated yet.
  let p50 = p50Lookup.value;
  let p50Source = p50Lookup.source;
  if (p50 == null) {
    const mLookup = lookupMedian(medians, stock, sp.id, METRIC_KEY);
    p50 = mLookup.value;
    p50Source = mLookup.source + '(median-fallback)';
  }

  if (p50 == null || p75Lookup.value == null) {
    return H.buildResult({
      value: roicValue,
      computable: false,
      reason: 'sector percentiles unavailable for ' + sp.id +
              ' (p50=' + p50 + ' p75=' + p75Lookup.value +
              ', n>=' + MIN_SECTOR_N + ' required) — re-run sector-medians-compute to populate',
      components: { roicValue, subProfile: sp.id, sectorP50: p50, sectorP75: p75Lookup.value },
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // --- 4. Rank within sector ---
  const rank = _rankRoic(roicValue, p50, p75Lookup.value);
  if (rank == null) {
    return H.buildResult({
      value: roicValue,
      computable: false,
      reason: 'sector ROIC distribution degenerate (p50 <= 0) for ' + sp.id,
      components: { roicValue, subProfile: sp.id, sectorP50: p50, sectorP75: p75Lookup.value },
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const pass = rank >= THRESHOLD;
  return H.buildResult({
    value: rank,
    pass,
    computable: true,
    components: {
      roicValue,
      sectorP50: p50,
      sectorP75: p75Lookup.value,
      sectorRank: rank,
      subProfile: sp.id,
      sectorN: p75Lookup.n,
      thresholdSource: p75Lookup.source
    },
    reason: 'ROIC ' + (roicValue * 100).toFixed(1) + '% vs ' + sp.id +
            ' p50=' + (p50 * 100).toFixed(1) + '% p75=' + (p75Lookup.value * 100).toFixed(1) +
            '% (n=' + p75Lookup.n + ') → rank=' + rank + (pass ? ' ✓ top-quartile' : ''),
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'ROIC ranked within sector peer-group; pass if rank >= 75 (top quartile)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'percentile',
  evaluate
};
