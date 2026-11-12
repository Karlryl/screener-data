'use strict';
/**
 * Hong Kong interim growth for G31 (lane sd-halbjahr, 12.11.2026): the newest six-month pair of a Hong Kong listing
 * from external-data/exchange-quarters/hk.json (scripts/fetch-hk-interims.js, Eastmoney). Read-time only, like
 * meta.annualRevNewerYear: no vendor series is changed, only the shared growth leg of lib/g31-recency.js reads it.
 *
 * G2, three conditions, all must hold:
 * 1. Internal consistency at Eastmoney: the ratio of the stored interim and its year-ago value equals Eastmoney's own
 *    growth figure within AGREE_PP. Eastmoney computes that figure from the same two cells almost always, so this only
 *    catches pairs where Eastmoney keeps two different year-ago values (GenScript: restated prior, ratio -25.9 % against
 *    -22.1 %, report +27.3 %; MMG: periods converted at different rates). It is not a second source.
 * 2. General companies only (orgType 一般企业): for banks, brokers and insurers Eastmoney's line is total income with
 *    investment gains (GF Securities, CITIC FAMC), not the revenue the other boards show.
 * 3. Size and unit check against Yahoo (the second source): the year-ago half, in the snapshot's reporting currency,
 *    lies above 0 and at most SHARE_MAX of the fiscal year that contains it (Yahoo annual row or the recorded newer
 *    year). A currency or unit slip (factor about 7 between CNY and USD) fails this.
 * The pair is returned in the snapshot's stored unit (reporting currency times meta.fxRateApplied), so readers of
 * leg.current/leg.prior (the Rule-of-40 tiny-base guard) compare like with like.
 * Measured 12.11.2026: 15 of 15 agreeing pairs checked against the HKEX reports were correct.
 */
const fs = require('fs');
const path = require('path');
const { dataDay } = require('./annual-pairs.js');
const { norm } = require('../src/scoring/snapshot.js');

const ENABLED = true; // ponytail: rollback switch, set false to return every HK row to its fiscal-year leg
const AGREE_PP = 0.1;
const SHARE_MAX = 0.9;
const GENERAL = '一般企业';
const STORE_FILE = path.join(__dirname, '..', 'external-data', 'exchange-quarters', 'hk.json');
let cache, missingWarned = false;
// ponytail: whole-table text scan, conservative by design (1088, 1456, 2498, 2670, 3993 on 12.11.2026)
const HAND_TABLE_HK = new Set(JSON.stringify(require('../configs/financial-known-cases.json')).match(/\b\d{4,5}\.HK\b/g) || []);

/**
 * Parsed store or null when the file is absent; a malformed store throws.
 * @param {string} [file] Store path, default external-data/exchange-quarters/hk.json.
 * @returns {object|null} Parsed store.
 */
function loadStore(file = STORE_FILE) {
  if (!fs.existsSync(file)) return null;
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (s.schemaVersion !== 1 || s.market !== 'HK' || !s.companies || typeof s.companies !== 'object') throw new Error('Invalid HK interim store: ' + file);
  return s;
}

const day = (d) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
const monthEnd = (y, m) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // m is 1-based, rolls over the year

/** Whether start..end is exactly six calendar months ending on a month end and priorEnd the same end a year earlier. */
function sixMonths(o, end) {
  const y = Number(end.slice(0, 4)), m = Number(end.slice(5, 7));
  if (end !== monthEnd(y, m)) return false;
  const sm = m - 5, start = sm > 0 ? `${y}-${String(sm).padStart(2, '0')}-01` : `${y - 1}-${String(sm + 12).padStart(2, '0')}-01`;
  return o.start === start && o.priorEnd === monthEnd(y - 1, m);
}

/** Revenue of the fiscal year ending fyEnd in the reporting currency, from the Yahoo annual row or the recorded newer year. */
function fiscalYearNative(s, fyEnd, fx) {
  const ends = s?.annual?.annualRevEnds, values = norm(s, 'annualRev');
  const i = Array.isArray(ends) && ends.length === values.length ? ends.findIndex((e) => typeof e === 'string' && e.slice(0, 10) === fyEnd) : -1;
  if (i >= 0 && values[i] > 0) return values[i] / fx;
  const n = s?.meta?.annualRevNewerYear;
  return n && n.end === fyEnd && n.currency === (s.meta.reportingCurrencyOriginal || s.meta.reportingCurrency) && n.revenue > 0 ? n.revenue : null;
}

/**
 * Newest half-year pair of this listing, known on the data day, that passes the three G2 conditions above.
 * @param {object} s Prepared snapshot.
 * @param {object|null} [store] Parsed store (tests); default the committed store.
 * @returns {{current:number, prior:number, end:string, priorEnd:string}|null} Operands in the snapshot's stored unit, or null.
 */
function hkInterimPair(s, store) {
  if (!ENABLED) return null;
  const ticker = s?.meta?.ticker;
  if (!/^\d{4,5}\.HK$/.test(ticker || '')) return null;
  // G2: a listing the financial hand table names anywhere (case, alias, quarantine, hold) keeps its reviewed figures.
  if (HAND_TABLE_HK.has(ticker)) return null;
  if (store === undefined) store = module.exports.defaultStore();
  const periods = store?.companies?.[ticker]?.halfYear;
  if (!periods) return null;
  const fx = s.meta.fxConverted === true ? s.meta.fxRateApplied : 1;
  if (!(fx > 0)) return null;
  const today = dataDay();
  for (const end of Object.keys(periods).filter(day).sort().reverse()) {
    // Point in time: the reading valid on the data day, not a later restatement (append-only list, newest last).
    const list = periods[end].filter((o) => !today || (o.confirmedBy?.[0]?.fetchedAt || '9999').slice(0, 10) <= today);
    const o = list[list.length - 1];
    if (!o) continue;
    // ponytail: only the newest known interim is judged; an older one is older than the fiscal year anyway.
    if (!sixMonths(o, end) || o.orgType !== GENERAL || !(o.revenue > 0) || !(o.priorRevenue > 0) || !Number.isFinite(o.yoyPct)) return null;
    if (Math.abs((o.revenue / o.priorRevenue - 1) * 100 - o.yoyPct) > AGREE_PP) return null;
    const y = Number(o.priorEnd.slice(0, 4)), m = Number(o.priorEnd.slice(5, 7));
    const fy = fiscalYearNative(s, monthEnd(y, m + 6), fx);
    if (!(fy > 0) || !(o.priorRevenue / fy <= SHARE_MAX)) return null;
    return { current: o.revenue * fx, prior: o.priorRevenue * fx, end, priorEnd: o.priorEnd };
  }
  return null;
}

/**
 * The committed store, loaded once per process, but only inside a run with a data day (RUN_DATE_UTC, like the age rule):
 * the store grows every day, so a test or tool without a data day must not change with it. Tests replace this function.
 * @returns {object|null} Parsed store or null.
 */
function defaultStore() {
  if (dataDay() === null) return null;
  if (cache === undefined) cache = loadStore();
  if (cache === null && !missingWarned) {
    missingWarned = true; // one line per process: every HK row keeps its fiscal year (G2), but not silently
    console.warn('::warning::[hk-interim] external-data/exchange-quarters/hk.json fehlt; Hongkonger Zeilen bleiben beim Geschäftsjahr.');
  }
  return cache;
}

module.exports = { hkInterimPair, loadStore, defaultStore, AGREE_PP, SHARE_MAX };
