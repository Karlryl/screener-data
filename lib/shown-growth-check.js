'use strict';
/**
 * lib/shown-growth-check.js — S11 Stufe 4 (22.11.2026): does the revenue growth the readers SHOW for a China A-share fit
 * the exchange revenues of the same two periods?
 *
 * WHY: the quality sample of 22.11. found Huatai Securities (601688.SS) with 4.38 % growth. Yahoo lacks the year-ago
 * quarter, so the figure falls back to fiscal 2025 against 2024 on Yahoo's revenue line; the exchange gives 6.83 %. The
 * exchange cross-check (lib/exchange-quarter-check.js) never looks at that fallback when no quarter pair is withheld.
 *
 * HOW: lib/exchange-quarter-check.js evaluate() decides whether the company is checkable at all (store age, banks and
 * insurers, currency, hand tables, vendor series, store entry) and its stratum. This file only reads the exchange values of
 * the two periods of the shown leg (lib/rev-growth-basis.js, G31 included) from the same store, with the same one-vintage
 * rule for derived single quarters, and compares the growth. That module is a registered GQS-00 dependency
 * (protocol/gqs-00/1.2.0-pending/transition.json), so nothing is added to it.
 * Mode-independent and pure: it changes nothing; scripts/write-filter-universe.js withholds the growth on 'mixed'.
 */
const X = require('./exchange-quarter-check.js');
const S = require('./exchange-quarter-store.js');
const { revGrowthLeg } = require('./rev-growth-basis.js');

/** The sample's tolerance: a growth within 2 percentage points OR 5 % of a reported one matches; only beyond both is it wrong. */
const SHOWN_GROWTH_PP = 2, SHOWN_GROWTH_REL = 0.05;
const finite = Number.isFinite;
const PREV_QUARTER_END = { '06-30': '03-31', '09-30': '06-30', '12-31': '09-30' };

/**
 * Exchange values of one company per line: full years and single quarters (null where the two year-to-date figures
 * behind a quarter were last read by different runs, as in evaluate()).
 * @param {object} store China store.
 * @param {string} ticker Ticker.
 * @param {string[]} lines Revenue lines of the stratum.
 * @returns {Object<string, {fy: Object<string, number|null>, quarter: Object<string, number|null>}>|null} null on a broken chain.
 */
function exchangeValues(store, ticker, lines) {
  const latest = {};
  for (const [period, list] of Object.entries(store.companies?.[ticker]?.ytd || {})) {
    if (Array.isArray(list) && list.length) latest[period] = list[list.length - 1];
  }
  const out = {};
  for (const line of lines) {
    const quarter = S.chinaSingleQuarters(latest, line);
    if (!quarter) return null;
    for (const p of Object.keys(quarter)) {
      const prev = PREV_QUARTER_END[p.slice(5)] && p.slice(0, 5) + PREV_QUARTER_END[p.slice(5)];
      if (prev && latest[prev] && S.lastConfirmedAt(store, ticker, p) !== S.lastConfirmedAt(store, ticker, prev)) quarter[p] = null;
    }
    const fy = Object.fromEntries(Object.entries(latest).filter(([p]) => p.endsWith('-12-31'))
      .map(([p, o]) => [p, finite(o[line]) ? o[line] : null]));
    out[line] = { fy, quarter };
  }
  return out;
}

/**
 * Compare the shown growth with the exchange growth of the same two periods.
 * @param {object} s Prepared snapshot (after the hand tables and the exchange step of its mode).
 * @param {object} [ctx] {stores, baseline}; default the process context of lib/exchange-quarter-check.js.
 * @returns {null|{status: 'mixed'|'agree'|'unchecked', why: (string|null), basis: string, periodEnd: (string|null),
 *   priorPeriodEnd: (string|null), shownPct: (number|null), exchangePct: number[]}} null outside the China cohort.
 *   A general company matches when either line (total or operate) gives the shown growth; a broker has the operate line.
 */
function shownGrowthCheck(s, ctx) {
  const t = s?.meta?.ticker;
  // ponytail: China only; Taiwan years come from Q4 seasons, a rule there only when a Taiwan case shows up.
  if (!/\.(SS|SZ)$/.test(t || '')) return null;
  ctx = ctx || X.defaultContext(); // loaded only for a China row
  const leg = revGrowthLeg(s);
  const out = { status: 'unchecked', why: null, basis: leg.basis, periodEnd: leg.sourcePeriodEnd ?? null,
    priorPeriodEnd: leg.sourcePriorPeriodEnd ?? null, shownPct: finite(leg.pct) ? leg.pct : null, exchangePct: [] };
  const gate = X.evaluate(s, ctx);
  if (!gate?.stratum) return Object.assign(out, { why: gate?.why || 'unchecked' });
  if (!['quarter', 'year', 'yearNewerRecord'].includes(leg.basis) || out.shownPct === null || !out.periodEnd || !out.priorPeriodEnd) {
    return Object.assign(out, { why: 'leg' });
  }
  const values = exchangeValues(ctx.stores.cn, t, gate.stratum === 'broker' ? ['operate'] : ['total', 'operate']);
  if (!values) return Object.assign(out, { why: 'fiscal-year-chain' });
  for (const line of Object.keys(values)) {
    const table = leg.basis === 'quarter' ? values[line].quarter : values[line].fy;
    const now = table[out.periodEnd], prior = table[out.priorPeriodEnd];
    if (finite(now) && finite(prior) && prior > 0) out.exchangePct.push((now / prior - 1) * 100);
  }
  if (!out.exchangePct.length) return Object.assign(out, { why: 'period-missing' });
  const near = e => Math.abs(out.shownPct - e) <= Math.max(SHOWN_GROWTH_PP, SHOWN_GROWTH_REL * Math.abs(e));
  out.status = out.exchangePct.some(near) ? 'agree' : 'mixed';
  return out;
}

module.exports = { shownGrowthCheck, SHOWN_GROWTH_PP, SHOWN_GROWTH_REL };
