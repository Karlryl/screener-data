'use strict';
// Reporting-currency hand table (2026-10-30).
//
// Yahoo omits financialCurrency for PSQL. mapYahooToCanonical then falls back to the USD trading currency, so the
// euro statements are stored as dollars: amounts and ratios against the USD market cap are off, growth stays right.
// A proven row fills only the missing value; the ordinary conversion does the rest.
const fs = require('fs');
const path = require('path');

const TABLE_PATH = path.join(__dirname, '..', 'configs', 'reporting-currency-hand-table.json');
const PROVENANCE = 'hand-table:reporting-currency';

/**
 * Loads and validates the table; a malformed row throws (fail loud).
 * @param {string} [file] Table JSON path.
 * @returns {Object<string, object>} Rows keyed by ticker ('_'-prefixed keys skipped).
 */
function loadReportingCurrencyTable(file = TABLE_PATH) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = {};
  for (const [ticker, r] of Object.entries(raw)) {
    if (ticker.startsWith('_')) continue;
    const bad = (why) => { throw new Error(`${file}: row ${ticker}: ${why}`); };
    if (!r || typeof r !== 'object') bad('not an object');
    if (!/^[A-Z]{3}$/.test(r.statementCurrency || '') || r.statementCurrency === 'USD') bad('statementCurrency must be a non-USD ISO code');
    if (!/^https:\/\//.test(r.url || '')) bad('url missing');
    for (const f of ['issuer', 'source', 'page', 'quote', 'verifiedAt']) {
      if (typeof r[f] !== 'string' || !r[f].trim()) bad(`${f} missing`);
    }
    rows[ticker] = r;
  }
  return rows;
}

/**
 * Reporting currency of a mapped snapshot: the vendor's value, or the row's where the vendor has none.
 * @param {string} ticker Ticker.
 * @param {string|null|undefined} vendorCurrency Yahoo financialCurrency, returned unchanged without a row.
 * @param {Object<string, object>} table Rows from loadReportingCurrencyTable().
 * @returns {{currency: (string|null|undefined), source?: string, conflict?: string}} Currency, plus the provenance of a fill or the text of a conflict.
 */
function reportingCurrencyFill(ticker, vendorCurrency, table) {
  const row = Object.prototype.hasOwnProperty.call(table, ticker) ? table[ticker] : null;
  if (!row) return { currency: vendorCurrency };
  if (!vendorCurrency) return { currency: row.statementCurrency, source: PROVENANCE };
  if (vendorCurrency === row.statementCurrency) return { currency: vendorCurrency };
  return { currency: vendorCurrency, conflict: `Yahoo financialCurrency ${vendorCurrency} != row ${row.statementCurrency} - re-verify row` };
}

/**
 * True when a stored snapshot was converted under another currency than its row (force one full pull).
 * @param {object} snap Stored snapshot.
 * @param {Object<string, object>} table Rows from loadReportingCurrencyTable().
 * @returns {boolean} Row exists, the stored currency differs and no conflict was stamped.
 */
function reportingRowPending(snap, table) {
  const m = snap && snap.meta;
  if (!m || !Object.prototype.hasOwnProperty.call(table, m.ticker) || m._reportingCcyHandTableConflict) return false;
  return (m.reportingCurrencyOriginal || m.reportingCurrency) !== table[m.ticker].statementCurrency;
}

module.exports = { loadReportingCurrencyTable, reportingCurrencyFill, reportingRowPending, PROVENANCE, TABLE_PATH };
