'use strict';

// An arithmetic resemblance is evidence for research, never authority to edit a cell.
const table = require('../configs/yahoo-q4-known-cases.json');
const statementCurrencyTable = require('../configs/statement-currency-hand-table.json');
const { applyFinancialCases } = require('./financial-known-cases.js');
const { applyZeroGuard } = require('./zero-financials-guard.js');
const { applyExchangeCheck, defaultContext } = require('./exchange-quarter-check.js');
const FAILURE_CODE = 'YAHOO_Q4_HAND_TABLE_FAILED';
const FIELDS = { revenueQ: 'annualRev', opIncQ: 'annualOpInc', grossProfitQ: 'annualGP' };
const valueOf = row => typeof row === 'number' ? row : row && row.value;
const finite = Number.isFinite;
const array = value => Array.isArray(value) ? value : [];

/** Validate the explicit correction authority; malformed configuration fails loudly.
 * @param {object} config Hand-table document.
 * @returns {object} Validated document.
 */
function validateTable(config) {
  if (!config || config.schemaVersion !== 1 || !Array.isArray(config.cases) || !config.cases.length) {
    throw new Error('Invalid Yahoo Q4 hand table');
  }
  const keys = new Set();
  for (const c of config.cases) {
    if (!c.caseId || !c.issuerId || !Array.isArray(c.listingAliases) || !c.listingAliases.length ||
        !FIELDS[c.field] || !/^\d{4}-\d{2}-\d{2}$/.test(c.period) || c.period !== c.quarterEnd ||
        c.period !== c.fiscalYearEnd || c.periodType !== '3M' || c.unit !== 'currency' || c.multiplier !== 1 ||
        !/^[A-Z]{3}$/.test(c.nativeCurrency) || !finite(c.expectedBadValue) ||
        !(c.replacementNativeValue === null ? c.action === 'missing' && c.reason :
          c.action === 'replace' && finite(c.replacementNativeValue)) ||
        c.inputFingerprint?.annualField !== FIELDS[c.field] ||
        c.inputFingerprint?.annualPeriod !== c.period || c.inputFingerprint?.provider !== 'yahoo' ||
        !finite(c.inputFingerprint.annualNativeValue) || !c.sources?.some(s => s.url && s.date && s.dateType)) {
      throw new Error(`Invalid Yahoo Q4 case: ${c.caseId}`);
    }
    for (const alias of c.listingAliases) {
      if (Object.hasOwn(statementCurrencyTable, alias)) throw new Error(`Yahoo Q4 alias overlaps statement-currency table: ${alias}`);
      const key = `${alias}|${c.period}|${c.field}`;
      if (typeof alias !== 'string' || !alias || keys.has(key)) throw new Error(`Duplicate/invalid Yahoo Q4 key: ${key}`);
      keys.add(key);
    }
  }
  return config;
}
validateTable(table);

// Canonical statement series use full currency units. Legacy snapshots omit the unit label.
function validUnit(row, currency, periodType = '3M') {
  if (!row || typeof row !== 'object') return true;
  return (row.unit == null || row.unit === 'currency' || row.unit === currency) &&
    (row.currency == null || row.currency === currency) &&
    (row.currencyUnit == null || row.currencyUnit === currency) &&
    (row.multiplier == null || row.multiplier === 1) &&
    (row.periodType == null || row.periodType === periodType) &&
    (row.source == null || /^yahoo(?:$|[_:/ -])/i.test(row.source));
}

function envelope(snapshot) {
  const m = snapshot?.meta || {};
  if (m.fxConversionFailed || m.ccyAmbiguous || m.statementCurrencySource ||
      (m.source != null && !/^yahoo(?:$|[_:/ -])/i.test(m.source)) ||
      (m.financialUnit != null && m.financialUnit !== 'currency') ||
      (m.financialMultiplier != null && m.financialMultiplier !== 1)) return null;
  if (m.fxConverted === true) {
    if (m.reportingCurrency !== 'USD' || !finite(m.fxRateApplied) || m.fxRateApplied <= 0) return null;
    return { currency: m.reportingCurrencyOriginal, storedCurrency: 'USD', factor: m.fxRateApplied };
  }
  return { currency: m.reportingCurrency, storedCurrency: m.reportingCurrency, factor: 1 };
}

function annualMatches(snapshot, c, env) {
  const fp = c.inputFingerprint;
  const series = array(snapshot.annual?.[fp.annualField]);
  const ends = array(snapshot.annual?.[fp.annualField + 'Ends']);
  const dated = ends.indexOf(fp.annualPeriod);
  // Legacy FTS annuals are undated. A new FY must not retire a still-exact bad Q4.
  const matches = row => validUnit(row, env.storedCurrency, '12M') &&
    valueOf(row) === fp.annualNativeValue * env.factor;
  return dated >= 0 ? matches(series[dated]) : ends.every(end => end == null) && series.some(matches);
}

/** Report incomplete-subtraction candidates without editing input values.
 * @param {object} snapshot Canonical snapshot.
 * @param {Function} emit Observation receiver.
 * @returns {void}
 */
function observeIncompleteSubtractions(snapshot, emit) {
  for (const [field, annualField] of Object.entries(FIELDS)) {
    const series = array(snapshot?.timeseries?.[field]);
    const ends = array(snapshot?.timeseries?.[field + 'Ends']);
    if (!series.length || !ends.length) continue;
    const annual = array(snapshot?.annual?.[annualField]);
    const annualEnds = array(snapshot?.annual?.[annualField + 'Ends']);
    for (let ai = 0; ai < annual.length; ai++) {
      // Undated legacy annuals only produce a labelled observation, never a correction.
      const period = annualEnds[ai] || (ai === 0 ? ends.find(d => /-12-31$/.test(d)) : null);
      const qi = ends.indexOf(period), av = valueOf(annual[ai]), qv = valueOf(series[qi]);
      if (typeof period !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(period) ||
          qi < 0 || !finite(av) || !finite(qv) || qv === 0) continue;
      const end = new Date(period + 'T00:00:00Z');
      if (!finite(end.getTime()) || end.toISOString().slice(0, 10) !== period) continue;
      const operands = [9, 6, 3].map(months => {
        const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months + 1, 0));
        const p = d.toISOString().slice(0, 10);
        const v = valueOf(series[ends.indexOf(p)]);
        return { period: p, value: finite(v) ? v : null };
      });
      const present = operands.filter(o => o.value !== null);
      if (!present.length || present.length === 3) continue;
      const residual = av - present.reduce((s, o) => s + o.value, 0);
      // Tolerance accommodates floating point FX only; this detector has no write authority.
      if (Math.abs(qv - residual) <= Math.max(1, Math.abs(av)) * 1e-12) {
        emit({ status: 'observed', ticker: snapshot.meta?.ticker, field, period,
          annualValue: av, value: qv, operands, annualPeriodVerified: !!annualEnds[ai] });
      }
    }
  }
}

/** Pure, copy-on-write overlay. Native table values are scaled once with the recorded
 * factor for already normalized caches. No FX round-trip of unaffected cells or disk writes.
 * @param {object} snapshot Canonical native or normalized snapshot.
 * @param {object} options Optional test table and observation callback.
 * @returns {object} Snapshot, per-call counters and events.
 */
function applyKnownCases(snapshot, options = {}) {
  const config = options.table ? validateTable(options.table) : table;
  const stats = { observed: 0, corrected: 0, missing: 0, stale: 0, alreadyCorrected: 0 };
  const events = [];
  const emit = event => {
    stats[event.status]++;
    events.push(event);
    if (options.onEvent) options.onEvent(event);
  };
  let out = snapshot;
  const m = snapshot?.meta || {}, env = envelope(snapshot);
  const candidates = config.cases.filter(c => c.listingAliases.includes(m.ticker));
  observeIncompleteSubtractions(snapshot, event => {
    if (!candidates.some(c => c.field === event.field && c.period === event.period)) emit(event);
  });
  for (const c of candidates) {
    const series = array(snapshot.timeseries?.[c.field]);
    const ends = array(snapshot.timeseries?.[c.field + 'Ends']);
    const indexes = ends.map((end, i) => end === c.period ? i : -1).filter(i => i >= 0);
    if (!indexes.length) continue;
    const i = indexes[0], row = series[i], value = valueOf(row);
    const event = { ticker: m.ticker, caseId: c.caseId, period: c.period, field: c.field };
    if (!env || env.currency !== c.nativeCurrency || indexes.length !== 1 ||
        !validUnit(row, env.storedCurrency)) {
      emit({ ...event, status: 'stale', reason: 'context or unit changed' }); continue;
    }
    const replacement = c.replacementNativeValue === null ? null : c.replacementNativeValue * env.factor;
    if (value === replacement) {
      emit({ ...event, status: 'alreadyCorrected' }); continue;
    }
    if (value !== c.expectedBadValue * env.factor || !annualMatches(snapshot, c, env)) {
      emit({ ...event, status: 'stale', reason: 'vendor fingerprint changed', value }); continue;
    }
    if (out === snapshot) out = { ...snapshot, timeseries: { ...snapshot.timeseries } };
    if (out.timeseries[c.field] === series) out.timeseries[c.field] = series.slice();
    out.timeseries[c.field][i] = {
      ...(row && typeof row === 'object' ? row : {}), value: replacement,
      yahooQ4Correction: {
        caseId: c.caseId, evidenceRevision: c.evidenceRevision, nativeCurrency: c.nativeCurrency,
        originalVendorRow: row, originalVendorNativeValue: c.expectedBadValue,
        replacementNativeValue: c.replacementNativeValue, reason: c.reason,
        source: 'Yahoo canonical quarterly series', vendorAsOf: m.fundamentalsAsOf || m.fetchedAt || null,
        currencyAtCorrection: env.storedCurrency, fxFactorAtCorrection: env.factor,
        metricDefinition: c.metricDefinition, operands: c.operands, sources: c.sources
      }
    };
    emit({ ...event, status: c.replacementNativeValue === null ? 'missing' : 'corrected',
      oldValue: value, newValue: replacement });
  }
  return { snapshot: out, stats, events };
}

/** Emit a structured, non-secret diagnostic for a table decision.
 * @param {object} event Decision to log.
 * @returns {void}
 */
function logEvent(event) {
  if (event.status !== 'alreadyCorrected') console.warn(`[yahoo-q4-hand-table] ${JSON.stringify(event)}`);
}

const runtimeCounters = { observed: 0, corrected: 0, missing: 0, stale: 0, alreadyCorrected: 0 };
const financialRuntimeCounters = { corrected: 0, missing: 0, stale: 0, quarantined: 0, zeroObserved: 0, zeroMissing: 0 };
const zeroShadowSamples = [];
const exchangeCounters = {};
let exchangeWarned = false;
let summaryRegistered = false;
/** Production adapter retaining process counters while returning only the snapshot.
 * @param {object} snapshot Native or normalized canonical input.
 * @param {object} [options] atPull: true at pull time, where the exchange step is skipped entirely (its
 *   result is read-time only and never persisted).
 * @returns {object} Corrected copy or identical untouched input.
 */
function prepareSnapshot(snapshot, options = {}) {
  try {
    // Imports and missing-file probes are not snapshot-processing runs.
    if (!summaryRegistered && snapshot?.meta?.ticker) {
      summaryRegistered = true;
      process.once('exit', emitRuntimeSummary);
    }
    const result = applyKnownCases(snapshot, { onEvent: logEvent });
    for (const key of Object.keys(runtimeCounters)) runtimeCounters[key] += result.stats[key];
    const financial = applyFinancialCases(result.snapshot, { onEvent: event => {
      financialRuntimeCounters[event.status]++;
      console.warn(`[financial-hand-table] ${JSON.stringify(event)}`);
    } });
    const zero = applyZeroGuard(financial.snapshot);
    for (const event of zero.events) {
      financialRuntimeCounters[event.status === 'observed' ? 'zeroObserved' : 'zeroMissing']++;
      if (zeroShadowSamples.length < 20) zeroShadowSamples.push(event);
    }
    // Tag 1403: exchange cross-check, read time only (configs/exchange-quarter-policy.json; mode off = no-op).
    if (options.atPull) return zero.snapshot;
    const exchange = applyExchangeCheck(zero.snapshot);
    if (exchange.mode !== 'off') countExchange(exchange.result);
    return exchange.snapshot;
  } catch (cause) {
    // This is a programming/configuration failure, never a missing FX rate.
    const error = new Error('Yahoo Q4 hand table failed: ' + cause.message, { cause });
    error.code = FAILURE_CODE;
    throw error;
  }
}

function countExchange(result) {
  if (!exchangeWarned) {
    exchangeWarned = true;
    for (const w of defaultContext().warnings) console.error(`::warning::[exchange-check] ${w}`);
  }
  if (!result) return;
  const key = result.category + (result.why ? `(${result.why})` : '');
  exchangeCounters[key] = (exchangeCounters[key] || 0) + 1;
  if (result.fillPeriodVendorDisagrees) exchangeCounters['vendor-delivered-disagrees'] = (exchangeCounters['vendor-delivered-disagrees'] || 0) + 1;
}

/** Emit one process summary on stderr, preserving JSON stdout for read-only tools.
 * @returns {void}
 */
function emitRuntimeSummary() {
  // Observed matches recur daily (23 on real data); only stale rows need a human.
  const prefix = runtimeCounters.stale > 0 ? '::warning::' : '';
  console.error(`${prefix}[yahoo-q4-hand-table-summary] ${JSON.stringify(runtimeCounters)}`);
  if (Object.values(financialRuntimeCounters).some(n => n > 0)) {
    // Stale cells are withheld as missing; a human must verify the new vendor values.
    const financialPrefix = financialRuntimeCounters.stale > 0 ? '::warning::' : '';
    console.error(`${financialPrefix}[financial-hand-table-summary] ${JSON.stringify(financialRuntimeCounters)}`);
  }
  if (zeroShadowSamples.length) console.error(`[zero-financials-samples] ${JSON.stringify(zeroShadowSamples)}`);
  if (Object.keys(exchangeCounters).length) {
    const prefix = exchangeCounters['vendor-delivered-disagrees'] ? '::warning::' : '';
    console.error(`${prefix}[exchange-check-summary] ${JSON.stringify(exchangeCounters)}`);
  }
}

module.exports = { applyKnownCases, validateTable, observeIncompleteSubtractions, logEvent,
  prepareSnapshot, runtimeCounters, FAILURE_CODE, envelope, validUnit };
