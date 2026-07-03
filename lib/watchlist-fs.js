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

const TICKER_KEY_RE = /^[A-Z0-9.\-]{1,12}$/i;

/**
 * Single source of truth for shape classification. Returns { shape, stocks }
 * where stocks is an array (possibly synthetic) or null when unrecognized.
 *
 * audit F-A-2026-06-21: prevents drift gate corruption from a wrapped file whose
 * stocks field degraded to non-array. Both public functions delegate here so the
 * keyed-map heuristic exists in exactly one place and cannot drift between them.
 */
function _classify(raw) {
  if (Array.isArray(raw)) return { shape: 'array', stocks: raw };
  if (raw && Array.isArray(raw.stocks)) return { shape: 'wrapped', stocks: raw.stocks };
  // Bare-object shape: keys are tickers. Convert to a synthetic array of
  // { ticker, ...value } entries so downstream array consumers Just Work.
  if (raw && typeof raw === 'object') {
    // audit F-A-2026-06-21: a present-but-non-array `stocks` key means this is a
    // degraded/corrupt wrapped file, NOT a ticker-keyed map. Refuse to fall
    // through to the keyed-map heuristic (which would misread metadata keys as
    // tickers and silently disable the drift gate).
    if (Object.prototype.hasOwnProperty.call(raw, 'stocks')) {
      return { shape: 'invalid', stocks: null };
    }
    const keys = Object.keys(raw);
    // audit F-A-2026-06-21: require a MAJORITY of keys to look like tickers
    // (not .some), so a single benign metadata key shaped like a ticker can no
    // longer flip a non-watchlist object into a synthetic ticker map.
    const tickerLike = keys.filter(k =>
      TICKER_KEY_RE.test(k) && raw[k] && typeof raw[k] === 'object');
    const looksKeyedMap = keys.length > 0 && tickerLike.length * 2 > keys.length;
    if (looksKeyedMap) {
      return { shape: 'object', stocks: keys.map(k => Object.assign({ ticker: k }, raw[k])) };
    }
  }
  return { shape: 'invalid', stocks: null };
}

/**
 * Extract a stocks-array from a parsed watchlist payload, regardless of shape.
 * Returns null if the payload is unrecognized.
 */
function extractStocksArray(raw) {
  return _classify(raw).stocks;
}

/**
 * Determine the shape label of a parsed watchlist payload.
 */
function detectShape(raw) {
  return _classify(raw).shape;
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
  // audit F-A-2026-06-21: classify once so shape and stocks are always derived
  // from the same pass and cannot disagree.
  const { shape, stocks } = _classify(raw);
  if (!Array.isArray(stocks)) {
    return { shape, stocks: [], size: 0, raw, error: 'unrecognized watchlist shape' };
  }
  return { shape, stocks, size: stocks.length, raw, error: null };
}

module.exports = { loadWatchlist, extractStocksArray, detectShape };
