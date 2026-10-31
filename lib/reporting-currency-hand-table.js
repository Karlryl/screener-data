'use strict';
// Reporting-currency hand table (2026-10-30).
//
// Yahoo omits financialCurrency for PSQL. mapYahooToCanonical then falls back to the USD trading currency, so the
// euro statements are stored as dollars: amounts and ratios against the USD market cap are off, growth stays right.
// A proven row fills only the missing value; the ordinary conversion does the rest.
//
// A row proves one currency up to one period. Against a vendor currency, or for a period past the row's bound, nothing
// is proven: the amounts are withheld (Codex P316, 31.10.2026: Yahoo's USD label alone had released the wrong dollars).
const fs = require('fs');
const path = require('path');
const { holdStatementSeries } = require('./statement-currency-hand-table.js');

const TABLE_PATH = path.join(__dirname, '..', 'configs', 'reporting-currency-hand-table.json');
const PROVENANCE = 'hand-table:reporting-currency';
// Reporting-currency amounts outside the statement series, and the vendor ratios mixing them with the trading currency
// (CCY_DENOMINATED_METRICS and MISCH_VERHAELTNIS_METRIKEN in pull-yahoo.js). Ratios within one statement stay right.
const HELD_METRICS = ['revenueTTM', 'fcfTTM', 'ebitda', 'bookValuePerShare', 'cashPerShare', 'priceSales', 'enterpriseToRevenue', 'enterpriseToEbitda'];

const isDay = (x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)
  && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0, 10) === x;
const hasRow = (table, ticker) => Object.prototype.hasOwnProperty.call(table, ticker);
const hasAmount = (cell) => (typeof cell === 'number' ? Number.isFinite(cell)
  : !!cell && typeof cell === 'object' && Object.values('value' in cell ? { value: cell.value } : cell).some(Number.isFinite));

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
    for (const f of ['issuer', 'source', 'page', 'quote', 'verifiedAt', 'provenThroughSource']) {
      if (typeof r[f] !== 'string' || !r[f].trim()) bad(`${f} missing`);
    }
    if (!isDay(r.provenThrough)) bad('provenThrough must be the YYYY-MM-DD of the newest statement period the filing proves');
    rows[ticker] = r;
  }
  return rows;
}

/**
 * Reporting currency of a mapped snapshot: the vendor's value, or the row's where the vendor has none.
 * @param {string} ticker Ticker.
 * @param {string|null|undefined} vendorCurrency Yahoo financialCurrency, returned unchanged without a row.
 * @param {Object<string, object>} table Rows from loadReportingCurrencyTable().
 * @returns {{currency: (string|null|undefined), source?: string, conflict?: string}} Currency, plus the provenance of a fill or the text of a conflict (applyReportingRowHold withholds on it).
 */
function reportingCurrencyFill(ticker, vendorCurrency, table) {
  const row = hasRow(table, ticker) ? table[ticker] : null;
  if (!row) return { currency: vendorCurrency };
  if (!vendorCurrency) return { currency: row.statementCurrency, source: PROVENANCE };
  if (vendorCurrency === row.statementCurrency) return { currency: vendorCurrency };
  return { currency: vendorCurrency, conflict: `Yahoo financialCurrency ${vendorCurrency} != row ${row.statementCurrency} - re-verify row` };
}

/**
 * Newest period with an amount past the row's bound: a padding row without an amount cannot be mislabelled.
 * @param {object} snap Unconverted snapshot.
 * @param {string} bound Row's provenThrough.
 * @returns {string|null} Period end, or null when every amount lies within the bound.
 */
function periodPastBound(snap, bound) {
  let newest = null;
  for (const block of [snap.annual, snap.timeseries]) {
    for (const [key, ends] of Object.entries(block || {})) {
      if (!key.endsWith('Ends') || !Array.isArray(ends)) continue;
      const cells = block[key.slice(0, -'Ends'.length)];
      ends.forEach((end, i) => {
        if (typeof end === 'string' && end > bound && (!newest || end > newest) && hasAmount(cells?.[i])) newest = end;
      });
    }
  }
  return newest;
}

/**
 * Withholds every reporting-currency amount of an unconverted snapshot the row cannot vouch for, in place, before any
 * conversion: a vendor conflict stamped by the mapper, or a filled currency with a period past provenThrough. A currency
 * the vendor names itself needs no bound. Whole packet: a real currency change restates the comparison years too.
 * @param {object} snap Unconverted snapshot (mutated).
 * @param {Object<string, object>} table Rows from loadReportingCurrencyTable().
 * @returns {{reason: string, held: number}|null} Reason and withheld cells, or null when nothing is withheld.
 */
function applyReportingRowHold(snap, table) {
  const m = snap.meta;
  let reason = m._reportingCcyHandTableConflict || null;
  if (!reason && m.reportingCurrencySource === PROVENANCE && hasRow(table, m.ticker)) {
    const bound = table[m.ticker].provenThrough, past = periodPastBound(snap, bound);
    if (past) reason = `statement period ${past} after row bound ${bound} - re-verify row`;
  }
  if (!reason) return null;
  m._reportingCcyHandTableConflict = reason;
  for (const k of HELD_METRICS) if (snap.metrics && snap.metrics[k] != null) snap.metrics[k] = null;
  return { reason, held: holdStatementSeries(snap, undefined, reason) };
}

/**
 * True when a stored snapshot must be pulled in full: converted under another currency than its row (once), or held
 * (every run, one firm: the hold ends with the next answer that agrees or the next re-verified row, also a removed one).
 * @param {object} snap Stored snapshot.
 * @param {Object<string, object>} table Rows from loadReportingCurrencyTable().
 * @returns {boolean} Held, or a row exists and the stored currency differs.
 */
function reportingRowPending(snap, table) {
  const m = snap && snap.meta;
  if (!m) return false;
  if (m._reportingCcyHandTableConflict) return true;
  if (!hasRow(table, m.ticker)) return false;
  return (m.reportingCurrencyOriginal || m.reportingCurrency) !== table[m.ticker].statementCurrency;
}

module.exports = { loadReportingCurrencyTable, reportingCurrencyFill, applyReportingRowHold, reportingRowPending, PROVENANCE, TABLE_PATH };
