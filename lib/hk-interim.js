'use strict';
/**
 * Hong Kong interim growth for G31 (lane sd-halbjahr, 12.11.2026): the newest six-month pair of a Hong Kong listing
 * from external-data/exchange-quarters/hk.json (scripts/fetch-hk-interims.js, Eastmoney). Read-time only, like
 * meta.annualRevNewerYear: no vendor series is changed, only the shared growth leg of lib/g31-recency.js reads it.
 *
 * G2, all conditions must hold:
 * 1. Internal consistency at Eastmoney: the ratio of the stored interim and its year-ago value equals Eastmoney's own
 *    growth figure within AGREE_PP. Eastmoney computes that figure from the same two cells almost always, so this only
 *    catches pairs where Eastmoney keeps two different year-ago values (GenScript: restated prior; MMG: periods
 *    converted at different rates). It is not a second source.
 * 2. General companies only (orgType 一般企业): for banks, brokers and insurers Eastmoney's line is total income with
 *    investment gains (GF Securities, CITIC FAMC), not the revenue the other boards show.
 * 3. Same quantity against a second source (Codex review 12.11.2026): Eastmoney's own revenue for the fiscal year that
 *    contains the year-ago half equals Yahoo's revenue for that year, in the reporting currency, within FY_MATCH. This
 *    proves that Eastmoney's amounts of this company carry Yahoo's unit, currency and revenue line, so the operands can
 *    be returned in the snapshot unit (times meta.fxRateApplied) for readers such as the Rule-of-40 tiny-base guard.
 *    Measured 12.11.2026: 390 of 402 otherwise passing pairs match to 1 %.
 * 4. The year-ago half lies above 0 and at most SHARE_MAX of that fiscal year (a plausibility bound, not a proof).
 * 5. The year-ago half against Yahoo: Yahoo's trailing twelve months to the same end (financialData.totalRevenue, dated
 *    by mostRecentQuarter) imply it as fiscal year plus new half minus trailing twelve months; Eastmoney's value must
 *    match within PRIOR_MATCH of the year-ago half itself (Codex round 2: a share of the fiscal year let a small base
 *    through, Metis). Without that Yahoo figure the pair is not used. This checks the difference of the two halves only;
 *    the levels come from condition 6.
 * 6. Both halves equal the values printed in the company's HKEX interim filing (configs/hk-interim-filed.json, read
 *    twice) within FILED_MATCH; the filed values are the operands. Without a record the row keeps its fiscal year.
 * Measured 12.11.2026: 15 of 15 agreeing pairs checked against the HKEX reports were correct.
 */
const fs = require('fs');
const path = require('path');
const { dataDay } = require('./annual-pairs.js');
const { norm } = require('../src/scoring/snapshot.js');

const ENABLED = true; // ponytail: rollback switch, set false to return every HK row to its fiscal-year leg
const AGREE_PP = 0.1;
const FY_MATCH = 0.01;
const PRIOR_MATCH = 0.01; // of the year-ago half; measured 12.11.2026: 278 of 280 passing pairs within 0.5 %, all 280 within 1 %
const SHARE_MAX = 0.9;
const GENERAL = '一般企业';
const FILED_MATCH = 0.001; // Eastmoney against the filed half years (rounding of printed thousands only)
const STORE_FILE = path.join(__dirname, '..', 'external-data', 'exchange-quarters', 'hk.json');
const isDay = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;

/**
 * Validate the filed interim table (configs/hk-interim-filed.json): per listing and interim end the revenue of both halves as
 * printed in the company's HKEX filing, read twice independently (link, page, verbatim line). Malformed authority throws.
 * @param {object} table Parsed table.
 * @returns {Map<string, object>} Records keyed by `ticker|end`.
 */
function validateFiled(table) {
  if (table?.schemaVersion !== 1 || !Array.isArray(table.records)) throw new Error('Invalid HK filed interim table');
  const out = new Map();
  for (const r of table.records) {
    const key = r?.ticker + '|' + r?.end;
    const ok = /^\d{4,5}\.HK$/.test(r?.ticker || '') && isDay(r.end) && isDay(r.priorEnd) && isDay(r.verifiedAt) && /^[A-Z]{3}$/.test(r.currency || '')
      && r.current > 0 && r.prior > 0 && typeof r.priorRestated === 'boolean' && Array.isArray(r.readings) && r.readings.length === 2
      && new Set(r.readings.map((x) => x.reader)).size === 2 && r.readings.every((x) => /^https:\/\//.test(x.url || '') && Number.isInteger(x.page)
        && x.page >= 1 && typeof x.quote === 'string' && x.quote.length > 5 && isDay(x.published) && x.published > r.end && x.published <= r.verifiedAt
        && [1, 1000, 1000000].includes(x.multiplier) && x.current * x.multiplier === r.current && x.prior * x.multiplier === r.prior);
    if (!ok || out.has(key)) throw new Error('Invalid HK filed interim record: ' + key);
    out.set(key, r);
  }
  return out;
}
const FILED = validateFiled(require('../configs/hk-interim-filed.json'));
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
const monthStart = (y, m) => new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10); // m is 1-based, rolls over the year

/** Whether start..end is exactly n calendar months ending on a month end. */
function spans(start, end, months) {
  const y = Number(end.slice(0, 4)), m = Number(end.slice(5, 7));
  return end === monthEnd(y, m) && start === monthStart(y, m - months + 1);
}

/** Last observation of a period list known on the data day (append-only list, newest last). */
function knownOn(list, today) {
  const seen = (list || []).filter((o) => !today || (o.confirmedBy?.[0]?.fetchedAt || '9999').slice(0, 10) <= today);
  return seen[seen.length - 1] || null;
}

/** Yahoo revenue of the fiscal year ending fyEnd in the reporting currency: annual row or the recorded newer year. */
function yahooFiscalYear(s, fyEnd, fx) {
  const ends = s?.annual?.annualRevEnds, values = norm(s, 'annualRev');
  const i = Array.isArray(ends) && ends.length === values.length ? ends.findIndex((e) => typeof e === 'string' && e.slice(0, 10) === fyEnd) : -1;
  if (i >= 0 && values[i] > 0) return values[i] / fx;
  const n = s?.meta?.annualRevNewerYear;
  return n && n.end === fyEnd && n.currency === (s.meta.reportingCurrencyOriginal || s.meta.reportingCurrency) && n.revenue > 0 ? n.revenue : null;
}

/**
 * Newest half-year pair of this listing, known on the data day, that passes the G2 conditions above.
 * @param {object} s Prepared snapshot.
 * @param {object|null} [store] Parsed store (tests); default the committed store.
 * @returns {{current:number, prior:number, end:string, priorEnd:string, evidence:object}|null} Operands in the snapshot's
 *   stored unit plus the evidence of the reading (for the export provenance), or null.
 */
function hkInterimPair(s, store) {
  if (!ENABLED) return null;
  const ticker = s?.meta?.ticker;
  if (!/^\d{4,5}\.HK$/.test(ticker || '')) return null;
  // G2: a listing the financial hand table names anywhere (case, alias, quarantine, hold) keeps its reviewed figures.
  if (HAND_TABLE_HK.has(ticker)) return null;
  if (store === undefined) store = module.exports.defaultStore();
  const company = store?.companies?.[ticker];
  if (!company?.halfYear) return null;
  const fx = s.meta.fxConverted === true ? s.meta.fxRateApplied : 1;
  if (!(fx > 0)) return null;
  const today = dataDay();
  const end = Object.keys(company.halfYear).filter(day).sort().reverse().find((e) => knownOn(company.halfYear[e], today));
  // ponytail: only the newest known interim is judged; an older one is older than the fiscal year anyway.
  const o = end && knownOn(company.halfYear[end], today);
  if (!o || !spans(o.start, end, 6) || o.priorEnd !== monthEnd(Number(end.slice(0, 4)) - 1, Number(end.slice(5, 7)))) return null;
  if (o.orgType !== GENERAL || !(o.revenue > 0) || !(o.priorRevenue > 0) || !Number.isFinite(o.yoyPct)) return null;
  if (Math.abs((o.revenue / o.priorRevenue - 1) * 100 - o.yoyPct) > AGREE_PP) return null;
  const fyEnd = monthEnd(Number(o.priorEnd.slice(0, 4)), Number(o.priorEnd.slice(5, 7)) + 6);
  const fyEm = knownOn(company.fiscalYear?.[fyEnd], today), fyYahoo = yahooFiscalYear(s, fyEnd, fx);
  if (!fyEm || !spans(fyEm.start, fyEnd, 12) || !(fyEm.revenue > 0) || !(fyYahoo > 0)) return null;
  if (Math.abs(fyEm.revenue / fyYahoo - 1) > FY_MATCH || !(o.priorRevenue / fyYahoo <= SHARE_MAX)) return null;
  // Condition 5: the year-ago half itself against Yahoo. Yahoo's trailing twelve months to the same end equal the fiscal year
  // minus the year-ago half plus the new half, so Yahoo implies the year-ago half independently of Eastmoney.
  const ttm = s.metrics?.revenueTTM?.value, mrq = day(String(s.meta.mostRecentQuarter || '').slice(0, 10));
  if (!(ttm > 0) || mrq !== end) return null;
  const impliedPrior = fyYahoo + o.revenue - ttm / fx;
  if (Math.abs(o.priorRevenue - impliedPrior) > PRIOR_MATCH * o.priorRevenue) return null;
  // Condition 6 (Codex round 2, finding 1): both half-year levels as printed in the company's own filing, read twice
  // (configs/hk-interim-filed.json). Eastmoney must equal both; the filed values are the operands.
  const rec = module.exports.filedTable().get(ticker + '|' + end);
  if (!rec || rec.priorEnd !== o.priorEnd || rec.currency !== (s.meta.reportingCurrencyOriginal || s.meta.reportingCurrency)) return null;
  if (today && rec.verifiedAt > today) return null; // point in time: the table counts from the day it was checked
  if (Math.abs(o.revenue / rec.current - 1) > FILED_MATCH || Math.abs(o.priorRevenue / rec.prior - 1) > FILED_MATCH) return null;
  const at = (x) => x.confirmedBy?.[0] || {};
  const doc = rec.readings[0];
  return { current: rec.current * fx, prior: rec.prior * fx, end, priorEnd: o.priorEnd,
    evidence: { secucode: company.secucode, start: o.start, end, priorEnd: o.priorEnd, revenue: rec.current, priorRevenue: rec.prior,
      fx, src: at(o).src || null, fetchedAt: at(o).fetchedAt || null, fyEnd, fyRevenue: fyEm.revenue, fyYahoo, impliedPrior,
      filed: { url: doc.url, page: doc.page, quote: doc.quote, published: doc.published, title: doc.documentTitle || null, verifiedAt: rec.verifiedAt } } };
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

/**
 * The validated filed interim table; tests replace this function.
 * @returns {Map<string, object>} Records keyed by `ticker|end`.
 */
function filedTable() { return FILED; }

module.exports = { hkInterimPair, loadStore, defaultStore, filedTable, validateFiled, AGREE_PP, FY_MATCH, PRIOR_MATCH, SHARE_MAX, FILED_MATCH };
