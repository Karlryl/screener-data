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
    if (r.series !== undefined && r.series !== 'annual') bad('series must be annual or omitted (all statement series)');
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
 * financialCurrency (ccyAmbiguous) never switches the row on. Optional series: 'annual' restricts
 * the correction to annual.*; omitted means annual.* and timeseries.* as before.
 * @param {object} snap Canonical snapshot (mutated: meta stamps).
 * @param {string} origCurrency Reporting currency the converter uses (Yahoo financialCurrency).
 * @param {number} reportingFactor origCurrency -> USD factor.
 * @param {Object<string, object>} table Rows from loadStatementCurrencyTable().
 * Sweep 24.10.: when the check inputs are missing (financialCurrency, annualRev[0] or revenueTTM)
 * the row can be neither confirmed nor ruled out; the result then carries hold: true and the caller
 * withholds the statement series (holdStatementSeries) instead of applying the reporting factor,
 * which would divide proven USD statements by the local rate again (BRL ~5x, ARS ~1500x too small).
 * @returns {{factor: number, status: string, reason?: string, series?: string, hold?: boolean}} status 'no-row' | 'corrected' | 'stale'.
 */
function statementFactor(snap, origCurrency, reportingFactor, table) {
  const meta = (snap && snap.meta) || {};
  const row = table && Object.prototype.hasOwnProperty.call(table, meta.ticker) ? table[meta.ticker] : null;
  if (!row) return { factor: reportingFactor, status: 'no-row' };
  const stale = (reason, hold = false) => {
    meta._statementCcyHandTableStale = reason;
    const r = { factor: reportingFactor, status: 'stale', reason };
    return hold ? Object.assign(r, { hold: true }, row.series ? { series: row.series } : {}) : r;
  };
  if (meta.ccyAmbiguous === true) return stale('financialCurrency missing - row not applied', true);
  if (origCurrency !== row.yahooFinancialCurrency) return stale(`Yahoo financialCurrency ${origCurrency} != row ${row.yahooFinancialCurrency} - re-verify row`);
  const a = _v(((snap.annual && snap.annual.annualRev) || [])[0]);
  const t = _v(snap.metrics && snap.metrics.revenueTTM);
  if (!(a > 0) || !(t > 0) || !(reportingFactor > 0)) return stale('annualRev[0]/revenueTTM missing', true);
  const r = a / t;
  if (!(Math.abs(Math.log(r / reportingFactor)) < Math.abs(Math.log(r)))) {
    return stale(`mismatch no longer visible (annualRev/revenueTTM=${r.toFixed(3)}, factor=${reportingFactor}) - re-verify row`);
  }
  delete meta._statementCcyHandTableStale;
  meta.statementCurrencyOriginal = row.statementCurrency;
  meta.statementFxRateApplied = 1;
  meta.statementCurrencySource = PROVENANCE;
  if (row.series === 'annual') {
    meta.statementCurrencySeries = 'annual';
    return { factor: 1, status: 'corrected', series: 'annual' };
  }
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

const HOLD_REASON = 'Währungsfaktor der Handtabelle nicht bestätigt, Wert zurückgehalten';

/**
 * Withholds the statement series of an unverifiable row in place, before conversion (T2: value null
 * plus a financialMissing marker, never a replacement 0). Same key set the converter scales: every
 * annual.* series except annualShares, and timeseries.* unless series is 'annual' (those quarters keep
 * their reporting factor); *Ends stay. Cells without a finite amount (null, earlier holds) are kept.
 * @param {object} snap Unconverted snapshot (mutated).
 * @param {string} [series] Row scope from statementFactor ('annual' or undefined).
 * @returns {number} Number of withheld cells.
 */
function holdStatementSeries(snap, series) {
  const staleReason = (snap.meta && snap.meta._statementCcyHandTableStale) || null;
  let held = 0;
  for (const container of series === 'annual' ? ['annual'] : ['annual', 'timeseries']) {
    const bundle = snap[container];
    if (!bundle) continue;
    for (const key of Object.keys(bundle)) {
      if (key === 'annualShares' || key.endsWith('Ends') || !Array.isArray(bundle[key])) continue;
      const ends = Array.isArray(bundle[key + 'Ends']) ? bundle[key + 'Ends'] : [];
      bundle[key] = bundle[key].map((cell, i) => {
        const amounts = typeof cell === 'number' ? [cell]
          : cell && typeof cell === 'object' ? Object.values('value' in cell ? { value: cell.value } : cell) : [];
        if (!amounts.some(Number.isFinite)) return cell;
        held++;
        const period = typeof ends[i] === 'string' ? ends[i] : null;
        const financialMissing = { rule: 'statement-currency-unverified', period, staleReason, originalVendorRow: cell,
          reason: `${HOLD_REASON} (Periodenende ${period || 'unbekannt'})` };
        if (typeof cell === 'number') return { value: null, financialMissing };
        // A withheld cell must not keep an older correction marker (its reason would be shown).
        const { financialCorrection, ...rest } = cell;
        if ('value' in cell) return { ...rest, value: null, financialMissing };
        for (const k of Object.keys(rest)) if (typeof rest[k] === 'number') rest[k] = null;
        return { ...rest, financialMissing };
      });
    }
  }
  return held;
}

module.exports = { loadStatementCurrencyTable, statementFactor, statementRowPending, holdStatementSeries, HOLD_REASON, PROVENANCE, TABLE_PATH };
