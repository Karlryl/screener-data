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
const CAPEX_CONCEPTS = ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets',
  'PaymentsForCapitalImprovements', 'PaymentsToAcquireOtherPropertyPlantAndEquipment'];
const REVENUE_CONCEPTS = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax',
  'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet'];

const ms = (iso) => Date.parse(iso + 'T00:00:00Z');
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
  const fy = atEnd.find((f) => days(f) >= 330 && days(f) <= 380);
  if (fy) return { val: fy.val, filed: fy.filed, form: fy.form };
  const ytds = atEnd.filter((f) => days(f) >= 80 && days(f) < 330).sort((a, b) => days(b) - days(a));
  for (const y of ytds) {
    const startMs = ms(y.start);
    const prevFy = fs.find((f) => days(f) >= 330 && days(f) <= 380
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
  let ocfFacts = [];
  for (const c of OCF_CONCEPTS) { ocfFacts = durationFacts(facts, c); if (ocfFacts.length) break; }
  const ends = [...new Set(ocfFacts.filter((f) => days(f) >= 80).map((f) => f.end))].sort().reverse();
  if (!ends.length) return { ok: false, reason: 'sec-no-ocf' };
  const end = ends[0]; // newest filed period; an older TTM would break G31, so no fallback to it
  const ocf = firstTtm(facts, OCF_CONCEPTS, end);
  if (!ocf) return { ok: false, reason: 'sec-no-ttm-ocf' };
  const capex = firstTtm(facts, CAPEX_CONCEPTS, end);
  if (!capex) return { ok: false, reason: 'sec-no-capex' };
  // Total revenue: the largest TTM among the revenue concepts at this end (Revenues >= contract revenue).
  let rev = null;
  for (const c of REVENUE_CONCEPTS) {
    const t = flowTtm(durationFacts(facts, c), end);
    if (t && (!rev || t.val > rev.val)) rev = Object.assign({ concept: c }, t);
  }
  if (!rev || !(rev.val > 0)) return { ok: false, reason: 'sec-no-revenue' };
  const fcf = ocf.val - capex.val; // capex is reported as a positive payment
  return { ok: true, end, filed: ocf.filed, form: ocf.form, ocf: ocf.val, capex: capex.val,
    revenue: rev.val, fcf, margin: marginPct(fcf, rev.val),
    concepts: { ocf: ocf.concept, capex: capex.concept, revenue: rev.concept } };
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
  return { ok: true, end: toIso(r.date), ocf: r.operatingCashFlow, capex, revenue: r.totalRevenue,
    fcf, margin: marginPct(fcf, r.totalRevenue) };
}

/**
 * Pick the margin that feeds every board. SEC first; vendor only without SEC TTM or when its
 * period end is strictly newer (G31). A candidate ending more than MAX_LAG_DAYS before the
 * company's newest reported quarter is not used (reason '<source>-ttm-stale').
 * @param {{sec:(object|null), vendor:(object|null), newestQuarterEnd:(string|null|undefined)}} inp store entries ({ok, end, margin, ...}) and the newest quarter end of the snapshot.
 * @returns {{value:(number|null), source:(string|null), periodEnd:(string|null), reason:(string|null), suppressed:boolean}}
 */
function chooseFcfMargin({ sec, vendor, newestQuarterEnd }) {
  const nq = typeof newestQuarterEnd === 'string' && /^\d{4}-\d{2}-\d{2}/.test(newestQuarterEnd) ? ms(newestQuarterEnd.slice(0, 10)) : null;
  const stale = (e) => nq !== null && ms(e.end) < nq - MAX_LAG_DAYS * DAY;
  if (sec && sec.ok && isNum(sec.margin) && stale(sec)) sec = { ok: false, reason: 'sec-ttm-stale' };
  if (vendor && vendor.ok && isNum(vendor.margin) && stale(vendor)) vendor = { ok: false, reason: 'vendor-ttm-stale' };
  const s = sec && sec.ok && isNum(sec.margin) ? sec : null;
  const v = vendor && vendor.ok && isNum(vendor.margin) ? vendor : null;
  let pick = null, source = null;
  if (s && (!v || v.end <= s.end)) { pick = s; source = 'sec-ttm'; }
  else if (v) { pick = v; source = 'yahoo-fts-ttm'; }
  if (!pick) {
    const reason = [sec && sec.reason, vendor && vendor.reason].filter(Boolean).join(',') || 'no-ttm-source';
    return { value: null, source: null, periodEnd: null, reason, suppressed: false };
  }
  if (Math.abs(pick.margin) > SUPPRESS_ABS_PCT) {
    return { value: null, source, periodEnd: pick.end, reason: 'abs-margin-over-200', suppressed: true };
  }
  return { value: pick.margin, source, periodEnd: pick.end, reason: null, suppressed: false };
}

module.exports = { secTtmFromFacts, vendorTtmFromRows, chooseFcfMargin, flowTtm, durationFacts, marginPct,
  OLD_COMPARISON_UNTIL, SUPPRESS_ABS_PCT, MAX_LAG_DAYS };
