'use strict';
const fs = require('node:fs');
const { loadShareCountTable, applyShareCountTable, DERIVED_FIELDS, SHARES_TABLE_PATH: TABLE_PATH } = require('./ads-hand-table.js');
const floors = require('../configs/market-cap-floors.json');
const shares = loadShareCountTable();
const table = Object.assign(Object.create(null), Object.fromEntries(Object.entries(shares).filter(([, row]) => row.withholdUnverified === true)));
const holds = JSON.parse(fs.readFileSync(TABLE_PATH, 'utf8'))._holds;
const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
/** Use the reporting rate only when full pulls prove both original currencies equal.
 * @param {object} meta Canonical currency stamps.
 * @returns {number|null} Proven native quote to USD factor, or no proof.
 */
const tradingRate = meta => meta.tradingFxRateApplied ??
  ((meta.tradingCurrencyOriginal || meta.tradingCurrency) === (meta.reportingCurrencyOriginal || meta.reportingCurrency)
    ? meta.fxRateApplied : null);
if (!holds || typeof holds !== 'object' || Array.isArray(holds)) throw new Error('Invalid market-cap holds');
Object.setPrototypeOf(holds, null);
for (const [ticker, row] of Object.entries({ ...table, ...holds })) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.reviewBy || '') || !day(row.validFrom) || !row.reason || !row.source?.url?.startsWith('https://') || !row.source?.quote ||
      (shares[ticker] && holds[ticker])) throw new Error('Invalid market-cap case: ' + ticker);
}

/** Apply only source-backed market-cap cases after USD normalization, in place.
 * @param {object} snapshot Canonical snapshot; retained raw files are never written here.
 * @param {number|null} [quotePriceUsd] Fresh pull price after the caller's USD conversion; null forbids a cached-price fallback.
 * @returns {object} Existing hand-table status, or withheld/no-row.
 */
function applyMarketCapGuard(snapshot, quotePriceUsd) {
  const ticker = snapshot?.meta?.ticker;
  const row = table[ticker] || holds[ticker];
  if (!row) { if (snapshot?.meta) delete snapshot.meta.marketCapReason; return { status: 'no-row' }; }
  const observed = day(snapshot.marketCap?.asOf || snapshot.meta.asOf);
  if (observed && observed < row.validFrom) { delete snapshot.meta.marketCapReason; return { status: 'no-row' }; }
  if (observed && observed > row.reviewBy) console.warn(`::warning::${ticker}: reviewBy ${row.reviewBy} überschritten; Börsenwert bleibt bis zur erneuten Belegprüfung leer.`);
  if (snapshot.marketCap?.source === 'hand-table:market-cap-hold') return { status: 'withheld' };
  let result = { status: 'stale' };
  const currency = snapshot.meta.tradingCurrencyOriginal || snapshot.meta.tradingCurrency;
  const priceCurrency = quotePriceUsd === undefined ? snapshot.price?.currencyUnit || snapshot.meta.priceCurrency : 'USD';
  const price = quotePriceUsd === undefined ? snapshot.price?.regularMarketPrice : quotePriceUsd;
  const usd = priceCurrency === 'USD' && (currency === 'USD' ||
    (snapshot.meta.fxConverted === true && Number.isFinite(tradingRate(snapshot.meta)) && tradingRate(snapshot.meta) > 0));
  if (table[ticker] && observed && observed <= row.reviewBy && usd) {
    result = applyShareCountTable(snapshot, ticker, price, table);
    if (['confirmed', 'corrected', 'already-corrected'].includes(result.status)) {
      // Full pulls lack snapshot.price; retain the fresh USD input for subsequent reads and provenance.
      if (['corrected', 'confirmed'].includes(result.status) && quotePriceUsd !== undefined) {
        snapshot.price = { ...snapshot.price, regularMarketPrice: price, currencyUnit: 'USD', asOf: snapshot.marketCap.asOf };
      }
      if (result.status !== 'confirmed') snapshot.meta.marketCapReason = row.reason;
      else delete snapshot.meta.marketCapReason;
      return result;
    }
  }
  const previous = snapshot.marketCap || {};
  snapshot.marketCap = { ...previous, value: null, missing: true, source: 'hand-table:market-cap-hold',
    yahooValue: previous.yahooValue ?? previous.value ?? null };
  // reasonComplete: the row's reason already says why no value can exist (e.g. a delisted line), so the
  // standard "not yet proven" sentence would be untrue there.
  snapshot.meta.marketCapReason = `Börsenwert nicht verlässlich: ${row.reason}` +
    (row.reasonComplete === true ? '' : ' Ein aktueller vergleichbarer Wert ist noch nicht belegt.');
  if (snapshot.metrics) for (const field of DERIVED_FIELDS) if (snapshot.metrics[field] != null) snapshot.metrics[field] = null;
  return { status: 'withheld', reason: snapshot.meta.marketCapReason };
}

/** Prepare a read-only copy for known cases; unrelated rows retain identity and bytes.
 * @param {object} snapshot Canonical snapshot.
 * @returns {object} Prepared snapshot or original when no correction applies.
 */
function prepareMarketCap(snapshot) {
  if (!table[snapshot?.meta?.ticker] && !holds[snapshot?.meta?.ticker] && !snapshot?.meta?.marketCapReason) return snapshot;
  const copy = structuredClone(snapshot);
  applyMarketCapGuard(copy);
  return copy;
}

/** Match the pull's existing configurable size floor, without importing its I/O.
 * @param {object} env Environment carrying MIN_MCAP_USD.
 * @returns {number} Existing production USD floor, default 800 million.
 */
function marketCapFloor(env = process.env) {
  const value = parseFloat(env.MIN_MCAP_USD || '');
  return Number.isFinite(value) && value >= 0 ? value : floors.mainUsd;
}

/** Reapply the size filter only to known corrected listings, including cached inputs.
 * @param {object} snapshot Prepared canonical input.
 * @param {number} floor Effective main or smallcap floor.
 * @returns {boolean} Whether this hand-table case is now below the existing floor.
 */
function correctedBelowFloor(snapshot, floor = marketCapFloor()) {
  return !!table[snapshot?.meta?.ticker] && Number.isFinite(snapshot.marketCap?.value) && snapshot.marketCap.value < floor;
}

module.exports = { applyMarketCapGuard, prepareMarketCap, marketCapFloor, correctedBelowFloor, tradingRate, table, holds };
