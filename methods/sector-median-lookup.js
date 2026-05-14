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

module.exports = { lookupMedian };
