'use strict';
/**
 * Tag 220c (audit F-219b-03 LOW): Shared schema-aware watchlist loader.
 *
 * Why: watchlist.json has historically held three shapes —
 *   1. Bare array:   [ { ticker, ... }, ... ]            (very old legacy)
 *   2. Wrapped:      { _meta, stocks: [...], ... }       (current)
 *   3. Bare object:  { TICKER: {...}, ... }              (long-retired keyed map)
 *
 * `scripts/prune-watchlist.js` (Tag 219a) and the daily-pull.yml sanity gate
 * (Tag 207a/207b) handle all three; multiple other consumers assume only the
 * wrapped shape and silently return `null`/`length=0` on the others.
 * `scripts/check-pull-stats.js` was the most visible casualty — a future
 * rollback to a bare array would make `universeSize` permanently null,
 * silently disabling the drift gate.
 *
 * Centralising the loader gives a single source of truth so future schema
 * migrations need to land in exactly one file.
 *
 * Usage:
 *   const { loadWatchlist, extractStocksArray } = require('./lib/watchlist-fs.js');
 *   const wl = loadWatchlist('watchlist.json');
 *   const stocks = wl.stocks;             // always an array (possibly empty)
 *   const size   = wl.size;               // stocks.length convenience
 *   const shape  = wl.shape;              // 'wrapped' | 'array' | 'object' | 'invalid'
 *   const raw    = wl.raw;                // original parsed JSON (for in-place mutation)
 *
 * On parse failure or non-existent file, returns { shape: 'invalid', stocks: [],
 * size: 0, raw: null, error: <message> } — callers decide whether to crash or skip.
 */

const fs = require('fs');

/**
 * Extract a stocks-array from a parsed watchlist payload, regardless of shape.
 * Returns null if the payload is unrecognized.
 */
function extractStocksArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.stocks)) return raw.stocks;
  // Bare-object shape: keys are tickers. Convert to a synthetic array of
  // { ticker, ...value } entries so downstream array consumers Just Work.
  if (raw && typeof raw === 'object') {
    const keys = Object.keys(raw);
    // Heuristic: looks like a ticker-keyed map if at least one key is short
    // uppercase and the matching value is an object. Avoids matching wrappers
    // whose only keys are metadata ('_meta', 'lastUniverseRefresh', etc).
    const looksKeyedMap = keys.some(k =>
      /^[A-Z0-9.\-]{1,12}$/i.test(k) && raw[k] && typeof raw[k] === 'object');
    if (looksKeyedMap) {
      return keys.map(k => Object.assign({ ticker: k }, raw[k]));
    }
  }
  return null;
}

/**
 * Determine the shape label of a parsed watchlist payload.
 */
function detectShape(raw) {
  if (Array.isArray(raw)) return 'array';
  if (raw && Array.isArray(raw.stocks)) return 'wrapped';
  if (raw && typeof raw === 'object') {
    const keys = Object.keys(raw);
    const looksKeyedMap = keys.some(k =>
      /^[A-Z0-9.\-]{1,12}$/i.test(k) && raw[k] && typeof raw[k] === 'object');
    if (looksKeyedMap) return 'object';
  }
  return 'invalid';
}

/**
 * Read + parse + extract. Never throws — see header for the error contract.
 */
function loadWatchlist(filePath) {
  let raw = null;
  try {
    if (!fs.existsSync(filePath)) {
      return { shape: 'invalid', stocks: [], size: 0, raw: null, error: 'file not found: ' + filePath };
    }
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return { shape: 'invalid', stocks: [], size: 0, raw: null, error: e.message };
  }
  const stocks = extractStocksArray(raw);
  const shape = detectShape(raw);
  if (!Array.isArray(stocks)) {
    return { shape, stocks: [], size: 0, raw, error: 'unrecognized watchlist shape' };
  }
  return { shape, stocks, size: stocks.length, raw, error: null };
}

module.exports = { loadWatchlist, extractStocksArray, detectShape };
