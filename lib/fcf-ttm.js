'use strict';
/**
 * lib/fcf-ttm.js — ONE definition of the FCF margin for every board (18.11.2026).
 *
 * FCF margin TTM = (operating cash flow - capital expenditure) / revenue, all three over the
 * same trailing twelve months, labelled with the period end (G31).
 *
 * Source order (Karl 18.11.: SEC first wherever the company files with the SEC):
 *   1. 'sec-ttm'        SEC companyfacts (10-K/10-Q, amendments win), TTM = last fiscal year +
 *                       current YTD - prior-year YTD, or the fiscal year itself when it ends last.
 *   2. 'yahoo-fts-ttm'  Yahoo fundamentals-timeseries trailing row (trailingOperatingCashFlow,
 *                       trailingCapitalExpenditure, trailingTotalRevenue of one TTM date), only
 *                       where SEC has no TTM for the company (foreign filers, IFRS, no CIK).
 *   3. none             the margin stays empty with a reason; never a substitute number (T2).
 * A source with a strictly newer period end wins over an older one (G31), so a stale store
 * never hides a newer filing.
 *
 * Replaced: Yahoo financialData.freeCashflow / totalRevenue (pull-yahoo.js). That field is not
 * OCF minus capex (MU 18.11.: 29.1 bn vs OCF 89.7 bn - capex 30.7 bn = 59.0 bn); it stays as
 * metrics.fcfMarginTTMOld for the visible comparison until OLD_COMPARISON_UNTIL.
 *
 * Pure functions, no network, no clock (callers pass dates).
 */

const DAY = 86400000;
const OLD_COMPARISON_UNTIL = '2026-12-16'; // at most four weeks of old next to new (formula path)
const SUPPRESS_ABS_PCT = 200;             // same bound as pull-yahoo.js Tag 206b, for every source
// A TTM whose period ends this many days before the newest reported quarter of the same company is
// stale (G31): measured 18.11. on Yahoo trailing rows of Shenzhen listings ending 30.06.2025 next to
// growth from 30.09.2026. One quarter plus filing slack.
const MAX_LAG_DAYS = 100;

const FORMS = /^(10-K|10-Q|10-KT)(\/A)?$/;
const OCF_CONCEPTS = ['NetCashProvidedByUsedInOperatingActivities',
  'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'];
// Capex = one primary payment line (first found, PP&E before oil-and-gas property) plus the disjoint
// add-on lines "other PP&E" and capitalized software. A lone add-on line is not capex. The combined
// "productive assets" line already holds intangibles and other PP&E, so it takes no add-ons.
// (EOG 18.11.: oil-and-gas 6,148 m + other PP&E 530 m; Codex review round 2.)
const CAPEX_MAIN = ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets',
  'PaymentsForCapitalImprovements', 'PaymentsToAcquireOilAndGasPropertyAndEquipment', 'PaymentsToAcquireOilAndGasProperty'];
const CAPEX_ADDONS = ['PaymentsToAcquireOtherPropertyPlantAndEquipment', 'PaymentsToDevelopSoftware', 'PaymentsForSoftware'];
// A fiscal year is 52 or 53 weeks (364 or 371 days, filings round by a few days); an eleven-month
// transition period (10-KT) is not twelve months (Codex review round 2).
const FY_MIN_DAYS = 355, FY_MAX_DAYS = 380;
// Revenue candidates in a fixed order; with a Yahoo row of the same period the candidate closest to it
// is taken (crossCheck), so neither "largest" nor "first" alone decides (banks, excise taxes).
const REVENUE_CONCEPTS = ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues',
  'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet'];
const SAME_PERIOD_DAYS = 20;   // Yahoo dates trailing rows at month end (AAPL 26.09. vs 30.09.)
const MAX_AGE_DAYS = 450;      // a TTM ending this long before the run day is stale whatever the quarter ends say
const TOL_REL = 0.10;          // SEC vs Yahoo, same period: revenue and OCF within 10 %
const CAPEX_MIN_SHARE = 0.5;   // SEC capex at least half of Yahoo's (BILL, BOX: software capex missing)

const ms = (iso) => Date.parse(iso + 'T00:00:00Z');
/**
 * True for a real calendar day written as YYYY-MM-DD (2026-99-99 and 2026-02-30 are not).
 * @param {unknown} x value to test.
 * @returns {boolean}
 */
function isCalendarDay(x) {
  // The whole string, not a prefix: "2012-12-31T00:00:00Z" or "2012-12-31garbage" are no period end (Codex round 3).
  if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
  const t = ms(x);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === x;
}
const days = (f) => Math.round((ms(f.end) - ms(f.start)) / DAY) + 1;
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/**
 * USD duration facts of one us-gaap concept from 10-K/10-Q filings, one per (start, end):
 * the latest filing wins (an amendment replaces the original once filed).
 * @param {object} facts companyfacts JSON (`facts['us-gaap']`).
 * @param {string} concept us-gaap concept name.
 * @returns {Array<{start:string,end:string,val:number,filed:string,form:string}>}
 */
function durationFacts(facts, concept) {
  const arr = facts && facts['us-gaap'] && facts['us-gaap'][concept]
    && facts['us-gaap'][concept].units && facts['us-gaap'][concept].units.USD;
  if (!Array.isArray(arr)) return [];
  const best = new Map();
  for (const f of arr) {
    if (!f || !f.start || !f.end || !isNum(f.val) || !FORMS.test(String(f.form || ''))) continue;
    const k = f.start + '|' + f.end;
    const old = best.get(k);
    if (!old || String(f.filed) > String(old.filed)) best.set(k, f);
  }
  return [...best.values()];
}

/**
 * TTM value of a flow concept ending exactly at `end`.
 * @param {Array} fs facts from durationFacts().
 * @param {string} end ISO period end.
 * @returns {{val:number, filed:string, form:string}|null}
 */
function flowTtm(fs, end) {
  const atEnd = fs.filter((f) => f.end === end);
  const isFy = (f) => days(f) >= FY_MIN_DAYS && days(f) <= FY_MAX_DAYS;
  const fy = atEnd.find(isFy);
  if (fy) return { val: fy.val, filed: fy.filed, form: fy.form };
  const ytds = atEnd.filter((f) => days(f) >= 80 && days(f) < FY_MIN_DAYS && !/^10-KT/.test(String(f.form)))
    .sort((a, b) => days(b) - days(a));
  for (const y of ytds) {
    const startMs = ms(y.start);
    const prevFy = fs.find((f) => isFy(f)
      && Math.abs(ms(f.end) + DAY - startMs) <= 7 * DAY);
    const prevYtd = fs.find((f) => Math.abs(days(f) - days(y)) <= 7
      && Math.abs(ms(f.end) - (ms(end) - 365 * DAY)) <= 10 * DAY
      && Math.abs(ms(f.start) - (startMs - 365 * DAY)) <= 10 * DAY);
    if (prevFy && prevYtd) return { val: prevFy.val + y.val - prevYtd.val, filed: y.filed, form: y.form };
  }
  return null;
}

function firstTtm(facts, concepts, end) {
  for (const c of concepts) {
    const t = flowTtm(durationFacts(facts, c), end);
    if (t) return Object.assign({ concept: c }, t);
  }
  return null;
}

/**
 * Margin in percent, or null when revenue is not positive.
 * @param {number} fcf free cash flow.
 * @param {number} revenue revenue of the same period.
 * @returns {number|null}
 */
function marginPct(fcf, revenue) {
  return isNum(fcf) && isNum(revenue) && revenue > 0 ? (fcf / revenue) * 100 : null;
}

/**
 * SEC TTM FCF margin from a companyfacts document.
 * @param {object} companyfacts parsed https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json
 * @returns {{ok:true,end:string,filed:string,form:string,ocf:number,capex:number,revenue:number,fcf:number,margin:number,concepts:object}|{ok:false,reason:string}}
 */
function secTtmFromFacts(companyfacts) {
  const facts = companyfacts && companyfacts.facts;
  if (!facts || !facts['us-gaap']) return { ok: false, reason: 'sec-no-us-gaap' };
  // The newest period across all supported OCF concepts (a firm can switch concepts; older history in
  // the first concept must not hide a newer series in the second).
  const ocfFacts = OCF_CONCEPTS.flatMap((c) => durationFacts(facts, c));
  const ends = [...new Set(ocfFacts.filter((f) => days(f) >= 80).map((f) => f.end))].sort().reverse();
  if (!ends.length) return { ok: false, reason: 'sec-no-ocf' };
  const end = ends[0]; // newest filed period; an older TTM would break G31, so no fallback to it
  const ocf = firstTtm(facts, OCF_CONCEPTS, end);
  if (!ocf) return { ok: false, reason: 'sec-no-ttm-ocf' };
  const main = firstTtm(facts, CAPEX_MAIN, end);
  if (!main) return { ok: false, reason: 'sec-no-capex' };
  const parts = { [main.concept]: main.val };
  if (main.concept !== 'PaymentsToAcquireProductiveAssets') { // that line already holds the add-ons
    for (const c of CAPEX_ADDONS) { const t = flowTtm(durationFacts(facts, c), end); if (t) parts[c] = t.val; }
  }
  const capex = Object.values(parts).reduce((x, y) => x + y, 0);
  if (!(capex >= 0)) return { ok: false, reason: 'sec-negative-capex' };
  const revenues = {};
  for (const c of REVENUE_CONCEPTS) { const t = flowTtm(durationFacts(facts, c), end); if (t && t.val > 0) revenues[c] = t.val; }
  const first = REVENUE_CONCEPTS.find((c) => revenues[c] !== undefined);
  if (!first) return { ok: false, reason: 'sec-no-revenue' };
  const fcf = ocf.val - capex; // capex is reported as a positive payment
  return { ok: true, end, filed: ocf.filed, form: ocf.form, ocf: ocf.val, capex, revenue: revenues[first],
    revenues, fcf, margin: marginPct(fcf, revenues[first]),
    concepts: { ocf: ocf.concept, capex: Object.keys(parts), revenue: first } };
}

/**
 * Newest complete Yahoo trailing row (fundamentalsTimeSeries type 'trailing', module 'all').
 * Yahoo reports capex as a negative number.
 * @param {Array<object>} rows yahoo-finance2 FTS rows.
 * @returns {{ok:true,end:string,ocf:number,capex:number,revenue:number,fcf:number,margin:number}|{ok:false,reason:string}}
 */
function vendorTtmFromRows(rows) {
  const ok = (Array.isArray(rows) ? rows : []).filter((r) => r && isNum(r.operatingCashFlow)
    && isNum(r.totalRevenue) && (isNum(r.capitalExpenditure) || isNum(r.freeCashFlow)));
  if (!ok.length) return { ok: false, reason: 'vendor-no-ttm' };
  const toIso = (d) => new Date(typeof d === 'number' ? d * 1000 : d).toISOString().slice(0, 10);
  const r = ok.sort((a, b) => toIso(b.date).localeCompare(toIso(a.date)))[0];
  const capex = isNum(r.capitalExpenditure) ? -r.capitalExpenditure : r.operatingCashFlow - r.freeCashFlow;
  const fcf = r.operatingCashFlow - capex;
  if (!(r.totalRevenue > 0)) return { ok: false, reason: 'vendor-no-revenue' };
  // Negative capex (a payment booked as inflow) cannot be verified and would lift FCF above OCF
  // (VET 18.11.: -504.7 m stored, 60.8 % shown instead of about 10 %; Codex review round 2).
  if (!(capex >= 0)) return { ok: false, reason: 'vendor-negative-capex' };
  return { ok: true, end: toIso(r.date), ocf: r.operatingCashFlow, capex, revenue: r.totalRevenue,
    fcf, margin: marginPct(fcf, r.totalRevenue) };
}

/**
 * Check a SEC TTM against a Yahoo row of the same period and pick the SEC revenue concept closest to
 * Yahoo's. Returns the SEC entry with that revenue, or the reason why the SEC extraction is not trusted.
 * @param {object} s SEC store entry (ok).
 * @param {object} v vendor store entry (ok, same period).
 * @returns {{ok:true, entry:object}|{ok:false, reason:string}}
 */
function crossCheck(s, v) {
  const near = (a, b) => isNum(a) && isNum(b) && Math.abs(a - b) <= TOL_REL * Math.abs(b);
  const revs = s.revenues && typeof s.revenues === 'object' ? Object.entries(s.revenues) : [['revenue', s.revenue]];
  const best = revs.filter(([, x]) => isNum(x)).sort((a, b) => Math.abs(a[1] - v.revenue) - Math.abs(b[1] - v.revenue))[0];
  if (!best || !near(best[1], v.revenue)) return { ok: false, reason: 'sec-yahoo-mismatch-revenue' };
  if (!near(s.ocf, v.ocf)) return { ok: false, reason: 'sec-yahoo-mismatch-ocf' };
  if (v.capex > 0.01 * v.revenue && s.capex < CAPEX_MIN_SHARE * v.capex) return { ok: false, reason: 'sec-yahoo-mismatch-capex' };
  const fcf = s.ocf - s.capex;
  return { ok: true, entry: Object.assign({}, s, { revenue: best[1], fcf, margin: marginPct(fcf, best[1]) }) };
}

/**
 * Pick the margin that feeds every board. SEC first: with a Yahoo row of the same period (ends within
 * SAME_PERIOD_DAYS) the SEC figures must agree with it (crossCheck), otherwise the Yahoo row is used and
 * the reason recorded; a Yahoo row more than SAME_PERIOD_DAYS newer wins (G31). A candidate ending more
 * than MAX_LAG_DAYS before the newest reported quarter, or MAX_AGE_DAYS before the run day, is stale.
 * Beyond |200 %| the other source is tried, else the margin is suppressed.
 * @param {{sec:(object|null), vendor:(object|null), newestQuarterEnd:(string|null|undefined), today:(string|undefined)}} inp store entries, newest quarter end of the snapshot, run day (ISO).
 * @returns {{value:(number|null), source:(string|null), periodEnd:(string|null), reason:(string|null), suppressed:boolean}}
 */
function chooseFcfMargin({ sec, vendor, newestQuarterEnd, today }) {
  const iso = (x) => (isCalendarDay(x) ? ms(x.slice(0, 10)) : null);
  const nq = iso(newestQuarterEnd), td = iso(today);
  const stale = (e) => (nq !== null && ms(e.end) < nq - MAX_LAG_DAYS * DAY) || (td !== null && ms(e.end) < td - MAX_AGE_DAYS * DAY);
  const usable = (e) => e && e.ok && isNum(e.margin);
  // Entry invariants (Codex review round 2): a real calendar day not after the run day, finite parts,
  // positive revenue, non-negative capex. Anything else is unusable with a reason, never ranked.
  const valid = (e) => isCalendarDay(e.end) && !(td !== null && ms(e.end) > td)
    && isNum(e.ocf) && isNum(e.capex) && e.capex >= 0 && isNum(e.revenue) && e.revenue > 0;
  if (usable(sec) && !valid(sec)) sec = { ok: false, reason: 'sec-invalid-entry' };
  if (usable(vendor) && !valid(vendor)) vendor = { ok: false, reason: 'vendor-invalid-entry' };
  if (usable(sec) && stale(sec)) sec = { ok: false, reason: 'sec-ttm-stale' };
  if (usable(vendor) && stale(vendor)) vendor = { ok: false, reason: 'vendor-ttm-stale' };
  let s = usable(sec) ? sec : null;
  const v = usable(vendor) ? vendor : null;
  const notes = [];
  if (s && v) {
    const gap = (ms(v.end) - ms(s.end)) / DAY;
    if (gap > SAME_PERIOD_DAYS) { notes.push('yahoo-newer'); s = null; }
    else if (gap >= -SAME_PERIOD_DAYS) {
      const c = crossCheck(s, v);
      if (c.ok) s = c.entry; else { notes.push(c.reason); s = null; }
    }
  }
  const cands = [];
  if (s) cands.push([s, 'sec-ttm']);
  // An older Yahoo row never replaces a newer SEC TTM (it only backs up a SEC margin beyond 200 % of the same period).
  if (v && !(s && ms(v.end) < ms(s.end) - SAME_PERIOD_DAYS * DAY)) cands.push([v, 'yahoo-fts-ttm']);
  for (const [e, source] of cands) {
    if (Math.abs(e.margin) <= SUPPRESS_ABS_PCT) {
      return { value: e.margin, source, periodEnd: e.end, reason: notes.length ? notes.join(',') : null, suppressed: false };
    }
    notes.push(source + '-over-200');
  }
  if (cands.length) return { value: null, source: null, periodEnd: cands[0][0].end, reason: 'abs-margin-over-200', suppressed: true };
  const reason = [sec && sec.reason, vendor && vendor.reason, ...notes].filter(Boolean).join(',') || 'no-ttm-source';
  return { value: null, source: null, periodEnd: null, reason, suppressed: false };
}

module.exports = { secTtmFromFacts, vendorTtmFromRows, chooseFcfMargin, crossCheck, flowTtm, durationFacts, marginPct, isCalendarDay,
  OLD_COMPARISON_UNTIL, SUPPRESS_ABS_PCT, MAX_LAG_DAYS, SAME_PERIOD_DAYS, MAX_AGE_DAYS };
