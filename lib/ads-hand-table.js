'use strict';
// ADS hand table (T322, W2 diagnosis 2026-09-26).
//
// Yahoo prices some US ADS lines with the ORDINARY share count: HSAI 16.25 USD x 1,257,137,688
// Class B shares = 20.43 bn, but each ADS is 8 shares -> 2.55 bn (2525.HK agrees). BSBR is 2x.
// configs/ads-hand-table.json lists the proven rows; applyAdsHandTable() runs at both marketCap
// write sites of pull-yahoo.js (full pull + price-only) and divides only while the error is visible.
// The share-count table (configs/share-count-hand-table.json, below) runs at the same two sites.
const fs = require('fs');
const path = require('path');

const TABLE_PATH = path.join(__dirname, '..', 'configs', 'ads-hand-table.json');
const PROVENANCE = 'hand-table:ads';
const TOL = 0.03;
// Yahoo fields computed from the wrong marketCap (same set pull-yahoo.js scales with it:
// HANDELS_AGGREGAT_METRIKEN + MISCH_VERHAELTNIS_METRIKEN). Blanked to null, never 0.
const DERIVED_FIELDS = ['priceSales', 'enterpriseValue', 'enterpriseToRevenue', 'enterpriseToEbitda'];

/**
 * Loads and validates the ADS hand table; a malformed row throws (fail loud).
 * @param {string} [file] Path to the table JSON (default configs/ads-hand-table.json).
 * @returns {Object<string, object>} Rows keyed by ticker ('_'-prefixed keys skipped).
 */
function loadAdsHandTable(file = TABLE_PATH) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  // [], true or 42 would iterate to zero rows and switch every correction off without a sound.
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${file}: root must be an object of rows`);
  const rows = {};
  for (const [ticker, r] of Object.entries(raw)) {
    if (ticker.startsWith('_')) continue;
    const bad = (why) => { throw new Error(`${file}: row ${ticker}: ${why}`); };
    if (!r || typeof r !== 'object') bad('not an object');
    if (!Number.isInteger(r.ordinaryPerAds) || r.ordinaryPerAds < 2) bad('ordinaryPerAds must be an integer >= 2');
    if (!(Number.isFinite(r.yahooOrdinaryShares) && r.yahooOrdinaryShares > 0)) bad('yahooOrdinaryShares must be > 0');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.validFrom || '')) bad('validFrom must be YYYY-MM-DD');
    for (const f of ['pairLeg', 'source', 'verifiedAt']) {
      if (typeof r[f] !== 'string' || !r[f].trim()) bad(`${f} missing`);
    }
    rows[ticker] = r;
  }
  return rows;
}

// ponytail: a non-USD or pence line never matches the 3 % check -> it shows as 'stale', never corrected.
/**
 * Divides a table row's marketCap by ordinaryPerAds while Yahoo's error is still visible,
 * stamps 'hand-table:ads' and blanks the derived Yahoo fields to null.
 * @param {object} snap Snapshot in the real key shape, mutated in place.
 * @param {string} ticker Snapshot ticker (table key).
 * @param {number} price ADS price in the marketCap's unit (USD for every ADS line in the table).
 * @param {Object<string, object>} table Rows from loadAdsHandTable().
 * @returns {{status: string, reason?: string}} 'no-row' | 'corrected' | 'already-corrected' | 'stale'.
 */
function applyAdsHandTable(snap, ticker, price, table) {
  const row = table && Object.prototype.hasOwnProperty.call(table, ticker) ? table[ticker] : null;
  if (!row) return { status: 'no-row' };
  const mc = snap && snap.marketCap;
  // Price-only refresh without a new Yahoo marketCap keeps the corrected value: never divide twice.
  if (mc && mc.source === PROVENANCE) return { status: 'already-corrected' };
  // A Yahoo-sourced value must not carry the stamps of an earlier correction.
  if (mc) { delete mc.yahooValue; delete mc.ordinaryPerAds; }
  const v = mc && mc.value;
  const meta = (snap && snap.meta) || {};
  const shares = meta.impliedSharesOutstanding || meta.sharesOutstanding;
  const asOf = (mc && mc.asOf) || meta.asOf;
  // Stale = Yahoo's value is kept, and the snapshot says so (meta._adsHandTableStale), not only the log.
  const stale = (reason) => { if (snap && snap.meta) snap.meta._adsHandTableStale = reason; return { status: 'stale', reason }; };
  if (!(v > 0) || !(price > 0) || !(shares > 0)) return stale('marketCap/price/shares missing');
  if (typeof asOf !== 'string' || asOf.slice(0, 10) < row.validFrom) return stale(`asOf ${asOf} before validFrom ${row.validFrom}`);
  const k = row.ordinaryPerAds;
  const priceTimesShares = v / (price * shares);
  // Yahoo still counts ordinary shares? (nearer the ordinary count than the ADS-equivalent count)
  const ordinaryScale = Math.abs(Math.log(shares / row.yahooOrdinaryShares)) < Math.log(k) / 2;
  if (Math.abs(priceTimesShares - 1) > TOL || !ordinaryScale) {
    return stale(`error no longer visible (mcap/(price*shares)=${priceTimesShares.toFixed(3)}, shares=${shares}) - re-verify row`);
  }
  if (snap.meta) delete snap.meta._adsHandTableStale;
  mc.yahooValue = v;
  mc.value = v / k;
  mc.ordinaryPerAds = k;
  mc.source = PROVENANCE;
  if (snap.metrics) for (const f of DERIVED_FIELDS) if (snap.metrics[f] != null) snap.metrics[f] = null;
  return { status: 'corrected' };
}

// Share-count hand table (Tag 1397, W2 2026-10-02). Yahoo prices some USD lines with a wrong share
// count (ABTC after its 1-for-15 reverse split, ANDG Class A only of an Up-C, JBS flipping between
// two counts). A row carries the issuer's count (`shares`) and the vendor's known wrong counts
// (`wrongShares`), both compared with the count the vendor value implies (marketCap / price):
//   near `shares`      -> 'confirmed', snapshot untouched
//   near a wrongShares -> 'corrected' to marketCap x shares / implied (= price x shares)
//   anything else      -> 'stale': vendor value kept, meta._shareCountHandTableStale stamped
const SHARES_TABLE_PATH = path.join(__dirname, '..', 'configs', 'share-count-hand-table.json');
const SHARES_PROVENANCE = 'hand-table:shares';
const near = (a, b) => Math.abs(a / b - 1) <= TOL;

/**
 * Loads and validates the share-count hand table; a malformed row throws (fail loud).
 * @param {string} [file] Path to the table JSON (default configs/share-count-hand-table.json).
 * @returns {Object<string, object>} Rows keyed by ticker ('_'-prefixed keys skipped).
 */
function loadShareCountTable(file = SHARES_TABLE_PATH) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${file}: root must be an object of rows`);
  const rows = {};
  for (const [ticker, r] of Object.entries(raw)) {
    if (ticker.startsWith('_')) continue;
    const bad = (why) => { throw new Error(`${file}: row ${ticker}: ${why}`); };
    if (!r || typeof r !== 'object') bad('not an object');
    if (!(Number.isInteger(r.shares) && r.shares > 0)) bad('shares must be a positive integer');
    if (!Array.isArray(r.wrongShares) || !r.wrongShares.length || !r.wrongShares.every((w) => Number.isFinite(w) && w > 0)) bad('wrongShares must be a non-empty list of counts > 0');
    // Two fingerprints within 2 x TOL of each other could both match one vendor value.
    if (r.wrongShares.some((w) => Math.abs(Math.log(w / r.shares)) <= Math.log(1 + 2 * TOL))) bad('a wrongShares count is too close to shares');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.sharesAsOf || '')) bad('sharesAsOf must be YYYY-MM-DD');
    const s = r.source;
    if (!s || !/^https:\/\//.test(s.url || '') || typeof s.quote !== 'string' || !s.quote.trim()) bad('source needs url and quote');
    if (typeof r.verifiedAt !== 'string' || !r.verifiedAt.trim()) bad('verifiedAt missing');
    rows[ticker] = r;
  }
  return rows;
}

// ponytail: a non-USD line's implied count is off by the FX factor -> matches nothing -> 'stale', never corrected.
/**
 * Replaces a table row's marketCap by price x issuer share count while the vendor value carries a
 * known wrong count; stamps 'hand-table:shares' and blanks the derived Yahoo fields to null.
 * @param {object} snap Snapshot in the real key shape, mutated in place.
 * @param {string} ticker Snapshot ticker (table key).
 * @param {number} price Price in the marketCap's unit (USD for every row in the table).
 * @param {Object<string, object>} table Rows from loadShareCountTable().
 * @returns {{status: string, reason?: string}} 'no-row' | 'confirmed' | 'corrected' | 'already-corrected' | 'stale'.
 */
function applyShareCountTable(snap, ticker, price, table) {
  const row = table && Object.prototype.hasOwnProperty.call(table, ticker) ? table[ticker] : null;
  if (!row) return { status: 'no-row' };
  const mc = snap && snap.marketCap;
  // Price-only refresh without a new Yahoo marketCap keeps the corrected value.
  if (mc && mc.source === SHARES_PROVENANCE) return { status: 'already-corrected' };
  if (mc) { delete mc.yahooValue; delete mc.vendorImpliedShares; }
  const stale = (reason) => { if (snap && snap.meta) snap.meta._shareCountHandTableStale = reason; return { status: 'stale', reason }; };
  const v = mc && mc.value;
  if (!(v > 0) || !(price > 0)) return stale('marketCap/price missing');
  const implied = v / price;
  if (near(implied, row.shares)) {
    if (snap.meta) delete snap.meta._shareCountHandTableStale;
    return { status: 'confirmed' };
  }
  if (!row.wrongShares.some((w) => near(implied, w))) {
    return stale(`vendor implies ${Math.round(implied)} shares, neither the issuer count ${row.shares} nor a known wrong count - re-verify row`);
  }
  if (snap.meta) delete snap.meta._shareCountHandTableStale;
  mc.yahooValue = v;
  mc.vendorImpliedShares = Math.round(implied);
  mc.value = v * (row.shares / implied);
  mc.source = SHARES_PROVENANCE;
  if (snap.metrics) for (const f of DERIVED_FIELDS) if (snap.metrics[f] != null) snap.metrics[f] = null;
  return { status: 'corrected' };
}

module.exports = {
  loadAdsHandTable, applyAdsHandTable, DERIVED_FIELDS, PROVENANCE, TABLE_PATH,
  loadShareCountTable, applyShareCountTable, SHARES_PROVENANCE, SHARES_TABLE_PATH,
};
