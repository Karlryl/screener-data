'use strict';

// Exact issuer/period/value authority, following the Q4 hand-table overlay.
// Ratio detectors never acquire permission to edit a cell.
const table = require('../configs/financial-known-cases.json');
const valueOf = row => typeof row === 'number' ? row : row?.value;
const allowed = new Set(['revenueQ', 'grossProfitQ', 'opIncQ']);
// Annual cells can only be withheld (never replaced, never covered): one false vendor year becomes missing.
const annual = new Set(['annualRev', 'annualGP']);
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
  'annual-value-changed': 'Jahreswerte fehlen: Die Jahresreihe des Anbieters weicht vom geprüften Stand ab (neues Jahr, Neuausweis, Umsortierung oder Währung); nicht gegen Primärquelle geprüft.',
};

// a's period contains b's (same start or same end) and is longer; sources without both periods are not compared.
const contains = (a, b) => !(a.start && a.end && b.start && b.end) ||
  (a.start <= b.start && a.end >= b.end && (a.start === b.start || a.end === b.end) && a.start + a.end !== b.start + b.end);
// A replacement traces to its own sources: one source value, a non-zero difference of two (longer period minus the
// shorter one it contains, e.g. year minus nine months), or an issuer-rounded source within its explicit roundingStep.
// Cases without a numeric source value are exempt (legacy entries). The traced period must end within a week of the
// case's period (52/53-week quarters end a few days off the calendar quarter); a source without an end is not checked.
const DAY = 864e5;
const near = (end, c) => !end || Math.abs(Date.parse(end) - Date.parse(c.period)) <= 7 * DAY;
// Same start: the difference ends where the longer period ends; same end: the day before the shorter one starts.
const diffEnd = (a, b) => a.start === b.start ? a.end : b.start && new Date(Date.parse(b.start) - DAY).toISOString().slice(0, 10);
const traceable = c => {
  const src = c.sources.filter(s => Number.isFinite(s.value)), r = c.replacementValue;
  return r === null || !src.length || src.some(s => s.value === r && near(s.end, c)) ||
    (r !== 0 && src.some(a => src.some(b => contains(a, b) && a.value - b.value === r && near(diffEnd(a, b), c)))) ||
    src.some(s => near(s.end, c) && Number.isFinite(s.roundingStep) && s.roundingStep > 0 && s.value % s.roundingStep === 0 &&
      Math.abs(r - s.value) <= s.roundingStep / 2);
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
  const keys = new Set(), caseIds = new Set(), basisWrong = new Set(), covered = new Set();
  const primaries = new Set([...config.cases, ...config.coverage].map(x => x.ticker));
  const badAliases = x => x.listingAliases !== undefined && (!Array.isArray(x.listingAliases) ||
    x.listingAliases.some(a => typeof a !== 'string' || !a || primaries.has(a)));
  for (const c of config.cases) {
    const key = `${c.ticker}|${c.field}|${c.period}`;
    if (!c.caseId || !c.ticker || !(allowed.has(c.field) || annual.has(c.field)) || !date(c.period) ||
        c.periodType !== (annual.has(c.field) ? '12M' : '3M') ||
        !/^[A-Z]{3}$/.test(c.currency) || !Number.isFinite(c.expectedBadValue) ||
        !(c.replacementValue === null || Number.isFinite(c.replacementValue)) ||
        !c.reason || !c.sources?.length || c.sources.some(s => !/^https:\/\//.test(s.url) || !s.quote || !s.page) ||
        listings(c).some(t => keys.has(`${t}|${c.field}|${c.period}`)) || caseIds.has(c.caseId)) {
      throw new Error('Invalid or duplicate financial case: ' + key);
    }
    // An alias that is also another case's primary ticker would silently merge two issuers.
    if (badAliases(c)) throw new Error('Invalid financial listing alias: ' + key);
    // index = position in an undated vendor series (newest first); it is used only when the series has no dates.
    if (annual.has(c.field) && (c.replacementValue !== null || !Number.isInteger(c.index) || c.index < 0)) {
      throw new Error('Invalid annual cell (withhold only, needs index): ' + key);
    }
    // A confirmed cell must say so: a vendor value copied into replacementValue under a "korrigiert" reason is an entry error.
    if ((c.expectedBadValue === c.replacementValue) !== /bestätigt:/.test(c.reason)) throw new Error('Invalid confirmed cell (value and reason disagree): ' + key);
    if (!traceable(c)) throw new Error('Replacement matches no source value: ' + key);
    for (const t of listings(c)) keys.add(`${t}|${c.field}|${c.period}`);
    caseIds.add(c.caseId);
    // A non-null value (replaced, or confirmed with expectedBadValue === replacementValue) gives the table
    // authority over the whole series, so it needs coverage; a null replacement withholds one false value.
    if (c.replacementValue !== null) for (const t of listings(c)) basisWrong.add(`${t}|${c.field}`);
  }
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
  // Label authority is deliberately separate: it never grants value/coverage authority.
  if (config.periodLabels !== undefined && !Array.isArray(config.periodLabels)) throw new Error('Invalid period labels');
  const labelKeys = new Set(), labelIds = new Set(caseIds);
  const labelPrimaries = new Set([...primaries, ...(config.periodLabels || []).map(c => c?.ticker)]);
  const isoDay = d => date(d) && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;
  for (const c of config.periodLabels || []) {
    const text = x => typeof x === 'string' && x.trim().length > 0;
    const key = `${c?.ticker}|${c?.field}|${c?.period}`;
    if (!c || !text(c.caseId) || !text(c.ticker) || c.field !== 'revenueQ' || c.periodType !== '3M' ||
        !isoDay(c.period) || !isoDay(c.reportedPeriodEnd) || !near(c.reportedPeriodEnd, c) ||
        !/^[A-Z]{3}$/.test(c.currency) || !Number.isFinite(c.verifiedValue) || c.verifiedValue < 0 || !text(c.reason) ||
        !Array.isArray(c.sources) || !c.sources.length || c.sources.some(s => !s ||
          !/^https:\/\/[^/\s]+\/\S+$/.test(s.url) || !text(s.page) || !text(s.quote) ||
          (s.value !== undefined && !Number.isFinite(s.value)) || (s.end !== undefined && !isoDay(s.end)) ||
          (s.start !== undefined && (!isoDay(s.start) || !isoDay(s.end) || s.start >= s.end))) ||
        (c.listingAliases !== undefined && (!Array.isArray(c.listingAliases) ||
          c.listingAliases.some(a => !text(a) || labelPrimaries.has(a)) || new Set(c.listingAliases).size !== c.listingAliases.length)) ||
        Object.keys(c).some(k => !['caseId', 'ticker', 'listingAliases', 'field', 'periodType', 'period',
          'reportedPeriodEnd', 'currency', 'verifiedValue', 'reason', 'sources'].includes(k)) || labelIds.has(c.caseId)) {
      throw new Error('Invalid period label: ' + key);
    }
    if (listings(c).some(t => labelKeys.has(`${t}|${c.field}|${c.period}`))) throw new Error('Duplicate period label: ' + key);
    // A source value can be the quarter itself or an explicitly documented year-minus-nine-months pair.
    const src = c.sources;
    if (!src.some(s => s.value === c.verifiedValue && s.end === c.reportedPeriodEnd) &&
        !src.some(a => src.some(b => isoDay(a.start) && a.start === b.start && isoDay(b.end) &&
          a.end === c.reportedPeriodEnd && b.end < a.end && Number.isFinite(a.value) && Number.isFinite(b.value) &&
          a.value - b.value === c.verifiedValue))) throw new Error('Period label matches no source value: ' + key);
    if (config.cases.some(v => v.field === c.field && v.period === c.period && listings(c).some(t => listed(v, t)) &&
        (v.currency !== c.currency || v.replacementValue !== c.verifiedValue))) throw new Error('Contradictory period label: ' + key);
    for (const t of listings(c)) labelKeys.add(`${t}|${c.field}|${c.period}`);
    labelIds.add(c.caseId);
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
  const write = (field, i, row, container = 'timeseries') => {
    if (out === snapshot) out = { ...snapshot };
    if (out[container] === snapshot[container]) out[container] = { ...snapshot[container] };
    if (out[container][field] === snapshot[container][field]) out[container][field] = snapshot[container][field].slice();
    out[container][field][i] = row;
  };
  // Unverified vendor cells become missing (never a fallback 0) and are counted as stale.
  const missing = (event, reasonCode, reason = MISSING_REASONS[reasonCode], status = 'stale', vendorRow) => {
    const stored = snapshot[event.container][event.field][event.index];
    const row = vendorRow === undefined ? stored : vendorRow;
    if (stored?.financialMissing?.reasonCode !== reasonCode ||
        (vendorRow !== undefined && stored?.financialMissing?.revision !== config.revision)) {
      // A withheld cell must not keep an older correction marker (its reason would be shown).
      const { financialCorrection, ...rest } = row && typeof row === 'object' ? row : {};
      write(event.field, event.index, { ...rest, value: null,
        financialMissing: { reasonCode, reason, caseId: event.caseId,
          period: event.period, originalVendorRow: row, revision: config.revision } }, event.container);
    }
    emit({ ...event, status, reasonCode, reason, oldValue: valueOf(row), newValue: null });
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
  // Annual cells: a dated series is matched by fiscal-year end, an undated one by position plus the exact
  // vendor value. Fail closed per series (ticker + field): if any case no longer matches (new year in front,
  // restatement, reordering, other currency, no usable envelope), every present cell of the series is withheld.
  for (const field of annual) {
    // A ticker without annual cases never reads its annual block.
    const own = config.cases.filter(c => c.field === field && listed(c, ticker));
    if (!own.length) continue;
    const rows = snapshot.annual?.[field], ends = snapshot.annual?.[field + 'Ends'];
    if (!Array.isArray(rows)) continue;
    const dated = Array.isArray(ends) && ends.some(date);
    if (dated && (ends.length !== rows.length || rows.some((_, i) => !date(ends[i])))) {
      rows.forEach((row, i) => {
        if (valueOf(row) != null || row?.financialMissing) missing({ ticker, caseId: own[0].caseId,
          container: 'annual', field, period: date(ends[i]) ? ends[i] : null, index: i }, 'annual-value-changed');
      });
      continue;
    }
    const placed = own.map(c => ({ c, i: dated ? ends.indexOf(c.period) : c.index })).filter(({ i }) => i >= 0);
    // No such year, a vendor gap, or already withheld on an earlier pass (e.g. at pull time) is not a hit.
    const hits = placed.filter(({ i }) => valueOf(rows[i]) != null);
    const event = (c, i) => ({ ticker, caseId: c.caseId, container: 'annual', field, period: dated ? ends[i] ?? null : null, index: i });
    const drift = hits.find(({ c, i }) => !env || env.currency !== c.currency || valueOf(rows[i]) !== c.expectedBadValue * env.factor);
    const heldOpen = rows.find(r => r?.financialMissing?.reasonCode === 'annual-value-changed');
    if (drift || heldOpen) {
      const c = drift ? drift.c : { caseId: heldOpen.financialMissing.caseId };
      rows.forEach((row, i) => { if (valueOf(row) != null || row?.financialMissing) missing(event(c, i), 'annual-value-changed'); });
      continue;
    }
    for (const { c, i } of hits) {
      const row = rows[i];
      write(field, i, { ...(row && typeof row === 'object' ? row : {}), value: null,
        financialCorrection: { caseId: c.caseId, originalVendorRow: row, originalNativeValue: c.expectedBadValue,
          replacementNativeValue: null, nativeCurrency: c.currency, reason: c.reason, sources: c.sources,
          revision: config.revision } }, 'annual');
      emit({ ...event(c, i), period: c.period, status: 'missing', oldValue: valueOf(row), newValue: null });
    }
    // No gaps: every present cell older than the newest withheld year is withheld too, so a reader that skips
    // gaps never pairs non-adjacent years or shows an older year as the current one.
    const newest = placed.filter(({ c, i }) => valueOf(rows[i]) != null || rows[i]?.financialCorrection?.caseId === c.caseId)
      .sort((a, b) => a.i - b.i)[0];
    if (newest) rows.forEach((row, j) => {
      if (j > newest.i && !placed.some(p => p.i === j) && (valueOf(row) != null || row?.financialMissing)) {
        missing(event(newest.c, j), 'annual-older-than-withheld', newest.c.reason, 'missing');
      }
    });
  }
  const oldOtfHold = 'otf-vendor-annual-revenue-20261001';
  const otfAnnual = ticker === 'OTF' && out.meta.financialDataIssue?.caseId === oldOtfHold ? out?.annual?.annualRev : null;
  if (ticker === 'OTF' && out.meta.financialDataIssue?.caseId === oldOtfHold &&
      !config.quarantines.some(q => q.ticker === ticker) && Array.isArray(otfAnnual) && otfAnnual.length &&
      otfAnnual.every(row => valueOf(row) == null) &&
      otfAnnual.some(row => config.cases.some(c => c.ticker === ticker && c.field === 'annualRev' &&
        (row?.financialCorrection?.caseId === c.caseId || row?.financialMissing?.caseId === c.caseId)))) {
    const { financialDataIssue, ...meta } = out.meta;
    out = { ...out, meta };
    emit({ ticker, caseId: oldOtfHold, status: 'corrected', reasonCode: 'quarantine-superseded' });
  }
  for (const c of config.cases.filter(c => allowed.has(c.field) && listed(c, ticker))) {
    const rows = snapshot.timeseries?.[c.field], ends = snapshot.timeseries?.[c.field + 'Ends'];
    if (!Array.isArray(rows) || !Array.isArray(ends)) continue;
    const matches = ends.map((p, i) => p === c.period ? i : -1).filter(i => i >= 0);
    if (!matches.length) continue;
    const i = matches[0], stored = rows[i];
    let row = stored;
    const event = { ticker, caseId: c.caseId, container: 'timeseries', field: c.field, period: c.period, index: i };
    const holdIds = [c.caseId, `${ticker}-${c.field}-coverage`, `${ticker}-${c.field}-period`];
    if (holdIds.includes(row?.financialMissing?.caseId)) {
      const held = row.financialMissing;
      if (held.revision === config.revision || !Object.hasOwn(held, 'originalVendorRow')) {
        missing(event, held.reasonCode); continue;
      }
      // Older failed checks may have nested the retained row; correction audit evidence stays intact.
      while (holdIds.includes(row?.financialMissing?.caseId) && Object.hasOwn(row.financialMissing, 'originalVendorRow')) {
        row = row.financialMissing.originalVendorRow;
      }
    }
    const old = valueOf(row);
    const unitOk = !row || typeof row !== 'object' ||
      ((row.currency == null || row.currency === env?.stored) &&
       (row.currencyUnit == null || row.currencyUnit === env?.stored) &&
       (row.unit == null || row.unit === 'currency' || row.unit === env?.stored) &&
       (row.multiplier == null || row.multiplier === 1) && (row.periodType == null || row.periodType === '3M') &&
       (row.source == null || /^yahoo/i.test(row.source)));
    // An ambiguous-currency packet takes cases only in a covered series: every shown quarter is then an issuer value.
    const ambiguousUncovered = snapshot.meta?.ccyAmbiguous && !config.coverage.some(v => listed(v, ticker) && v.field === c.field);
    if (!env || ambiguousUncovered || env.currency !== c.currency || matches.length !== 1 || !unitOk) {
      for (const j of matches) missing({ ...event, index: j }, 'context-changed', undefined, undefined, j === i ? row : rows[j]);
      continue;
    }
    const replacement = c.replacementValue === null ? null : c.replacementValue * env.factor;
    // Already the issuer value: a confirmed cell (expectedBadValue === replacementValue) or an earlier pass.
    if (old === replacement && row !== stored) {
      write(c.field, i, row);
      emit({ ...event, status: replacement === null ? 'missing' : 'corrected', oldValue: valueOf(stored), newValue: replacement });
    }
    if (old === replacement) continue;
    if (old !== c.expectedBadValue * env.factor) { missing(event, 'vendor-value-changed', undefined, undefined, row); continue; }
    write(c.field, i, { ...(row && typeof row === 'object' ? row : {}), value: replacement,
      financialCorrection: { caseId: c.caseId, originalVendorRow: row, originalNativeValue: c.expectedBadValue,
        replacementNativeValue: c.replacementValue, nativeCurrency: c.currency, reason: c.reason,
        sources: c.sources, revision: config.revision } });
    emit({ ...event, status: replacement === null ? 'missing' : 'corrected', oldValue: old, newValue: replacement });
  }
  // Rebuild annotations from the exact current fingerprint, never from an earlier annotation.
  // No values, dates, correction events, missing reasons or coverage rules are changed here.
  const rows = out?.timeseries?.revenueQ, ends = out?.timeseries?.revenueQEnds;
  const labels = config.periodLabels?.filter(c => listed(c, ticker)) || [];
  const reported = Array.isArray(rows) && Array.isArray(ends) && rows.length === ends.length
    ? ends.map((p, i) => {
      const row = rows[i];
      if (!env || env.factor !== 1 || env.currency !== env.stored || snapshot.meta?.ccyAmbiguous ||
          ends.indexOf(p) !== ends.lastIndexOf(p) || (row && typeof row === 'object' &&
            ((row.currency != null && row.currency !== env.stored) || (row.currencyUnit != null && row.currencyUnit !== env.stored) ||
             (row.unit != null && row.unit !== 'currency' && row.unit !== env.stored) ||
             (row.multiplier != null && row.multiplier !== 1) || (row.periodType != null && row.periodType !== '3M') ||
             (row.source != null && !/^yahoo/i.test(row.source))))) return null;
      return labels.find(c => c.period === p && c.currency === env.currency && c.verifiedValue === valueOf(row))?.reportedPeriodEnd ?? null;
    }) : [];
  if (reported.some(Boolean)) out = { ...out, timeseries: { ...out.timeseries, reportedRevenueQEnds: reported } };
  else if (out?.timeseries && Object.hasOwn(out.timeseries, 'reportedRevenueQEnds')) {
    const { reportedRevenueQEnds, ...timeseries } = out.timeseries;
    out = { ...out, timeseries };
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
      const reason = row?.financialMissing?.reason || row?.financialCorrection?.reason || row?.exchangeFill?.reason;
      if (reason && !reasons.includes(reason)) reasons.push(reason);
    }
  }
  return reasons;
}

module.exports = { applyFinancialCases, financialReasons, validateTable, table, MISSING_REASONS };
