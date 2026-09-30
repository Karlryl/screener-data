'use strict';

// Exact issuer/period/value authority, following the Q4 hand-table overlay.
// Ratio detectors never acquire permission to edit a cell.
const table = require('../configs/financial-known-cases.json');
const valueOf = row => typeof row === 'number' ? row : row?.value;
const allowed = new Set(['revenueQ', 'grossProfitQ']);
const date = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
// Machine-readable codes for cells that become missing; the text is what the reader sees.
const MISSING_REASONS = {
  'period-after-coverage': 'Quartalswert fehlt: neues Quartal nicht gegen Primärquelle geprüft; die Anbieterreihe dieser Firma hat eine falsche Basis.',
  'period-not-verified': 'Quartalswert fehlt: Periode nicht gegen Primärquelle geprüft; die Anbieterreihe dieser Firma hat eine falsche Basis.',
  'vendor-value-changed': 'Quartalswert fehlt: Anbieterwert weicht vom geprüften Stand ab; nicht gegen Primärquelle geprüft.',
  'context-changed': 'Quartalswert fehlt: Währung, Quelle, Periode oder Einheit weichen vom geprüften Stand ab; nicht gegen Primärquelle geprüft.',
};

/** Validate exact, source-backed correction authority.
 * @param {object} config Hand table.
 * @returns {object} Validated table, or throws.
 */
function validateTable(config) {
  if (config?.schemaVersion !== 1 || !Array.isArray(config.cases) || !Array.isArray(config.quarantines)) {
    throw new Error('Invalid financial hand table');
  }
  const keys = new Set();
  for (const c of config.cases) {
    const key = `${c.ticker}|${c.field}|${c.period}`;
    if (!c.caseId || !c.ticker || !allowed.has(c.field) || !date(c.period) || c.periodType !== '3M' ||
        !/^[A-Z]{3}$/.test(c.currency) || !Number.isFinite(c.expectedBadValue) ||
        !(c.replacementValue === null || Number.isFinite(c.replacementValue)) ||
        !c.reason || !c.sources?.length || c.sources.some(s => !/^https:\/\//.test(s.url) || !s.quote || !s.page) || keys.has(key)) {
      throw new Error('Invalid or duplicate financial case: ' + key);
    }
    keys.add(key);
  }
  // A series whose vendor basis is wrong is covered only through its last verified period.
  for (const v of config.coverage || []) {
    const last = config.cases.filter(c => c.ticker === v.ticker && c.field === v.field).map(c => c.period).sort().at(-1);
    if (!allowed.has(v.field) || !date(v.coversThrough) || v.coversThrough !== last) {
      throw new Error('Invalid financial coverage: ' + v.ticker + '|' + v.field);
    }
  }
  for (const q of config.quarantines) {
    if (!q.caseId || !q.ticker || !q.reason || !q.sources?.length || !q.fingerprint?.length ||
        q.fingerprint.some(a => !Array.isArray(a.path) || !a.path.length || a.expected === undefined)) {
      throw new Error('Invalid financial quarantine');
    }
  }
  return config;
}
validateTable(table);

function envelope(s) {
  const m = s?.meta;
  if (!m || m.fxConversionFailed || m.ccyAmbiguous || (m.source && !/^yahoo/i.test(m.source))) return null;
  if (m.fxConverted === true) {
    if (m.reportingCurrency !== 'USD' || !(m.fxRateApplied > 0) || !Number.isFinite(m.fxRateApplied)) return null;
    return { currency: m.reportingCurrencyOriginal, stored: 'USD', factor: m.fxRateApplied };
  }
  return { currency: m.reportingCurrency, stored: m.reportingCurrency, factor: 1 };
}

function matchesQuarantine(snapshot, q) {
  const annual = q.fingerprint.filter(a => a.path[0] === 'annual');
  const other = q.fingerprint.filter(a => a.path[0] !== 'annual');
  if (!other.every(a => a.path.reduce((v, k) => v?.[k], snapshot) === a.expected)) return false;
  if (!annual.length) return true;
  const rows = snapshot.annual?.[annual[0].path[1]];
  return Array.isArray(rows) && rows.some((_, i) => annual.every(a => {
    const field = a.path[1], end = snapshot.annual[field + 'Ends']?.[i];
    return valueOf(snapshot.annual[field]?.[i]) === a.expected && (!end || end === q.annualPairPeriod);
  }));
}

/** Apply only fingerprinted known cases without mutating input.
 * @param {object} snapshot Canonical Yahoo snapshot.
 * @param {object} options Optional validated table and event callback.
 * @returns {object} Snapshot and audit events.
 */
function applyFinancialCases(snapshot, options = {}) {
  const config = options.table ? validateTable(options.table) : table;
  const env = envelope(snapshot), ticker = snapshot?.meta?.ticker;
  const events = [];
  let out = snapshot;
  const emit = event => { events.push(event); if (options.onEvent) options.onEvent(event); };
  for (const q of config.quarantines.filter(q => q.ticker === ticker)) {
    // The three independent anchors identify this actual contaminated packet.
    // Merely being this ticker, or a large ratio, never quarantines another row.
    const matches = matchesQuarantine(snapshot, q);
    if (!matches) continue;
    if (out.meta.financialDataIssue?.caseId !== q.caseId) {
      out = { ...out, meta: { ...out.meta, financialDataIssue: {
        caseId: q.caseId, reason: q.reason, sources: q.sources,
      } } };
    }
    emit({ ticker, caseId: q.caseId, status: 'quarantined', reason: q.reason });
  }
  const write = (field, i, row) => {
    if (out === snapshot) out = { ...snapshot };
    if (out.timeseries === snapshot.timeseries) out.timeseries = { ...snapshot.timeseries };
    if (out.timeseries[field] === snapshot.timeseries[field]) out.timeseries[field] = snapshot.timeseries[field].slice();
    out.timeseries[field][i] = row;
  };
  // Unverified vendor cells become missing (never a fallback 0) and are counted as stale.
  const missing = (event, reasonCode) => {
    const row = snapshot.timeseries[event.field][event.index];
    if (row?.financialMissing?.reasonCode !== reasonCode) {
      write(event.field, event.index, { ...(row && typeof row === 'object' ? row : {}), value: null,
        financialMissing: { reasonCode, reason: MISSING_REASONS[reasonCode], caseId: event.caseId,
          period: event.period, originalVendorRow: row, revision: config.revision } });
    }
    emit({ ...event, status: 'stale', reasonCode, reason: MISSING_REASONS[reasonCode], oldValue: valueOf(row), newValue: null });
  };
  for (const v of (config.coverage || []).filter(v => v.ticker === ticker)) {
    const rows = snapshot.timeseries?.[v.field], ends = snapshot.timeseries?.[v.field + 'Ends'];
    if (!Array.isArray(rows) || !Array.isArray(ends)) continue;
    const verified = new Set(config.cases.filter(c => c.ticker === ticker && c.field === v.field).map(c => c.period));
    ends.forEach((p, i) => {
      if (verified.has(p) || (valueOf(rows[i]) == null && !rows[i]?.financialMissing)) return;
      const event = { ticker, caseId: `${ticker}-${v.field}-coverage`, container: 'timeseries', field: v.field, period: p ?? null, index: i };
      missing(event, date(p) && p > v.coversThrough ? 'period-after-coverage' : 'period-not-verified');
    });
  }
  for (const c of config.cases.filter(c => c.ticker === ticker)) {
    const rows = snapshot.timeseries?.[c.field], ends = snapshot.timeseries?.[c.field + 'Ends'];
    if (!Array.isArray(rows) || !Array.isArray(ends)) continue;
    const matches = ends.map((p, i) => p === c.period ? i : -1).filter(i => i >= 0);
    if (!matches.length) continue;
    const i = matches[0], row = rows[i], old = valueOf(row);
    const event = { ticker, caseId: c.caseId, container: 'timeseries', field: c.field, period: c.period, index: i };
    // Already withheld on an earlier pass (e.g. at pull time): keep it withheld and counted.
    if (row?.financialMissing?.caseId === c.caseId) { missing(event, row.financialMissing.reasonCode); continue; }
    const unitOk = !row || typeof row !== 'object' ||
      ((row.currency == null || row.currency === env?.stored) &&
       (row.currencyUnit == null || row.currencyUnit === env?.stored) &&
       (row.unit == null || row.unit === 'currency' || row.unit === env?.stored) &&
       (row.multiplier == null || row.multiplier === 1) && (row.periodType == null || row.periodType === '3M') &&
       (row.source == null || /^yahoo/i.test(row.source)));
    if (!env || env.currency !== c.currency || matches.length !== 1 || !unitOk) {
      for (const j of matches) missing({ ...event, index: j }, 'context-changed');
      continue;
    }
    const replacement = c.replacementValue === null ? null : c.replacementValue * env.factor;
    if (old === replacement) continue;
    if (old !== c.expectedBadValue * env.factor) { missing(event, 'vendor-value-changed'); continue; }
    write(c.field, i, { ...(row && typeof row === 'object' ? row : {}), value: replacement,
      financialCorrection: { caseId: c.caseId, originalVendorRow: row, originalNativeValue: c.expectedBadValue,
        replacementNativeValue: c.replacementValue, nativeCurrency: c.currency, reason: c.reason,
        sources: c.sources, revision: config.revision } });
    emit({ ...event, status: replacement === null ? 'missing' : 'corrected', oldValue: old, newValue: replacement });
  }
  return { snapshot: out, events };
}

/** Collect visible German explanations for corrected or missing financial data.
 * @param {object} snapshot Prepared snapshot.
 * @returns {string[]} Distinct explanations.
 */
function financialReasons(snapshot) {
  const reasons = [];
  if (snapshot?.meta?.financialDataIssue?.reason) reasons.push(snapshot.meta.financialDataIssue.reason);
  for (const bundle of [snapshot?.timeseries, snapshot?.annual]) for (const rows of Object.values(bundle || {})) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const reason = row?.financialCorrection?.reason || row?.financialMissing?.reason;
      if (reason && !reasons.includes(reason)) reasons.push(reason);
    }
  }
  return reasons;
}

module.exports = { applyFinancialCases, financialReasons, validateTable, table, MISSING_REASONS };
