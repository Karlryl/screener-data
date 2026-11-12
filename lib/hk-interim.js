'use strict';
/**
 * Hong Kong interim growth for G31 (lane sd-halbjahr, 12.11.2026): the newest six-month pair of a Hong Kong listing
 * from external-data/exchange-quarters/hk.json (scripts/fetch-hk-interims.js, Eastmoney). Read-time only, like
 * meta.annualRevNewerYear: no vendor series is changed, only the shared growth leg of lib/g31-recency.js reads it.
 *
 * G2: a pair counts only when two computations agree, the ratio of the stored interim and its year-ago value and
 * Eastmoney's own growth figure, within AGREE_PP. A restated year ago (GenScript H1 2026: ratio -25.9 %, Eastmoney -22.1 %,
 * report +27.3 %) or a period converted at different rates (MMG) fails this and the row keeps its fiscal year.
 * Measured 12.11.2026 on the 101 stale HK board rows: 100 covered, 79 agree, all 8 agreeing cases with a primary-source
 * value correct. Only the ratio is used; amounts never leave this module (Eastmoney's currency label is unreliable).
 */
const fs = require('fs');
const path = require('path');
const { dataDay } = require('./annual-pairs.js');

const ENABLED = true; // ponytail: rollback switch, set false to return every HK row to its fiscal-year leg
const AGREE_PP = 0.1;
const STORE_FILE = path.join(__dirname, '..', 'external-data', 'exchange-quarters', 'hk.json');
let cache;

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
const monthEnd = (y, m) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // m is 1-based

/** Whether start..end is exactly six calendar months ending on a month end and priorEnd the same end a year earlier. */
function sixMonths(o, end) {
  const y = Number(end.slice(0, 4)), m = Number(end.slice(5, 7));
  if (end !== monthEnd(y, m)) return false;
  const sm = m - 5, start = sm > 0 ? `${y}-${String(sm).padStart(2, '0')}-01` : `${y - 1}-${String(sm + 12).padStart(2, '0')}-01`;
  return o.start === start && o.priorEnd === monthEnd(y - 1, m);
}

/**
 * Newest agreeing half-year pair of this listing, known on the data day.
 * @param {object} s Prepared snapshot.
 * @param {object|null} [store] Parsed store (tests); default the committed store.
 * @returns {{current:number, prior:number, end:string, priorEnd:string}|null} Ratio operands in the source unit, or null.
 */
function hkInterimPair(s, store) {
  if (!ENABLED) return null;
  const ticker = s?.meta?.ticker;
  if (!/^\d{4,5}\.HK$/.test(ticker || '')) return null;
  if (store === undefined) store = module.exports.defaultStore();
  const periods = store?.companies?.[ticker]?.halfYear;
  if (!periods) return null;
  const today = dataDay();
  for (const end of Object.keys(periods).filter(day).sort().reverse()) {
    // Point in time: the reading valid on the data day, not a later restatement (append-only list, newest last).
    const list = periods[end].filter((o) => !today || (o.confirmedBy?.[0]?.fetchedAt || '9999').slice(0, 10) <= today);
    const o = list[list.length - 1];
    if (!o) continue;
    if (!sixMonths(o, end) || !(o.revenue > 0) || !(o.priorRevenue > 0) || !Number.isFinite(o.yoyPct)) return null;
    // ponytail: only the newest known interim is judged; an older agreeing one is older than the fiscal year anyway.
    return Math.abs((o.revenue / o.priorRevenue - 1) * 100 - o.yoyPct) <= AGREE_PP
      ? { current: o.revenue, prior: o.priorRevenue, end, priorEnd: o.priorEnd } : null;
  }
  return null;
}

/** The committed store, loaded once per process; tests replace this function like X.defaultContext. @returns {object|null} */
function defaultStore() { return cache === undefined ? (cache = loadStore()) : cache; }

module.exports = { hkInterimPair, loadStore, defaultStore, AGREE_PP };
