'use strict';
/**
 * Tag 167: Region-aware sector-median lookup helper.
 *
 * Supports both the new region-aware schema (v2):
 *   { _version: 2, byRegion: { US: { SAAS: { roic: 0.15 } }, _GLOBAL: { ... } } }
 *
 * and the legacy flat schema (v1):
 *   { SAAS: { roic: 0.15 }, BANK: { ... } }
 *
 * Method files that call effectiveThreshold() do NOT need to change — the upgrade
 * is handled in _helpers.js. This module is the shared lookup logic.
 */

const { getRegion } = require('./region-mapping.js');

/**
 * Look up a sector median value with region-first, global fallback.
 *
 * @param {object} medians  — full medians object (v1 flat OR v2 { byRegion: {...} })
 * @param {object} stock    — canonical stock object (needs meta.exchange or price.currency)
 * @param {string} subProfileId — e.g. 'SAAS', 'BANK', 'INDUSTRIAL'
 * @param {string} metricName   — e.g. 'roic', 'fcf-yield', 'roce'
 * @returns {{ value: number|null, source: string }}
 */
function lookupMedian(medians, stock, subProfileId, metricName) {
  if (!medians) return { value: null, source: 'not-found' };

  // --- v2 schema: { _version: 2, byRegion: { US: {...}, _GLOBAL: {...} } } ---
  if (medians._version === 2 && medians.byRegion) {
    const region = getRegion(stock);

    // Try region-specific first
    const regionBucket = medians.byRegion[region];
    if (regionBucket && regionBucket[subProfileId] &&
        regionBucket[subProfileId][metricName] != null) {
      return {
        value: regionBucket[subProfileId][metricName],
        source: region + '/' + subProfileId
      };
    }

    // Fall back to _GLOBAL
    const globalBucket = medians.byRegion['_GLOBAL'];
    if (globalBucket && globalBucket[subProfileId] &&
        globalBucket[subProfileId][metricName] != null) {
      return {
        value: globalBucket[subProfileId][metricName],
        source: 'GLOBAL/' + subProfileId
      };
    }

    return { value: null, source: 'not-found' };
  }

  // --- v1 legacy flat schema: { SAAS: { roic: 0.15 }, ... } ---
  if (medians[subProfileId] && medians[subProfileId][metricName] != null) {
    return {
      value: medians[subProfileId][metricName],
      source: 'legacy/' + subProfileId
    };
  }

  return { value: null, source: 'not-found' };
}

/**
 * Tag 209b: Look up a sector PERCENTILE (p25/p50/p75/p90) with region-first,
 * global fallback. Mirrors lookupMedian() but reads the '_p25_<metric>' etc.
 * keys written by sector-medians-compute.js.
 *
 * @param {object} medians — full medians object (v2 region-aware shape)
 * @param {object} stock — canonical stock object
 * @param {string} subProfileId — e.g. 'SAAS', 'BANK'
 * @param {string} metricName — e.g. 'roic'
 * @param {number} pTag — one of 25, 50, 75, 90
 * @param {number} [minN] — minimum sample count required (returns not-found if below); default 5
 * @returns {{ value: number|null, source: string, n: number|null }}
 */
function lookupPercentile(medians, stock, subProfileId, metricName, pTag, minN) {
  if (!medians) return { value: null, source: 'not-found', n: null };
  if (![25, 50, 75, 90].includes(pTag)) {
    return { value: null, source: 'invalid-percentile', n: null };
  }
  const minSamples = Number.isFinite(minN) ? minN : 5;
  const pKey = '_p' + pTag + '_' + metricName;
  const nKey = '_n_' + metricName;

  // --- v2 schema ---
  if (medians._version === 2 && medians.byRegion) {
    const region = getRegion(stock);

    const regionBucket = medians.byRegion[region];
    if (regionBucket && regionBucket[subProfileId] &&
        regionBucket[subProfileId][pKey] != null) {
      const n = regionBucket[subProfileId][nKey];
      if (Number.isFinite(n) && n >= minSamples) {
        return { value: regionBucket[subProfileId][pKey], source: region + '/' + subProfileId, n };
      }
    }

    const globalBucket = medians.byRegion['_GLOBAL'];
    if (globalBucket && globalBucket[subProfileId] &&
        globalBucket[subProfileId][pKey] != null) {
      const n = globalBucket[subProfileId][nKey];
      if (Number.isFinite(n) && n >= minSamples) {
        return { value: globalBucket[subProfileId][pKey], source: 'GLOBAL/' + subProfileId, n };
      }
    }

    return { value: null, source: 'not-found', n: null };
  }

  // --- v1 legacy flat schema ---
  if (medians[subProfileId] && medians[subProfileId][pKey] != null) {
    const n = medians[subProfileId][nKey];
    if (Number.isFinite(n) && n >= minSamples) {
      return { value: medians[subProfileId][pKey], source: 'legacy/' + subProfileId, n };
    }
  }

  return { value: null, source: 'not-found', n: null };
}

module.exports = { lookupMedian, lookupPercentile };
