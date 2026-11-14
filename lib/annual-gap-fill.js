'use strict';
/**
 * lib/annual-gap-fill.js: fill rule for an EMPTY newest annual revenue cell of a Chinese A-share from the
 * Eastmoney annual report rows in external-data/exchange-quarters/cn.json (package P288, G2).
 *
 * NOT WIRED. prepareSnapshot does not call this file, so no reader, board or export sees a fill. A cell fill is
 * not invisible: revYoYComponents, robustG and, without a quarterly pair, the growth axis and the rank read
 * annualRev[0] (measured with scripts/annual-gap-fill-report.js). Wiring it is a method decision with a full
 * before/after, not a data repair.
 *
 * The rule fills only when the source's prior year equals the vendor's prior year within the exchange check's
 * tolerance (0.1 %, statement currency, same revenue line as the vendor's newest quarter): that is the proof of a
 * shared base. It says nothing about a comparative restated inside the newer report.
 */
const { evaluate, policy } = require('./exchange-quarter-check.js');
const { envelope, validUnit } = require('./yahoo-q4-known-cases.js');
const { norm } = require('../src/scoring/snapshot.js');

const previousYearEnd = end => `${Number(end.slice(0, 4)) - 1}${end.slice(4)}`;
const isDecemberEnd = end => typeof end === 'string' && /^\d{4}-12-31$/.test(end);

/** Exactly one observation for a period; more than one is a restatement signal. The exchange check's fiscal-year
 * chain has already proven that a 12-31 row is the annual report. */
function annualObservation(company, period) {
  const list = company?.ytd?.[period];
  if (!Array.isArray(list) || !list.length) return { code: 'no-exchange-year' };
  return list.length > 1 ? { code: 'exchange-restated' } : { row: list[0] };
}

/** Both statement rows must say full year, statement currency and the cell's own period end. */
function periodsProven(s, ends, currency) {
  const rows = s.meta?.statementPeriods?.annualRev;
  return [0, 1].every(i => rows?.[i]?.end === ends[i] && rows[i].duration === '12M' && rows[i].currency === currency);
}

/**
 * What the rule would do with one prepared snapshot; changes nothing.
 * @param {object} s prepared snapshot
 * @param {object} ctx {stores: {cn}} as loadStores returns it
 * @param {object} [opt] {tolerance}
 * @returns {{ticker: string, refuse: string, detail?: object}|{ticker: string, fill: object}}
 */
function annualGapFill(s, ctx, opt = {}) {
  const ticker = s?.meta?.ticker;
  const refuse = (code, detail) => ({ ticker, refuse: code, ...(detail ? { detail } : {}) });
  const tolerance = opt.tolerance ?? policy.tolerance;
  const revenue = norm(s, 'annualRev'), ends = s?.annual?.annualRevEnds || [];
  if (revenue[0] !== null || !(revenue[1] > 0)) return refuse('no-gap');
  if (!/\.(SS|SZ)$/.test(ticker || '')) return refuse('not-china');
  if (s.meta.annualRevNewerYear) return refuse('newer-year-record');
  if (!isDecemberEnd(ends[0]) || ends[1] !== previousYearEnd(ends[0])) return refuse('period-ends');

  // The exchange check's own gates: store age, bank or insurer, envelope, currency, hand table, unit, stratum, line.
  const check = evaluate(s, ctx, { tolerance });
  if (check.why) return refuse(check.why);
  if (check.stratum !== 'general') return refuse('not-general');
  if (check.withhold.length) return refuse('quarter-mismatch', { periods: check.withhold.map(w => w.period) });

  const env = envelope(s);
  if (!env || !validUnit(s.annual.annualRev[1], env.storedCurrency, '12M')) return refuse('unit');
  if (!periodsProven(s, ends, env.currency)) return refuse('period-unproven');
  const company = ctx.stores.cn.companies[ticker];
  const newest = annualObservation(company, ends[0]);
  if (newest.code) return refuse(newest.code);
  const prior = annualObservation(company, ends[1]);
  if (prior.code) return refuse(prior.code);
  const native = newest.row[check.line], priorExchange = prior.row[check.line];
  if (!(native > 0) || !(priorExchange > 0)) return refuse('no-exchange-value');
  if (newest.row.noticeDate > String(s.meta.fetchedAt).slice(0, 10)) return refuse('notice-after-snapshot');

  const priorVendor = revenue[1] / env.factor;
  const deviation = Math.abs(priorVendor - priorExchange) / priorExchange;
  const evidence = { priorPeriod: ends[1], priorVendorNative: priorVendor, priorExchangeNative: priorExchange, priorDeviation: deviation, tolerance };
  if (deviation > tolerance) return refuse('prior-mismatch', evidence);
  return { ticker, fill: { period: ends[0], value: native * env.factor, nativeValue: native, nativeCurrency: env.currency,
    line: check.line, source: 'Eastmoney RPT_F10_FINANCE_GINCOME', noticeDate: newest.row.noticeDate, ...evidence } };
}

/**
 * Copy of the snapshot with the filled cell; the original is untouched. Used by the measurement only.
 * @param {object} s prepared snapshot
 * @param {object} fill fill object of annualGapFill
 * @returns {object} snapshot copy
 */
function applyAnnualGapFill(s, fill) {
  const rows = [...s.annual.annualRev];
  rows[0] = { ...(rows[0] && typeof rows[0] === 'object' ? rows[0] : {}), value: fill.value, annualGapFill: fill };
  return { ...s, annual: { ...s.annual, annualRev: rows } };
}

module.exports = { annualGapFill, applyAnnualGapFill };
