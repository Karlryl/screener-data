'use strict';
// Statement-currency hand table (2026-09-26).
//
// Yahoo's financialCurrency is BRL for Petrobras/Embraer, and financialData (revenueTTM, ebitda) is
// indeed BRL - but their statement series (annual.*, timeseries.*) are the US-dollar figures of the
// SEC filings. _convertSnapshotToUSD multiplied those by the BRL rate: EMBJ Q1-2026 revenue
// US$1,446.7M came out as US$284M. configs/statement-currency-hand-table.json lists proven rows;
// statementFactor() returns 1 for them while the mismatch is still visible, else the reporting factor.
const fs = require('fs');
const path = require('path');

const TABLE_PATH = path.join(__dirname, '..', 'configs', 'statement-currency-hand-table.json');
const PROVENANCE = 'hand-table:statement-currency';

/**
 * Loads and validates the table; a malformed row throws (fail loud).
 * @param {string} [file] Table JSON path.
 * @returns {Object<string, object>} Rows keyed by ticker ('_'-prefixed keys skipped).
 */
function loadStatementCurrencyTable(file = TABLE_PATH) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${file}: root must be an object of rows`);
  const rows = {};
  for (const [ticker, r] of Object.entries(raw)) {
    if (ticker.startsWith('_')) continue;
    const bad = (why) => { throw new Error(`${file}: row ${ticker}: ${why}`); };
    if (!r || typeof r !== 'object') bad('not an object');
    // ponytail: USD-only, so the statement factor is exactly 1; other currencies need a rate lookup here.
    if (r.statementCurrency !== 'USD') bad('statementCurrency must be USD');
    if (!/^[A-Z]{3}$/.test(r.yahooFinancialCurrency || '') || r.yahooFinancialCurrency === 'USD') bad('yahooFinancialCurrency must be a non-USD ISO code');
    for (const f of ['issuer', 'source', 'verifiedAt']) {
      if (typeof r[f] !== 'string' || !r[f].trim()) bad(`${f} missing`);
    }
    rows[ticker] = r;
  }
  return rows;
}

const _v = (x) => (x && typeof x === 'object' ? x.value : x);

/**
 * Factor for the statement series of an UNCONVERTED snapshot (call before scaling).
 * Row applies only while Yahoo still names row.yahooFinancialCurrency AND annualRev[0]/revenueTTM
 * sits nearer reportingFactor than 1 (USD statements next to a local-currency TTM). A missing
 * financialCurrency (ccyAmbiguous) never switches the row on.
 * @param {object} snap Canonical snapshot (mutated: meta stamps).
 * @param {string} origCurrency Reporting currency the converter uses (Yahoo financialCurrency).
 * @param {number} reportingFactor origCurrency -> USD factor.
 * @param {Object<string, object>} table Rows from loadStatementCurrencyTable().
 * @returns {{factor: number, status: string, reason?: string}} status 'no-row' | 'corrected' | 'stale'.
 */
function statementFactor(snap, origCurrency, reportingFactor, table) {
  const meta = (snap && snap.meta) || {};
  const row = table && Object.prototype.hasOwnProperty.call(table, meta.ticker) ? table[meta.ticker] : null;
  if (!row) return { factor: reportingFactor, status: 'no-row' };
  const stale = (reason) => { meta._statementCcyHandTableStale = reason; return { factor: reportingFactor, status: 'stale', reason }; };
  if (meta.ccyAmbiguous === true) return stale('financialCurrency missing - row not applied');
  if (origCurrency !== row.yahooFinancialCurrency) return stale(`Yahoo financialCurrency ${origCurrency} != row ${row.yahooFinancialCurrency} - re-verify row`);
  const a = _v(((snap.annual && snap.annual.annualRev) || [])[0]);
  const t = _v(snap.metrics && snap.metrics.revenueTTM);
  if (!(a > 0) || !(t > 0) || !(reportingFactor > 0)) return stale('annualRev[0]/revenueTTM missing');
  const r = a / t;
  if (!(Math.abs(Math.log(r / reportingFactor)) < Math.abs(Math.log(r)))) {
    return stale(`mismatch no longer visible (annualRev/revenueTTM=${r.toFixed(3)}, factor=${reportingFactor}) - re-verify row`);
  }
  delete meta._statementCcyHandTableStale;
  meta.statementCurrencyOriginal = row.statementCurrency;
  meta.statementFxRateApplied = 1;
  meta.statementCurrencySource = PROVENANCE;
  return { factor: 1, status: 'corrected' };
}

/**
 * True when a stored snapshot has a table row but was converted without the row (force a full pull).
 * @param {object} snap Stored snapshot.
 * @param {Object<string, object>} table Rows from loadStatementCurrencyTable().
 * @returns {boolean} Row exists and neither the provenance nor the stale stamp is present.
 */
function statementRowPending(snap, table) {
  const m = snap && snap.meta;
  if (!m || !table || !Object.prototype.hasOwnProperty.call(table, m.ticker)) return false;
  return m.statementCurrencySource !== PROVENANCE && !m._statementCcyHandTableStale;
}

module.exports = { loadStatementCurrencyTable, statementFactor, statementRowPending, PROVENANCE, TABLE_PATH };
