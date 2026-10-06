'use strict';

const rawConfig = require('../configs/non-operating-classes.json');
const CODES = Object.freeze([
  'nichtOperativGeschlossenerFonds', 'nichtOperativEtf', 'nichtOperativSpac',
  'nichtOperativHolding', 'nichtOperativBdc', 'nichtOperativRoyaltyTrust',
  'nichtOperativKryptoTreasury',
]);

/**
 * Validate the evidence table before either exporter can use it; never repair bad input.
 * @param {object} config Candidate configuration (confidence is a percentage, not a fraction).
 * @returns {object} The validated, unchanged configuration.
 */
function validateNonOperatingConfig(config) {
  const fail = (message) => { throw new Error('non-operating-classes: ' + message); };
  const text = (value) => typeof value === 'string' && value.trim().length > 0;
  if (!config || config.schemaVersion !== 1) fail('schemaVersion must be 1');
  if (!text(config.boundary)) fail('boundary is required');
  if (config.cryptoTreasuryMinShareOfTotalAssets !== 0.5) fail('threshold must remain 0.5');
  if (!config.classes || Array.isArray(config.classes)
      || Object.keys(config.classes).length !== CODES.length
      || !CODES.every((code) => Object.hasOwn(config.classes, code) && text(config.classes[code]))) {
    fail('classes must contain exactly the seven known class codes and display texts');
  }
  if (!Array.isArray(config.entries)) fail('entries must be an array');
  const seen = new Set();
  for (const entry of config.entries) {
    if (!entry || !text(entry.ticker) || entry.ticker !== entry.ticker.trim()
        || entry.ticker !== entry.ticker.toUpperCase()) fail('invalid ticker');
    if (seen.has(entry.ticker)) fail('duplicate ticker ' + entry.ticker);
    seen.add(entry.ticker);
    if (!CODES.includes(entry.class)) fail('unknown class code for ' + entry.ticker);
    for (const field of ['source', 'sourceUrl', 'sourceQuote']) {
      if (!text(entry[field])) fail('missing evidence ' + field + ' for ' + entry.ticker);
    }
    let url;
    try { url = new URL(entry.sourceUrl); } catch (_) { fail('invalid sourceUrl for ' + entry.ticker); }
    if (!['https:', 'p66:'].includes(url.protocol)) fail('unsupported sourceUrl for ' + entry.ticker);
    if (!Number.isFinite(entry.confidence) || entry.confidence <= 0 || entry.confidence > 100) {
      fail('invalid confidence for ' + entry.ticker);
    }
    if (entry.class === 'nichtOperativKryptoTreasury') {
      if (url.protocol !== 'https:') fail('crypto evidence must cite a filing for ' + entry.ticker);
      if (!Number.isFinite(entry.digitalAssets) || entry.digitalAssets < 0
          || !Number.isFinite(entry.totalAssets) || entry.totalAssets <= 0) {
        fail('invalid crypto balance sheet amounts for ' + entry.ticker);
      }
      const share = entry.digitalAssets / entry.totalAssets;
      if (share < config.cryptoTreasuryMinShareOfTotalAssets || share > 1) {
        fail('crypto share outside threshold..1 for ' + entry.ticker);
      }
      if (!Number.isFinite(entry.share) || Math.abs(entry.share - share) > 1e-12) {
        fail('crypto share does not match amounts for ' + entry.ticker);
      }
      if (!/^[A-Z]{3}$/.test(entry.currency || '')) fail('invalid crypto currency for ' + entry.ticker);
      const date = entry.balanceSheetDate;
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
          || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
        fail('invalid crypto balanceSheetDate for ' + entry.ticker);
      }
    }
  }
  return config;
}

const config = validateNonOperatingConfig(rawConfig);
// Snapshot the lookup; consumers cannot mutate the require-cached JSON to change a running export.
const membership = new Map(config.entries.map((entry) => [entry.ticker, entry.class]));
const displayTexts = Object.freeze({ ...config.classes });

/**
 * Return the additive shadow code for an exact export ticker; this never decides a rank.
 * @param {string} ticker Export ticker, including its exchange suffix.
 * @returns {string|null} A configured reason code, or null for an unlisted ticker.
 */
function rankGrundShadowFor(ticker) {
  return membership.get(ticker) || null;
}

/**
 * Look up the German display text of a shadow code (absence is null).
 * @param {string|null|undefined} code Optional shadow reason code.
 * @returns {string|null} German text, or null for an absent code; unknown codes throw.
 */
function rankGrundShadowDisplayText(code) {
  if (code == null) return null;
  if (!Object.hasOwn(displayTexts, code)) throw new Error('Unknown rankGrundShadow code: ' + code);
  return displayTexts[code];
}

module.exports = { validateNonOperatingConfig, rankGrundShadowFor, rankGrundShadowDisplayText };
