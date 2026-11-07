'use strict';
// SEC annual store corrections (07.11.2026, lane sd-hand-4 item 4). The SEC stores keep each fiscal year as first filed,
// so a year restated in a later filing can sit next to years on the new basis (Galiano Gold: 2024 operating income
// 43,607 thousand USD as filed in 2025, while 2025 and the restated 2024 of the 2025 statements are 36,543 and 20,486).
// A row replaces exactly one as-filed figure with the filed value of a numeric annual hand-table case (value and sources
// live there); any other figure in that cell is withheld, never kept and never replaced. The builders apply it before
// they write the store, so a monthly rebuild keeps the correction.
const config = require('../configs/sec-annual-corrections.json');
const { table } = require('./financial-known-cases.js');

const FIELDS = new Set(['annualOpInc', 'annualRev', 'annualNetIncome']);
const valueOf = r => (r && typeof r === 'object' ? r.value ?? null : r ?? null);
const listed = (c, t) => c.ticker === t || (c.listingAliases || []).includes(t);

/** Validate the correction rows against the hand table.
 * @param {object} cfg Parsed configs/sec-annual-corrections.json.
 * @returns {object[]} Rows joined with their hand-table case, or throws.
 */
function validate(cfg, hand = table) {
  if (cfg?.schemaVersion !== 1 || !Array.isArray(cfg.cases)) throw new Error('Invalid SEC annual corrections');
  const ids = new Set(), cells = new Set();
  return cfg.cases.map(c => {
    const h = hand.cases.find(x => x.caseId === c?.handCaseId);
    const cell = `${c?.ticker}|${c?.field}|${c?.fiscalYear}`;
    if (!c?.caseId || ids.has(c.caseId) || cells.has(cell) || !c.ticker || !FIELDS.has(c.field) || !Number.isInteger(c.fiscalYear) ||
        !Number.isFinite(c.expectedBadValue) || typeof c.reason !== 'string' || !c.reason.includes(`${c.fiscalYear}`) ||
        !h || !listed(h, c.ticker) || h.field !== c.field || h.periodType !== '12M' || h.currency !== 'USD' ||
        !Number.isFinite(h.replacementValue) || Number(h.period.slice(0, 4)) !== c.fiscalYear || h.replacementValue === c.expectedBadValue ||
        !h.sources.some(s => s.value === h.replacementValue && s.end === h.period)) {
      throw new Error('Invalid SEC annual correction: ' + (c?.caseId || cell));
    }
    ids.add(c.caseId); cells.add(cell);
    return { ...c, replacementValue: h.replacementValue, period: h.period };
  });
}
const ROWS = validate(config);

/** Apply the corrections of one ticker to one store entry without mutating it.
 * @param {string} ticker Store key.
 * @param {object} entry Store entry ({nfy, annualOpInc: [{value}], ...}).
 * @param {object[]} [rows] Validated rows (tests pass their own).
 * @returns {{entry: object, events: object[]}} Corrected entry (the same object when nothing applies) and audit events.
 */
function applySecAnnualCorrections(ticker, entry, rows = ROWS) {
  const events = [];
  let out = entry;
  for (const c of rows.filter(r => r.ticker === ticker)) {
    const series = entry?.[c.field], i = Number.isInteger(entry?.nfy) ? entry.nfy - c.fiscalYear : -1;
    if (!Array.isArray(series) || i < 0 || i >= series.length) { events.push({ ticker, caseId: c.caseId, status: 'stale', reasonCode: 'year-absent' }); continue; }
    const row = series[i], v = valueOf(row), mark = row?.secAnnualCorrection;
    if (mark?.caseId === c.caseId && (v === c.replacementValue || (v === null && mark.reasonCode === 'sec-value-changed'))) continue;
    const originalValue = mark?.caseId === c.caseId ? mark.originalValue : v;
    const next = originalValue === c.expectedBadValue
      ? { value: c.replacementValue, secAnnualCorrection: { caseId: c.caseId, originalValue, handCaseId: c.handCaseId } }
      : { value: null, secAnnualCorrection: { caseId: c.caseId, originalValue, reasonCode: 'sec-value-changed' } };
    if (out === entry) out = { ...entry };
    out[c.field] = (out[c.field] === series ? series.slice() : out[c.field]);
    out[c.field][i] = next;
    events.push({ ticker, caseId: c.caseId, status: next.value === null ? 'stale' : 'corrected', oldValue: originalValue, newValue: next.value });
  }
  return { entry: out, events };
}

/** Apply every row to a whole store object in place of its entries (the builders call this right before writing).
 * @param {object} store Ticker-keyed store.
 * @returns {object[]} Audit events.
 */
function applyToStore(store, rows = ROWS) {
  const events = [];
  for (const t of Object.keys(store)) {
    const r = applySecAnnualCorrections(t, store[t], rows);
    store[t] = r.entry; events.push(...r.events);
  }
  for (const e of events) console.log('[sec-annual-corrections] ' + JSON.stringify(e));
  return events;
}

module.exports = { applySecAnnualCorrections, applyToStore, validate, ROWS };
