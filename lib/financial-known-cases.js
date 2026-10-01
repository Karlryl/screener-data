'use strict';

// Exact issuer/period/value authority, following the Q4 hand-table overlay.
// Ratio detectors never acquire permission to edit a cell.
const table = require('../configs/financial-known-cases.json');
const valueOf = row => typeof row === 'number' ? row : row?.value;
const allowed = new Set(['revenueQ', 'grossProfitQ']);
const date = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
// Other listings of the same issuer carry the identical vendor packet (verified per alias).
const listings = x => [x.ticker, ...(x.listingAliases || [])];
const listed = (x, ticker) => listings(x).includes(ticker);
// Machine-readable codes for cells that become missing; the text is what the reader sees.
const MISSING_REASONS = {
  'period-after-coverage': 'Quartalswert fehlt: neues Quartal nicht gegen Primärquelle geprüft; die Anbieterreihe dieser Firma hat eine falsche Basis.',
  'period-not-verified': 'Quartalswert fehlt: Periode nicht gegen Primärquelle geprüft; die Anbieterreihe dieser Firma hat eine falsche Basis.',
  'period-undated': 'Quartalswert fehlt: Wert ohne Periodendatum in einer Reihe mit belegten falschen Nullen; nicht gegen Primärquelle zuordenbar.',
  'vendor-value-changed': 'Quartalswert fehlt: Anbieterwert weicht vom geprüften Stand ab; nicht gegen Primärquelle geprüft.',
  'context-changed': 'Quartalswert fehlt: Währung, Quelle, Periode oder Einheit weichen vom geprüften Stand ab; nicht gegen Primärquelle geprüft.',
};

/** Validate exact, source-backed correction authority.
 * @param {object} config Hand table.
 * @returns {object} Validated table, or throws.
 */
function validateTable(config) {
  if (config?.schemaVersion !== 1 || !Array.isArray(config.cases) || !Array.isArray(config.quarantines) ||
      !Array.isArray(config.coverage)) {
    throw new Error('Invalid financial hand table');
  }
  const keys = new Set(), caseIds = new Set(), basisWrong = new Set(), covered = new Set(), single = new Set(), replaced = new Map();
  const primaries = new Set([...config.cases, ...config.coverage].map(x => x.ticker));
  const badAliases = x => x.listingAliases !== undefined && (!Array.isArray(x.listingAliases) ||
    x.listingAliases.some(a => typeof a !== 'string' || !a || primaries.has(a)));
  for (const c of config.cases) {
    const key = `${c.ticker}|${c.field}|${c.period}`;
    if (!c.caseId || !c.ticker || !allowed.has(c.field) || !date(c.period) || c.periodType !== '3M' ||
        !/^[A-Z]{3}$/.test(c.currency) || !Number.isFinite(c.expectedBadValue) ||
        !(c.replacementValue === null || Number.isFinite(c.replacementValue)) ||
        !(c.singleFalseValue === undefined || (c.singleFalseValue === true && c.replacementValue !== null)) ||
        !c.reason || !c.sources?.length || c.sources.some(s => !/^https:\/\//.test(s.url) || !s.quote || !s.page) ||
        listings(c).some(t => keys.has(`${t}|${c.field}|${c.period}`)) || caseIds.has(c.caseId)) {
      throw new Error('Invalid or duplicate financial case: ' + key);
    }
    // An alias that is also another case's primary ticker would silently merge two issuers.
    if (badAliases(c)) throw new Error('Invalid financial listing alias: ' + key);
    for (const t of listings(c)) keys.add(`${t}|${c.field}|${c.period}`);
    caseIds.add(c.caseId);
    // A replaced value means the vendor basis is wrong (coverage required); a null replacement withholds
    // one false value. singleFalseValue marks the only replaced cell of a series whose other checked
    // periods agree with the issuer, so the series needs no coverage.
    if (c.replacementValue !== null) for (const t of listings(c)) {
      const series = `${t}|${c.field}`;
      replaced.set(series, (replaced.get(series) || 0) + 1);
      (c.singleFalseValue ? single : basisWrong).add(series);
    }
  }
  for (const key of single) if (replaced.get(key) !== 1) throw new Error('Invalid single false value (other replacements in series): ' + key);
  // A series whose vendor basis is wrong is covered only through its last verified period.
  for (const v of config.coverage) {
    const last = config.cases.filter(c => c.ticker === v.ticker && c.field === v.field).map(c => c.period).sort().at(-1);
    const key = `${v.ticker}|${v.field}`;
    if (!allowed.has(v.field) || !date(v.coversThrough) || v.coversThrough !== last || covered.has(key) || badAliases(v)) {
      throw new Error('Invalid financial coverage (bad or duplicate): ' + key);
    }
    for (const t of listings(v)) covered.add(`${t}|${v.field}`);
  }
  for (const key of basisWrong) if (!covered.has(key)) throw new Error('Missing financial coverage: ' + key);
  for (const q of config.quarantines) {
    if (!q.caseId || !q.ticker || !q.reason || !q.sources?.length || !q.fingerprint?.length ||
        q.fingerprint.some(a => !Array.isArray(a.path) || !a.path.length || a.expected === undefined)) {
      throw new Error('Invalid financial quarantine');
    }
  }
  return config;
}
validateTable(table);

// ccyAmbiguous means the vendor omitted financialCurrency and the pull fell back to the trading
// currency. Resolved only for a company the vendor places in the United States whose listing trades
// in USD on a US exchange (not proof of USD statements); a case then applies only with its own
// verified currency USD and only in a covered series (case loop). Anything else stays withheld.
const usdListing = m => m.tradingCurrency === 'USD' && m.tradingCurrencyAssumed === false && m._ccyMissingCompletely !== true &&
  m.country === 'United States' &&
  /^(NYSE|NYSE American|NYSEArca|NasdaqGS|NasdaqGM|NasdaqCM|Cboe US)$/.test(m.exchangeName || '');

function envelope(s) {
  const m = s?.meta;
  if (!m || m.fxConversionFailed || (m.ccyAmbiguous && !usdListing(m)) || (m.source && !/^yahoo/i.test(m.source))) return null;
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
    // A drifted fingerprint never releases the hold silently: it stays until a human re-verifies.
    if (out.meta.financialDataIssue?.caseId !== q.caseId) {
      out = { ...out, meta: { ...out.meta, financialDataIssue: {
        caseId: q.caseId, reason: q.reason, sources: q.sources,
      } } };
    }
    emit({ ticker, caseId: q.caseId, status: 'quarantined', reason: q.reason });
    if (!matches) emit({ ticker, caseId: q.caseId, status: 'stale', reasonCode: 'quarantine-fingerprint-changed',
      reason: 'Datenpaket weicht vom geprüften Fingerabdruck ab; Sperre bleibt bis zur erneuten Prüfung.' });
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
      // A withheld cell must not keep an older correction marker (its reason would be shown).
      const { financialCorrection, ...rest } = row && typeof row === 'object' ? row : {};
      write(event.field, event.index, { ...rest, value: null,
        financialMissing: { reasonCode, reason: MISSING_REASONS[reasonCode], caseId: event.caseId,
          period: event.period, originalVendorRow: row, revision: config.revision } });
    }
    emit({ ...event, status: 'stale', reasonCode, reason: MISSING_REASONS[reasonCode], oldValue: valueOf(row), newValue: null });
  };
  // Every series with hand-table authority: a value without a usable period end (missing or
  // short *Ends array, undated entry) is withheld; covered series also withhold unverified periods.
  const fields = new Set([...config.coverage, ...config.cases].filter(x => listed(x, ticker)).map(x => x.field));
  for (const field of fields) {
    const rows = snapshot.timeseries?.[field], ends = snapshot.timeseries?.[field + 'Ends'];
    if (!Array.isArray(rows)) continue;
    const v = config.coverage.find(v => listed(v, ticker) && v.field === field);
    const verified = new Set(config.cases.filter(c => listed(c, ticker) && c.field === field).map(c => c.period));
    rows.forEach((row, i) => {
      const p = Array.isArray(ends) ? ends[i] : undefined;
      if ((v ? verified.has(p) : date(p)) || (valueOf(row) == null && !row?.financialMissing)) return;
      const event = { ticker, caseId: `${ticker}-${field}-${v ? 'coverage' : 'period'}`, container: 'timeseries', field, period: p ?? null, index: i };
      missing(event, !v ? 'period-undated' : date(p) && p > v.coversThrough ? 'period-after-coverage' : 'period-not-verified');
    });
  }
  for (const c of config.cases.filter(c => listed(c, ticker))) {
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
    // An ambiguous-currency packet takes cases only in a covered series: every shown quarter is then an issuer value.
    const ambiguousUncovered = snapshot.meta?.ccyAmbiguous && !config.coverage.some(v => listed(v, ticker) && v.field === c.field);
    if (!env || ambiguousUncovered || env.currency !== c.currency || matches.length !== 1 || !unitOk) {
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
      const reason = row?.financialMissing?.reason || row?.financialCorrection?.reason;
      if (reason && !reasons.includes(reason)) reasons.push(reason);
    }
  }
  return reasons;
}

module.exports = { applyFinancialCases, financialReasons, validateTable, table, MISSING_REASONS };
