'use strict';
/**
 * lib/exchange-quarter-check.js — Tag 1403 (G2b). Read-time cross-check of the vendor's quarterly
 * revenue against the exchange-fed store (external-data/exchange-quarters/{cn,tw}.json, Tag 1399).
 *
 * Mode (configs/exchange-quarter-policy.json, one setting):
 *   off     the step only removes its own markers (none exist on disk,
 *           the pull never runs it) and returns the input object unchanged.
 *   shadow  computes what it would do (`result`) and returns the snapshot unchanged; used only by
 *           scripts/exchange-check-report.js.
 *   fill-only applies only eligible fills; never withholds (the committed mode).
 *   active  applies both fills and withholding; not enabled.
 * Every mode first removes the step's own markers and restores the original vendor cells, so a
 * mode change never leaves residue.
 *
 * Guard: for every date-matched year-over-year pair the scoring forms (jahresVergleichIdx), the
 * OLDER quarter is withheld when either quarter misses the exchange figure (0.1 %, statement
 * currency, one revenue line per company). The newest quarter is never withheld (j > i >= 0).
 * Securities firms are their own stratum: vendor and exchange lines differ by definition, so a
 * pair is mixed only when the vendor/exchange ratio of its two quarters differs by more than the
 * tolerance. Banks and insurers stay unchecked. When the level pair (newest quarter) is withheld,
 * the annual pair that growth falls back to is checked against the exchange full years; if it does
 * not agree (or cannot be checked) the growth figure is withheld entirely. A cell of a fill period (2025-09-30)
 * that the vendor delivered after the baseline vintage and that misses the exchange figure is withheld wherever it
 * sits (F5, general stratum); a cell the baseline already carried was on time and is only counted.
 * Fill: an EMPTY or ABSENT vendor cell of a fill period (2025-09-30) gets the exchange single quarter only
 * when every vendor quarter agrees with the store, the vendor's 2025 quarters are unchanged since
 * the board-history vintage before 2026-08-01 (a quarter that vintage does not carry is unproven), the store has no
 * restatement signal, and (once the Q3-2026 reports exist) the Q3-2025 observation was confirmed after the Q3-2026
 * notice date and (China) its first stored confirmation carries an UPDATE_DATE before that notice and equal to the
 * observation's own notice date (sd-quellen 12.11.2026: stored date fields as risk signals, no proof of a common
 * reporting basis of 9M and H1; Codex R-pr124 R3 P1).
 *
 * SEC quarter fill (US, policy usFill, store external-data/exchange-quarters/us.json): when SEC holds a filed quarter
 * newer than the vendor's newest one, on a revenue concept that agrees with the vendor's own quarters, the pair goes
 * into meta.secQuarterFill and only the growth leg reads it (lib/g31-recency.js). The vendor series stays untouched.
 * A row uses the fill throughout or not at all: a fiscal year truly newer than the fill means no fill, an end within the
 * end tolerance is the same period end and the quarter leads, as on an equal end.
 *
 * Nothing under src/scoring/ changes; readers see the result only through prepareSnapshot, and
 * only in fill-only or active mode.
 */
const fs = require('fs');
const path = require('path');
const policy = require('../configs/exchange-quarter-policy.json');
const S = require('./exchange-quarter-store.js');
const { jahresVergleichIdx, norm } = require('../src/scoring/snapshot.js');
const { revGrowthLeg: shownLeg } = require('./rev-growth-basis.js');
// sd-p2 (29.10.2026): the check judges the index-0 growth selection its level fallback and reason texts are written for;
// the G31 older-quarter-pair walk (lib/g31-recency.js) stays off inside it. Mode and categories are unchanged.
const revGrowthLeg = s => require('./g31-recency.js').withoutOlderPair(() => shownLeg(s));
// SEC quarter fill (PR #85): the row as shown without the fill, on the same index-0 selection. For US rows the result
// is the same with the walk on: an older pair ends at or after the newest fiscal year end, so that year is never newer than a fill.
const g31Shadow = s => { const g = require('./g31-recency.js'); return g.withoutOlderPair(() => g.g31Shadow(s)); };
const financialTable = require('../configs/financial-known-cases.json');
const q4Table = require('../configs/yahoo-q4-known-cases.json');

const ROOT = path.join(__dirname, '..');
const MODES = ['off', 'shadow', 'fill-only', 'active'];
const OWN_CODES = new Set(['exchange-pair-mismatch', 'exchange-annual-mismatch', 'exchange-quarter-mismatch']);
const valueOf = row => typeof row === 'number' ? row : row && typeof row === 'object' ? row.value : row;
const finite = Number.isFinite;
// Lazy: yahoo-q4-known-cases.js requires this file (prepareSnapshot), a top-level require would be circular.
const q4 = () => require('./yahoo-q4-known-cases.js');

/** Validate the policy; a malformed policy fails loudly. @param {object} p @returns {object} */
function validatePolicy(p) {
  if (p?.schemaVersion !== 1 || !MODES.includes(p.mode) || !(p.tolerance > 0 && p.tolerance < 0.01) ||
      !Array.isArray(p.fillPeriods) || !p.fillPeriods.every(d => /^\d{4}-09-30$/.test(d)) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(p.restatementBaselineBefore) ||
      !(p.maxStoreAgeDays > 0) || !(p.maxStoreAgeDaysInSeason > 0) || typeof p.usFill !== 'boolean') {
    throw new Error('Invalid exchange-quarter policy');
  }
  return p;
}
validatePolicy(policy);

// German reason texts the owner reads (financialDataReasons on the board).
const REASONS = {
  level: 'Quartalsvergleich ausgeblendet: Das Vorjahresquartal des Datenanbieters weicht von der Börsenmeldung ab (vermutlich berichtigte Vorjahreszahlen). Gezeigt wird der Jahreswert.',
  levelNoAnnual: 'Quartalsvergleich ausgeblendet: Das Vorjahresquartal des Datenanbieters weicht von der Börsenmeldung ab (vermutlich berichtigte Vorjahreszahlen). Ein Jahreswert liegt nicht vor, deshalb wird kein Umsatzwachstum gezeigt.',
  lateQuarter: 'Quartalsumsatz ausgeblendet: Der nachgelieferte Wert des Datenanbieters weicht von der Börsenmeldung ab. Das Quartal wird nicht verwendet.',
  acceleration: 'Vorjahresquartal ausgeblendet: Der Wert des Datenanbieters weicht von der Börsenmeldung ab (vermutlich berichtigte Vorjahreszahlen). Er zählt nicht zur Beschleunigung des Umsatzwachstums.',
  growth: 'Umsatzwachstum ausgeblendet: Vorjahresquartal und Jahreswerte des Datenanbieters weichen von der Börsenmeldung ab oder sind nicht prüfbar (vermutlich berichtigte Vorjahreszahlen).',
};
/** German labels for unchecked exchange rows. @type {Object<string,string>} */
const UNCHECKED_TEXT = {
  'no-own-read': 'Börsenquelle hat diese Firma noch nie geliefert',
  'store-old': 'Der letzte Abruf der Börsenquelle für diese Firma ist älter als die Frist',
};
const day = iso => typeof iso === 'string' ? iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4) : null;
const fillReason = (period, source, date) =>
  `Umsatz ${Number(period.slice(5, 7)) / 3}. Quartal ${period.slice(0, 4)} fehlte beim Datenanbieter und stammt aus der Börsenmeldung (${source}, ${date}).`;

// ── Store and baseline loading ───────────────────────────────────────────────
/** Read both store files. A missing or unreadable file is a warning, never an exception.
 * @param {string} [dir] store directory (env seam EXCHANGE_QUARTERS_DIR)
 * @returns {{cn:object|null, tw:object|null, warnings:string[]}} */
function loadStores(dir = process.env.EXCHANGE_QUARTERS_DIR || path.join(ROOT, 'external-data', 'exchange-quarters')) {
  const out = { cn: null, tw: null, warnings: [] };
  for (const [key, market, currency] of [['cn', 'CN', 'CNY'], ['tw', 'TW', 'TWD']]) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, key + '.json'), 'utf8'));
      if (s?.schemaVersion !== 1 || s.market !== market || s.currency !== currency || !s.companies || !s.sources) throw new Error('unexpected shape');
      out[key] = s;
    } catch (e) { out.warnings.push(`exchange store ${key}.json unreadable (${e.message}): every ${market} row unchecked`); }
  }
  return out;
}

/** Index of the newest board-history vintage dated before `before`: ticker -> pit block.
 * @param {string} [dir] board-history directory
 * @param {string} [before] ISO day (policy.restatementBaselineBefore)
 * @returns {{date:string|null, rows:Map<string,object>, warnings:string[]}} */
function loadBaseline(dir = path.join(ROOT, 'board-history'), before = policy.restatementBaselineBefore) {
  const res = { date: null, rows: new Map(), warnings: [] };
  let dates = [];
  try { dates = fs.readdirSync(dir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d < before).sort(); }
  catch (e) { res.warnings.push('board-history unreadable (' + e.message + '): no fill'); return res; }
  for (let k = dates.length - 1; k >= 0 && !res.date; k--) {
    const d = path.join(dir, dates[k]);
    for (const f of fs.readdirSync(d).filter(f => f.endsWith('.json')).sort()) {
      let j; try { j = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')); } catch (_) { continue; }
      for (const track of ['profitable', 'unprofitable']) for (const r of (j?.cohort?.[track] || [])) {
        if (r?.ticker && r.pit && Array.isArray(r.pit.revenueQ) && !res.rows.has(r.ticker)) res.rows.set(r.ticker, r.pit);
      }
    }
    if (res.rows.size) res.date = dates[k];
  }
  if (!res.date) res.warnings.push('no board-history vintage with pit blocks before ' + before + ': no fill');
  return res;
}

let defaultCtx = null;
/** Process-wide context for prepareSnapshot (loaded once, only outside mode off). @returns {object} */
function defaultContext() {
  if (!defaultCtx) {
    const stores = loadStores(), baseline = loadBaseline();
    stores.us = loadUsStore(stores.warnings);
    defaultCtx = { stores, baseline, warnings: [...stores.warnings, ...baseline.warnings] };
  }
  return defaultCtx;
}

// ── SEC quarter fill (US, G31 and G2) ────────────────────────────────────────
/** The SEC store. No file means no fill; a missing (with usFill on) or unreadable file is a warning, never an exception.
 * @param {string[]} warnings receives the warning
 * @param {string} [dir] store directory
 * @returns {object|null} parsed us.json */
function loadUsStore(warnings, dir = process.env.EXCHANGE_QUARTERS_DIR || path.join(ROOT, 'external-data', 'exchange-quarters')) {
  const file = path.join(dir, 'us.json');
  if (!fs.existsSync(file)) {
    // Codex R21: without this line a lost store would switch every fill off without a word.
    if (policy.usFill) warnings.push(`exchange store us.json missing in ${dir}: no SEC quarter fill in this run`);
    return null;
  }
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (s?.schemaVersion !== 1 || s.market !== 'US' || s.currency !== 'USD' || !s.companies || !s.sources) throw new Error('unexpected shape');
    return s;
  } catch (e) { warnings.push(`exchange store us.json unreadable (${e.message}): no SEC quarter fill`); return null; }
}

// Core revenue concepts in the store order; the first one that proves itself against the vendor wins.
const SEC_CONCEPTS = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet', 'RevenuesNetOfInterestExpense'];
const END_TOLERANCE_DAYS = 15;   // the vendor normalises fiscal ends to a month end (same bound as jahresVergleichIdx)
const MIN_NEWER_DAYS = 60;       // a really newer quarter ends about 90 days later; AAP's 2026-07-18 stands as 2026-06-30 at the vendor
const MAX_DURATION_DIFF_DAYS = 7; // a 14-week quarter against 13 weeks still is a quarter pair
const NOTED_DURATION_DIFF_DAYS = 3; // above this the hint says the two periods differ in length (Campbell's: 91 against 98)
const MIN_AGREEING_QUARTERS = 2;
const ALIAS_MIN_AGREEING = 3;     // another listing reads a firm's entry only on three agreeing quarters and none off
const { QUARTER_MIN_DAYS, QUARTER_MAX_DAYS, knownOn } = require('./sec-pit.js');
const SAME_DAY_TOL = 0.0002; // as RESTATEMENT_REL_TOL in lib/sec-pit.js
/** A real calendar day YYYY-MM-DD (2026-99-99 and 2026-02-30 are none). */
// Codex R4 on #85 (P2-D): only a string is a day; an array or a longer string never becomes one through coercion.
const validDay = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) &&!Number.isNaN(Date.parse(d + 'T00:00:00Z')) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
const dayNo = iso => Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z') / 864e5;
const DERIVATION_DE = { 'YTD-minus-YTD': 'aufgelaufener Wert minus kürzerer aufgelaufener Wert', 'year-minus-9M': 'Geschäftsjahr minus neun Monate', 'year-minus-three-quarters': 'Geschäftsjahr minus drei Quartale' };
const secFillReason = (cur, prior) => {
  const derived = [[cur, 'Der Quartalswert'], [prior, 'Der Vorjahreswert']].filter(([o]) => DERIVATION_DE[o.derivation])
    .map(([o, who]) => ` ${who} ist aus kumulierten Werten abgeleitet (${DERIVATION_DE[o.derivation]}).`).join('');
  const length = Math.abs(cur.days - prior.days) > NOTED_DURATION_DIFF_DAYS ? ` Die beiden Zeiträume sind verschieden lang: ${cur.days} Tage gegen ${prior.days} Tage im Vorjahr.` : '';
  return `Umsatz des Quartals bis ${day(cur.end)} fehlte beim Datenanbieter und stammt aus dem SEC-Bericht (${cur.form}, eingereicht ${day(cur.filed)}). Nur das Umsatzwachstum nutzt diesen Wert.${length}${derived}`;
};

/** Quarters of one concept as known on a day: per period the newest observation filed by then.
 * @param {object} c store company @param {string} concept @param {string} asOf YYYY-MM-DD @returns {object[]} {end, val, filed, days, derivation, ...} */
function secQuartersKnown(c, concept, asOf) {
  const out = [];
  // Codex R2 on #85 (P2-3): the board reader needs a data day; without one nothing is known, so nothing fills.
  if (!validDay(asOf)) return out;
  for (const [end, list] of Object.entries(c?.[concept] || {})) {
    // Codex R1 on #85 (2, 3): the newest filing known on the data day (from the first trading day after filing), never the
    // last one in arrival order; two different figures of that newest filing day leave the period open.
    const known = Array.isArray(list) ? list.filter(x => x?.filed && finite(x.val) && knownOn(x.filed, asOf)) : [];
    if (!known.length) continue;
    const marker = (x) => x.derivation === 'restatement-conflict';
    // Codex R5b on #85 (P1): once any conflict marker of the end is known, the end stays open; a newer stored figure (a later
    // repeat or an older run's derived quarter) never revives it. The writer dates a marker by the first day the end was open.
    const markers = known.filter(marker);
    if (markers.length) {
      const m = markers.reduce((a, x) => (x.filed > a.filed || (x.filed === a.filed && (x.val < a.val || (x.val === a.val && String(x.accn || '') < String(a.accn || '')))) ? x : a));
      out.push({ end, ...m });
      continue;
    }
    const top = known.reduce((a, x) => (x.filed > a ? x.filed : a), '');
    const same = known.filter(x => x.filed === top).sort((x, y) => x.val - y.val), o = same[0]; // order-free (Codex R2)
    // Codex R2 on #85 (P1-1): the tolerance is relative to the larger figure, so the verdict does not depend on the order.
    const split = !marker(o) && same.find(x => marker(x) || Math.abs(x.val - o.val) > SAME_DAY_TOL * Math.max(Math.abs(x.val), Math.abs(o.val)));
    out.push(split ? { end, ...o, derivation: 'restatement-conflict', conflictsWith: { val: split.val, filed: split.filed } } : { end, ...o });
  }
  return out;
}

/** Whether another core concept shows more revenue in the period of q and is not proven to be another definition than the vendor's.
 * @returns {boolean} true: q is only a part of the firm's revenue in that period */
function largerConcept(c, concept, q, cells, known, tol) {
  for (const other of SEC_CONCEPTS) {
    if (other === concept) continue;
    const qs = known(other), same = qs.find(x => Math.abs(dayNo(x.end) - dayNo(q.end)) <= END_TOLERANCE_DAYS && x.derivation !== 'restatement-conflict');
    if (!same || !(same.val > q.val * (1 + tol))) continue;
    let differs = 0;
    for (const cell of cells) {
      const o = qs.find(x => Math.abs(dayNo(x.end) - dayNo(cell.end)) <= END_TOLERANCE_DAYS);
      if (o && Math.abs(cell.value - o.val) > tol * Math.abs(o.val)) differs++;
    }
    if (differs < MIN_AGREEING_QUARTERS) return true;
  }
  return false;
}

// Per store and data day: every known quarter of every entry and concept, and all their values sorted with their owner.
// The store is read-only after loadUsStore, so the cache per store object stays valid.
const aliasIndexes = new WeakMap();
function aliasIndex(store, asOf) {
  let byDay = aliasIndexes.get(store);
  if (!byDay) aliasIndexes.set(store, (byDay = new Map()));
  if (byDay.has(asOf)) return byDay.get(asOf);
  const known = new Map(), pairs = [];
  for (const [ticker, entry] of Object.entries(store.companies)) {
    for (const concept of SEC_CONCEPTS) {
      const qs = secQuartersKnown(entry, concept, asOf);
      known.set(ticker + '|' + concept, qs);
      for (const q of qs) pairs.push([q.val, ticker]);
    }
  }
  pairs.sort((x, y) => x[0] - y[0]);
  const idx = { known, vals: pairs.map((x) => x[0]), owner: pairs.map((x) => x[1]) };
  byDay.set(asOf, idx);
  return idx;
}
const lowerBound = (arr, v) => { let lo = 0, hi = arr.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < v) lo = mid + 1; else hi = mid; } return lo; };

/**
 * The store entry of another listing of the same firm, proven by the data: every vendor quarter the entry covers agrees
 * within the tolerance, at least ALIAS_MIN_AGREEING of them, in USD, and all matching entries share one CIK.
 * A name or a ticker root alone never links (Codex R21, finding 3).
 * @param {object} s snapshot @param {object|null} store @param {number} tol @returns {{entry: object, ticker: string}|null}
 */
function usAlias(s, store, tol) {
  const m = s?.meta || {};
  // Codex R2 on #85 (P2-2): the link is evidence by figures only, so it stays limited to listings of US-seated firms (R21);
  // firms seated abroad are not asked at SEC either (scripts/fetch-exchange-quarters.js usCandidates), a named gap.
  if (!store?.companies || m.country !== 'United States' || !String(m.ticker || '').includes('.')) return null;
  const env = q4().envelope(s);
  if (!env || env.currency !== 'USD' || env.factor !== 1) return null;
  const rows = s.timeseries?.revenueQ, ends = s.timeseries?.revenueQEnds;
  if (!Array.isArray(rows) || !Array.isArray(ends) || rows.length !== ends.length) return null;
  const cells = rows.map((r, i) => ({ end: ends[i], value: valueOf(r) })).filter(x => finite(x.value) && x.value > 0 && finite(dayNo(x.end)));
  if (cells.length < ALIAS_MIN_AGREEING) return null;
  const asOf = String(m.asOf || m.fetchedAt || '').slice(0, 10), hits = [];
  // Only store entries holding a quarter value within the tolerance of one vendor cell can reach three agreeing quarters,
  // so the exact check below runs on those alone (same result as the full pass over about 1,250 firms, a fraction of the time).
  const idx = aliasIndex(store, asOf), cand = new Set();
  for (const cell of cells) {
    for (let i = lowerBound(idx.vals, cell.value / (1 + tol)); i < idx.vals.length && idx.vals[i] <= cell.value / (1 - tol); i++) cand.add(idx.owner[i]);
  }
  for (const ticker of [...cand].sort()) {
    const entry = store.companies[ticker];
    for (const concept of SEC_CONCEPTS) {
      const qs = idx.known.get(ticker + '|' + concept) || [];
      let agree = 0, differ = 0;
      for (const cell of cells) {
        const q = qs.find(x => Math.abs(dayNo(x.end) - dayNo(cell.end)) <= END_TOLERANCE_DAYS);
        if (q) { if (Math.abs(cell.value - q.val) <= tol * Math.abs(q.val)) agree++; else differ++; }
      }
      if (!differ && agree >= ALIAS_MIN_AGREEING) { hits.push({ ticker, entry }); break; }
    }
  }
  return new Set(hits.map(h => h.entry.cik || h.ticker)).size === 1 ? hits[0] : null;
}

/**
 * Whether the SEC store holds a filed quarter newer than the vendor's newest one, on the vendor's own definition.
 * The concept must agree with the vendor on at least two stored quarters and on none disagree; both quarters of the
 * pair come from that concept, in USD, about one year apart and of about equal length.
 * @param {object} s snapshot after the hand tables, own markers removed
 * @param {object|null} store parsed us.json
 * @param {object} [opt] {tolerance}
 * @returns {object|null} null without a store entry, else {ticker, market, category, why, fill}
 */
function evaluateUs(s, store, opt = {}) {
  const m = s?.meta || {}, tol = opt.tolerance ?? policy.tolerance;
  // Codex R21 (3): another listing of the same firm (AMZN.SW, 1AMZN.MI) reads the entry its vendor quarters prove.
  const own = store?.companies?.[m.ticker], alias = own ? null : usAlias(s, store, tol);
  const c = own || alias?.entry;
  if (!c) return null;
  // Codex R3 on #85: a snapshot that names its own CIK must name the entry's. (Own entries exist for US-seated firms only:
  // scripts/fetch-exchange-quarters.js asks no other, and the committed store of 31.10.2026 holds no other.)
  if (m.cik && c.cik && String(m.cik).padStart(10, '0') !== String(c.cik).padStart(10, '0')) return null;
  const res = { ticker: m.ticker, market: 'US', category: 'unchecked', why: null, fill: null };
  const un = why => { res.why = why; return res; };
  // An old store only warns: a filed number does not age and the fill lapses by itself once the vendor delivers the quarter,
  // while switching the fills off would throw the rows back to older quarters against G31.
  // The data day moves on a price-only day, fetchedAt does not, so all rows of one day judge the store alike.
  const stale = usStoreWarning(store, m.asOf || m.fetchedAt);
  if (stale) res.storeWarning = stale;
  const env = q4().envelope(s);
  if (!env || env.currency !== 'USD' || env.factor !== 1) return un('currency');
  // Blind review 07.11.2026 (M1): another listing follows the hand table of the listing whose entry it reads.
  if (handTableAuthority(s) || (alias && handTickers.has(alias.ticker))) { return un('hand-table'); }
  const rows = s.timeseries?.revenueQ, ends = s.timeseries?.revenueQEnds;
  if (!Array.isArray(rows) || !Array.isArray(ends) || !rows.length || rows.length !== ends.length) return un('vendor-series');
  if (!rows.every(r => q4().validUnit(r, 'USD'))) return un('unit');
  const cells = rows.map((r, i) => ({ end: ends[i], value: valueOf(r) })).filter(x => finite(x.value) && finite(dayNo(x.end)));
  if (!cells.length) return un('no-vendor-quarter');
  const vendorNewest = cells.map(x => x.end).sort().pop();
  // The data day of this snapshot: a price-only day moves asOf, fetchedAt stays on the last full pull.
  // Codex R5 on #85 (P2-D): a plain day or a full ISO timestamp that parses; '…Tgarbage' or '…T99:99:99Z' is no data day.
  const rawDay = m.asOf || m.fetchedAt;
  const asOf = typeof rawDay === 'string' && /^\d{4}-\d{2}-\d{2}(T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/.test(rawDay) && Number.isFinite(Date.parse(rawDay)) ? rawDay.slice(0, 10) : '';
  if (!validDay(asOf)) return un('no-data-day'); // Codex R2/R3 on #85 (P2-3, P2): hold, never open, also for an impossible day
  // What the row shows without the fill: an annual leg here is the fiscal year the fill has to be measured against.
  const shown = g31Shadow(s).v1;
  const annualEnd = ['year', 'yearNewerRecord'].includes(shown.basis) ? shown.sourcePeriodEnd : null;
  const near = (quarters, target) => {
    let best = null, bestGap = Infinity;
    for (const q of quarters) { const gap = Math.abs(dayNo(q.end) - target); if (gap <= END_TOLERANCE_DAYS && gap < bestGap) { best = q; bestGap = gap; } }
    return best;
  };
  let why = 'no-newer-quarter';
  const known = concept => secQuartersKnown(c, concept, asOf);
  for (const concept of SEC_CONCEPTS) {
    const all = known(concept);
    if (!all.length) continue;
    const newest = all.reduce((a, b) => (b.end > a.end ? b : a));
    // Codex R21 (2): an open restatement leaves its period empty; a newest period in that state means no fill.
    const quarters = all.filter(q => q.derivation !== 'restatement-conflict');
    if (dayNo(newest.end) - dayNo(vendorNewest) < MIN_NEWER_DAYS) continue;
    if (newest.derivation === 'restatement-conflict') { why = 'restatement-open'; continue; }
    const cur = newest;
    let agreeing = 0, disagreeing = 0;
    for (const cell of cells) {
      const q = near(quarters, dayNo(cell.end));
      if (q) { if (Math.abs(cell.value - q.val) <= tol * Math.abs(q.val)) agreeing++; else disagreeing++; }
    }
    if (disagreeing) { why = 'concept-disagrees'; continue; }
    if (agreeing < MIN_AGREEING_QUARTERS) { why = 'too-few-agreeing-quarters'; continue; }
    const prior = near(quarters, dayNo(cur.end) - 365);
    if (!prior) { why = 'no-year-ago-quarter'; continue; }
    if (Math.abs(cur.days - prior.days) > MAX_DURATION_DIFF_DAYS) { why = 'durations-differ'; continue; }
    // Codex R21 (2): equal length is not enough, both have to be quarters (two times 184 days passed the difference test).
    if (![cur, prior].every(q => q.days >= QUARTER_MIN_DAYS && q.days <= QUARTER_MAX_DAYS)) { why = 'not-a-quarter'; continue; }
    if (!(cur.val > 0) || !(prior.val > 0)) { why = 'not-positive'; continue; }
    // Codex R21 (1): agreement on old quarters does not prove the new one is still the whole revenue (APLD: services
    // 262.8 against total 341.9 Mio. USD). Another core concept larger in the same period means a part; it is set aside
    // only where it measurably is another definition than the vendor's (it disagrees where this concept agrees).
    // Blind review 07.11.2026 (M2): an open restatement of the period in any concept leaves the period empty, so neither
    // a second concept with the older figure nor a part beside a total under restatement can fill it.
    if ([cur, prior].some(q => SEC_CONCEPTS.some(o => known(o).some(x => x.derivation === 'restatement-conflict'
      && Math.abs(dayNo(x.end) - dayNo(q.end)) <= END_TOLERANCE_DAYS)))) { why = 'restatement-open'; continue; }
    if ([cur, prior].some(q => largerConcept(c, concept, q, cells, known, tol))) { why = 'part-of-revenue'; continue; }
    // A fiscal year truly newer than the fill keeps the row on the year: no hint, no record, no bonus input.
    if (annualEnd && dayNo(annualEnd) - dayNo(cur.end) > END_TOLERANCE_DAYS) { why = 'annual-newer'; continue; }
    const conf = lastConf(cur);
    res.category = 'sec-fill';
    // sourceEnd: within the tolerance it is the same period end (MSC's 52-week year ends 29.08., the vendor says 31.08.), so
    // the vendor's end is the computational one and two days of date difference do not decide the basis. end stays the label.
    res.fill = { concept, cik: c.cik || null, aliasOf: alias ? alias.ticker : null, end: cur.end, sourceEnd: annualEnd && annualEnd > cur.end ? annualEnd : cur.end, priorEnd: prior.end, current: cur.val, prior: prior.val, days: cur.days, priorDays: prior.days,
      form: cur.form, filed: cur.filed, accn: cur.accn ?? null, derivation: cur.derivation, priorForm: prior.form, priorFiled: prior.filed,
      priorAccn: prior.accn ?? null, priorDerivation: prior.derivation, vendorNewestEnd: vendorNewest, agreeingQuarters: agreeing,
      currency: 'USD', fetchedAt: conf?.fetchedAt ?? null, reason: secFillReason(cur, prior) };
    return res;
  }
  return un(why);
}

// ── Exchange series of one company ───────────────────────────────────────────
const prevQuarterEnd = p => ({ '06-30': '03-31', '09-30': '06-30', '12-31': '09-30' })[p.slice(5)];
const lastObs = list => Array.isArray(list) && list.length ? list[list.length - 1] : null;
const lastConf = o => (o && Array.isArray(o.confirmedBy) && o.confirmedBy.length ? o.confirmedBy[o.confirmedBy.length - 1] : null);

function chinaSeries(store, ticker, c) {
  const latest = {}, tables = new Set();
  let restated = false;
  for (const [p, list] of Object.entries(c.ytd || {})) {
    const o = lastObs(list);
    if (!o) continue;
    latest[p] = o; tables.add(o.table);
    if (list.length > 1) restated = true;
  }
  if (tables.size !== 1) return { why: tables.size ? 'mixed-table' : 'no-store-entry' };
  const table = [...tables][0];
  const stratum = table === 'SINCOME' ? 'broker' : table === 'GINCOME' ? 'general' : null;
  if (!stratum) return { why: 'unknown-table' };
  const lines = stratum === 'broker' ? ['operate'] : ['total', 'operate'];
  const quarters = {}, fy = {};
  for (const line of lines) {
    const single = S.chinaSingleQuarters(latest, line);
    if (!single) return { why: 'fiscal-year-chain' };
    // One fetch vintage per derived quarter: both YTD operands last read by the same run.
    for (const p of Object.keys(single)) {
      const prev = prevQuarterEnd(p);
      if (prev && latest[p.slice(0, 5) + prev] &&
          S.lastConfirmedAt(store, ticker, p) !== S.lastConfirmedAt(store, ticker, p.slice(0, 5) + prev)) single[p] = null;
    }
    quarters[line] = single;
    fy[line] = Object.fromEntries(Object.entries(latest).filter(([p]) => p.endsWith('-12-31'))
      .map(([p, o]) => [p, finite(o[line]) ? o[line] : null]));
  }
  const provenance = p => {
    const o = latest[p], conf = lastConf(o);
    return o ? { period: p, reportType: o.reportType, noticeDate: o.noticeDate || null, src: conf?.src || null,
      fetchedAt: (conf && store.sources?.[conf.src]?.fetchedAt) || null } : null;
  };
  return { stratum, lines, quarters, fy, restated, floor: 0.005, source: 'Eastmoney RPT_F10_FINANCE_' + table,
    sourceLabel: 'Eastmoney', latest, provenance };
}

function taiwanSeries(store, c) {
  const latest = {}, lines = new Set();
  let restated = false;
  for (const [k, list] of Object.entries(c.seasons || {})) {
    const o = lastObs(list);
    if (!o) continue;
    latest[k] = o; lines.add(o.line);
    if (list.length > 1) restated = true;
  }
  if (lines.size !== 1) return { why: lines.size ? 'mixed-line' : 'no-store-entry' };
  const line = [...lines][0];
  const stratum = line === '營業收入合計' ? 'general' : line === '收益合計' ? 'broker' : null;
  if (!stratum) return { why: 'unknown-line' };
  const fy = {};
  // Oldest season first: a newer filing's comparative overwrites an older filing's value.
  for (const k of Object.keys(latest).sort()) {
    const m = /^(\d+)Q4$/.exec(k);
    const v = m && S.taiwanSeasonValues(latest[k], Number(m[1]), 4);
    if (!v) continue;
    const y = Number(m[1]) + S.ROC_OFFSET;
    if (finite(v.priorFy)) fy[(y - 1) + '-12-31'] = v.priorFy;
    if (finite(v.fy)) fy[y + '-12-31'] = v.fy;
  }
  const keyOf = p => (Number(p.slice(0, 4)) - S.ROC_OFFSET) + 'Q' + (Number(p.slice(5, 7)) / 3);
  const provenance = p => {
    const k = keyOf(p), o = latest[k], conf = lastConf(o);
    return o ? { period: p, season: k, noticeDate: null, src: conf?.src || null, fetchedAt: conf?.fetchedAt || null } : null;
  };
  return { stratum, lines: ['printed'], quarters: { printed: S.taiwanSingleQuarters(latest) }, fy: { printed: fy },
    restated, floor: 500, source: 'MOPS t164sb04', sourceLabel: 'MOPS', latest, keyOf, provenance };
}

function exchangeSeries(store, market, ticker) {
  const c = store.companies[ticker];
  if (!c) return { why: 'no-store-entry' };
  try { return market === 'CN' ? chinaSeries(store, ticker, c) : taiwanSeries(store, c); }
  catch (e) { return { why: 'store-entry-invalid' }; }
}

// ── Same figures on another listing (Codex R23, finding 2) ──────────────────
const SIBLING_MIN_AGREEING = 3;   // three quarters equal within the tolerance, more than are off: the same reported figures
const siblingIndexes = new WeakMap();
function siblingIndex(ctx) {
  let idx = siblingIndexes.get(ctx);
  if (idx) return idx;
  idx = [];
  for (const market of ['CN', 'TW']) {
    const store = ctx.stores?.[market.toLowerCase()];
    for (const ticker of Object.keys(store?.companies || {})) {
      const x = exchangeSeries(store, market, ticker);
      if (!x.why) idx.push({ ticker, currency: store.currency, floor: x.floor, lines: x.lines.map(l => x.quarters[l]) });
    }
  }
  siblingIndexes.set(ctx, idx);
  return idx;
}
/**
 * The CN/TW listings whose exchange figures this listing carries: in the store's currency, at least three vendor quarters
 * agree within the tolerance on one line, more than are off (a quarter that is off is what the gate itself judges). Data, never the Yahoo country or name, links the listings.
 * ponytail: a linear pass over about 3,750 store firms, built once per context; only listings that reach the older-pair walk ask.
 * @param {object} s snapshot without own markers @param {object} ctx context with stores @param {object} [opt] {tolerance}
 * @returns {string[]} tickers, empty when none or for a CN/TW listing itself
 */
function exchangeSiblings(s, ctx, opt = {}) {
  const t = s?.meta?.ticker || '';
  if (/\.(SS|SZ|TW|TWO)$/.test(t)) return [];
  const env = q4().envelope(s);
  const rows = s?.timeseries?.revenueQ, ends = s?.timeseries?.revenueQEnds;
  if (!env || !Array.isArray(rows) || !Array.isArray(ends) || rows.length !== ends.length) return [];
  const tol = opt.tolerance ?? policy.tolerance;
  const native = rows.map(r => finite(valueOf(r)) ? valueOf(r) / env.factor : null);
  const out = [];
  for (const e of siblingIndex(ctx)) {
    if (e.currency !== env.currency) continue;
    for (const xq of e.lines) {
      let agree = 0, off = 0;
      for (let i = 0; i < ends.length; i++) {
        const v = native[i], x = xq[ends[i]];
        if (!finite(v) || !finite(x) || !(x > 0)) continue;
        if (Math.abs(v - x) <= Math.max(tol * Math.abs(x), e.floor)) agree++; else off++;
      }
      if (agree >= SIBLING_MIN_AGREEING && agree > off) { out.push(e.ticker); break; }
    }
  }
  return out;
}

// ── Context checks ───────────────────────────────────────────────────────────
const listed = (x, t) => x.ticker === t || (x.listingAliases || []).includes(t);
const handTickers = new Set([
  ...[...financialTable.cases, ...financialTable.coverage, ...financialTable.quarantines].flatMap(x => [x.ticker, ...(x.listingAliases || [])]),
  ...q4Table.cases.flatMap(c => c.listingAliases),
]);
/** Hand tables keep authority: any listed case or any foreign marker on a revenue cell. */
function handTableAuthority(s) {
  if (handTickers.has(s.meta.ticker)) return true;
  for (const rows of [s.timeseries?.revenueQ, s.annual?.annualRev]) for (const r of Array.isArray(rows) ? rows : []) {
    if (r && typeof r === 'object' && (r.yahooQ4Correction || r.financialCorrection ||
        (r.financialMissing && !OWN_CODES.has(r.financialMissing.reasonCode)))) return true;
  }
  return false;
}
const bankOrInsurer = m => /^(Banks|Insurance)\b|Financial Conglomerates/.test(m.industry || '');

// fetchedAt of the newest run that read each company again, built once per store object. A run counts for a
// company only when it read one of the company's own keys (China: a listed period the company has and is not
// absent for; Taiwan: a 'ticker season' entry in the run's read list).
const readIndex = new WeakMap();
function companyReadAt(store, ticker) {
  let idx = readIndex.get(store);
  if (!idx) {
    idx = new Map();
    const up = (tk, at) => { if (at && !(idx.get(tk) >= at)) idx.set(tk, at); };
    for (const s of Object.values(store.sources || {})) {
      if (store.market === 'CN') {
        const absent = Object.fromEntries(Object.entries(s.absent || {}).map(([p, list]) => [p, new Set(list)]));
        for (const [tk, c] of Object.entries(store.companies || {})) {
          if ((s.periods || []).some(p => c.ytd?.[p] && !absent[p]?.has(tk))) up(tk, s.fetchedAt);
        }
      } else {
        for (const r of s.read || []) up(String(r).split(' ')[0], s.fetchedAt);
      }
    }
    readIndex.set(store, idx);
  }
  return idx.get(ticker) || null;
}

const storeAgeLimit = atMs => {
  const md = new Date(atMs).toISOString().slice(5, 10);
  return md >= '10-15' && md <= '11-20' ? policy.maxStoreAgeDaysInSeason : policy.maxStoreAgeDays;
};
/** Days from the newest run of a market to a snapshot time.
 * @param {object} store parsed store @param {string} atIso snapshot time @returns {number|null} null when either time is unknown */
function storeAgeDays(store, atIso) {
  const at = Date.parse(atIso || '');
  const newest = Math.max(...Object.values(store.sources || {}).map(s => Date.parse(s.fetchedAt)).filter(finite));
  return finite(at) && finite(newest) ? (at - newest) / 864e5 : null;
}
/** Whether the newest run of a market lies further back than the limit, or either time is unknown.
 * @param {object} store parsed store @param {string} atIso snapshot time @returns {boolean} */
function marketStoreOld(store, atIso) {
  const age = storeAgeDays(store, atIso);
  return age === null || age > storeAgeLimit(Date.parse(atIso));
}
/** The line for the daily run when the SEC store is older than the limit. The fills stay.
 * @param {object} store parsed us.json @param {string} atIso data day of the snapshot @returns {string|null} null while fresh */
function usStoreWarning(store, atIso) {
  if (!marketStoreOld(store, atIso)) return null;
  const age = storeAgeDays(store, atIso);
  const old = age === null ? 'of unknown age' : `${age.toFixed(1)} days old at the data day (limit ${storeAgeLimit(Date.parse(atIso))})`;
  return `SEC store us.json is ${old}: the US pass of exchange-quarters.yml has not written since. The fills stay; filings after its newest run are not read.`;
}

/** Identify global or company-level store age and companies never delivered by the source.
 * @param {object} store parsed China or Taiwan store
 * @param {object} m snapshot metadata with ticker and fetchedAt
 * @returns {false|'store-old'|'no-own-read'} false when fresh or the company has no store entry */
function storeTooOld(store, m) {
  if (marketStoreOld(store, m.fetchedAt)) return 'store-old';
  const at = Date.parse(m.fetchedAt), limit = storeAgeLimit(at);
  // The newest run of the market says nothing about a company it did not read (partial Taiwan passes).
  const c = store.companies?.[m.ticker];
  if (!c) return false; // no entry: reported as no-store-entry further down
  const readAt = companyReadAt(store, m.ticker);
  if (readAt === null && !Object.values((store.market === 'CN' ? c.ytd : c.seasons) || {})
      .some(list => Array.isArray(list) && list.length)) return 'no-own-read';
  const own = Date.parse(readAt || '');
  // Observations without a matching run read are inconsistent and conservatively stay store-old.
  return !finite(own) || (at - own) / 864e5 > limit ? 'store-old' : false;
}

// ── Evaluation ───────────────────────────────────────────────────────────────
/**
 * What the step would do with one prepared snapshot (no change to the input).
 * @param {object} s snapshot after the hand tables, own markers removed
 * @param {object} ctx {stores, baseline}
 * @param {object} [opt] {tolerance}
 * @returns {object|null} null outside the China/Taiwan cohorts; else {ticker, market, category, why,
 *   stratum, line, pairs, withhold, fill, growth, ...}. category: agree | would-withhold |
 *   would-withhold-growth | would-fill | unchecked
 */
function evaluate(s, ctx, opt = {}) {
  const m = s?.meta || {}, t = m.ticker;
  const market = /\.(SS|SZ)$/.test(t || '') ? 'CN' : /\.(TW|TWO)$/.test(t || '') ? 'TW' : null;
  if (!market) return null;
  const tol = opt.tolerance ?? policy.tolerance;
  const res = { ticker: t, market, category: 'unchecked', why: null, stratum: null, line: null, pairs: [],
    withhold: [], fill: null, growth: null, outsideDisagree: [], fillPeriodVendorDisagrees: false };
  const store = ctx.stores?.[market.toLowerCase()];
  const un = why => {
    res.why = why;
    if (UNCHECKED_TEXT[why]) res.whyText = UNCHECKED_TEXT[why];
    if (why === 'no-own-read') res.noDataCodes = [...new Set(Object.values(store.companies[t].noData || {})
      .map(d => d?.code).filter(Boolean))].sort();
    return res;
  };
  if (!store) return un('store-missing');
  const age = storeTooOld(store, m);
  if (age) return un(age);
  if (bankOrInsurer(m)) return un('bank-insurer');
  const env = q4().envelope(s);
  if (!env) return un('envelope');
  if (env.currency !== store.currency) return un('currency');
  if (handTableAuthority(s)) return un('hand-table');
  const rows = Array.isArray(s.timeseries?.revenueQ) ? s.timeseries.revenueQ : [];
  const ends = Array.isArray(s.timeseries?.revenueQEnds) ? s.timeseries.revenueQEnds : [];
  if (!rows.length || ends.length !== rows.length) return un('vendor-series');
  if (!rows.every(r => q4().validUnit(r, env.storedCurrency))) return un('unit');
  const x = exchangeSeries(store, market, t);
  if (x.why) return un(x.why);
  res.stratum = x.stratum;
  res.source = x.source;
  const native = rows.map(r => finite(valueOf(r)) ? valueOf(r) / env.factor : null);
  const agree = (v, e) => finite(v) && finite(e) && Math.abs(v - e) <= Math.max(tol * Math.abs(e), x.floor);
  // One line per company: the one that matches the newest vendor quarter, TOTAL on a tie.
  let line = x.lines[0];
  if (x.lines.length > 1) {
    const i0 = native.findIndex((v, i) => v !== null && finite(x.quarters[x.lines[0]][ends[i]]));
    if (i0 >= 0 && !agree(native[i0], x.quarters[line][ends[i0]]) && agree(native[i0], x.quarters[x.lines[1]][ends[i0]])) line = x.lines[1];
  }
  res.line = line;
  const xq = x.quarters[line];
  const ex = ends.map(e => finite(xq[e]) ? xq[e] : null);
  const ratioAgree = (a, b) => a.every(finite) && b.every(finite) && b[0] > 0 && b[1] > 0 &&
    Math.abs((a[0] / b[0]) / (a[1] / b[1]) - 1) <= tol;
  const pairAgree = (v, e) => x.stratum === 'broker' ? ratioAgree(v, e) : agree(v[0], e[0]) && agree(v[1], e[1]);

  for (let i = 0; i < rows.length; i++) {
    const v = jahresVergleichIdx(s, 'revenueQ', i);
    if (!v || v.quelle !== 'datum' || v.idx >= rows.length) continue;
    const j = v.idx;
    if (native[i] === null || native[j] === null) continue;
    const p = { i, j, end: ends[i], priorEnd: ends[j], level: i === 0, vendor: [native[i], native[j]], exchange: [ex[i], ex[j]] };
    p.status = ex[i] === null || ex[j] === null ? 'unchecked' : pairAgree(p.vendor, p.exchange) ? 'agree' : 'mixed';
    if (x.stratum === 'broker' && p.status !== 'unchecked') p.ratio = [native[i] / ex[i], native[j] / ex[j]];
    res.pairs.push(p);
  }
  const mixed = res.pairs.filter(p => p.status === 'mixed');
  res.withhold = [...new Set(mixed.map(p => p.j))].sort((a, b) => a - b).map(j => ({
    index: j, period: ends[j], level: mixed.some(p => p.j === j && p.level),
    vendorNative: native[j], exchangeNative: ex[j] }));
  if (x.stratum === 'general') {
    const inPair = new Set(res.pairs.flatMap(p => [p.i, p.j]));
    res.outsideDisagree = native.map((v, i) => v !== null && ex[i] !== null && !agree(v, ex[i]) && !inPair.has(i) ? ends[i] : null).filter(Boolean);
  }
  // F5: a fill-period quarter the vendor delivered AFTER the baseline vintage (the company is in the vintage, the
  // quarter is absent or null there) is withheld when it misses the exchange figure, wherever it sits (general
  // stratum only: a broker's level gap is definition). A cell the baseline already carried was on time: outside a
  // pair it stays (G1) and is only counted. The newest quarter is never withheld (G1).
  for (const P of x.stratum === 'general' ? policy.fillPeriods : []) {
    const k = ends.indexOf(P);
    if (k > 0 && native[k] !== null && ex[k] !== null && !agree(native[k], ex[k])) {
      res.fillPeriodVendorDisagrees = true;
      if (deliveredAfterBaseline(s, P, env, ctx) && !res.withhold.some(w => w.index === k)) {
        res.withhold.push({ index: k, period: P, level: false, fillPeriod: true, vendorNative: native[k], exchangeNative: ex[k] });
      }
    }
  }
  res.withhold.sort((a, b) => a.index - b.index);

  if (res.withhold.length) {
    res.category = 'would-withhold';
    // G4: the annual leg is checked when the guard moves growth onto it: always for the level pair, and for a
    // withheld fill-period cell only when it took the quarterly leg away (gap rule), not when growth was annual anyway.
    const level = res.withhold.some(w => w.level);
    if (level || res.withhold.some(w => w.fillPeriod)) {
      const guarded = withholdQuarters(s, res);
      const interim = b => b === 'quarter' || b === 'halfYear'; // P267: a half-year pair is an interim leg too
      if (level || (interim(revGrowthLeg(s).basis) && !interim(revGrowthLeg(guarded).basis))) {
        res.growth = annualCheck(guarded, env, x, line, tol, agree);
        if (!['agree', 'none', 'quarter'].includes(res.growth.status)) res.category = 'would-withhold-growth';
      }
    }
    return res;
  }
  res.fill = fillCheck(s, res, x, ends, native, ex, xq, agree, env, ctx);
  if (res.fill && !res.fill.blocked) res.category = 'would-fill';
  else if (res.pairs.some(p => p.status === 'agree')) res.category = 'agree';
  else res.why = 'no-checkable-pair';
  return res;
}

function annualCheck(g, env, x, line, tol, agree) {
  const leg = revGrowthLeg(g);
  const out = { basisAfter: leg.basis, periodEnd: leg.periodEnd, priorPeriodEnd: leg.priorPeriodEnd, vendor: null, exchange: null, status: null };
  if (leg.basis === 'none' || leg.basis === 'quarter' || leg.basis === 'halfYear') { out.status = leg.basis; return out; }
  let vendor, endsUsed;
  if (leg.basis === 'yearNewerRecord') {
    const n = g.meta.annualRevNewerYear; // revenues in the native statement currency (src/scoring/axes.js:108-109)
    vendor = [n.revenue, n.priorRevenue]; endsUsed = [leg.periodEnd, leg.priorPeriodEnd];
  } else {
    const ar = norm(g, 'annualRev');
    vendor = [ar[0] / env.factor, ar[1] / env.factor];
    // Undated vendor years: compared by value with the two newest exchange full years (a match proves the pair).
    const fyEnds = Object.keys(x.fy[line]).filter(p => finite(x.fy[line][p])).sort().reverse();
    endsUsed = leg.periodEnd && leg.priorPeriodEnd ? [leg.periodEnd, leg.priorPeriodEnd] : fyEnds.slice(0, 2);
  }
  out.vendor = vendor; out.periodsChecked = endsUsed;
  out.exchange = (endsUsed || []).map(p => finite(x.fy[line][p]) ? x.fy[line][p] : null);
  if (out.exchange.length !== 2 || out.exchange.some(v => v === null) || !vendor.every(finite)) { out.status = 'not-checkable'; return out; }
  const ok = x.stratum === 'broker'
    ? out.exchange.every(v => v > 0) && Math.abs((vendor[0] / out.exchange[0]) / (vendor[1] / out.exchange[1]) - 1) <= tol
    : agree(vendor[0], out.exchange[0]) && agree(vendor[1], out.exchange[1]);
  out.status = ok ? 'agree' : 'mixed';
  return out;
}

// True only when the baseline vintage has the company (same currency) but not this quarter: a proven late delivery.
// No baseline row proves nothing, so nothing is withheld on that ground.
function deliveredAfterBaseline(s, period, env, ctx) {
  const pit = ctx.baseline?.rows?.get(s.meta.ticker);
  if (!pit || (pit.reportingCurrencyOriginal && pit.reportingCurrencyOriginal !== env.currency)) return false;
  const k = (pit.revenueQEnds || []).indexOf(period);
  return !(k >= 0 && finite(pit.revenueQ[k]));
}

function baselineCheck(s, ends, native, env, ctx, year) {
  const pit = ctx.baseline?.rows?.get(s.meta.ticker);
  if (!pit || (pit.reportingCurrencyOriginal && pit.reportingCurrencyOriginal !== env.currency)) return 'no-baseline';
  const f = finite(pit.fxRateApplied) && pit.fxRateApplied > 0 ? pit.fxRateApplied : 1;
  let overlap = 0, missing = 0;
  for (let i = 0; i < ends.length; i++) {
    if (native[i] === null || !String(ends[i]).startsWith(year + '-')) continue;
    const k = (pit.revenueQEnds || []).indexOf(ends[i]);
    const b = k >= 0 ? pit.revenueQ[k] : null;
    if (!finite(b)) { missing++; continue; } // absent or null in the vintage: unproven, not unchanged
    overlap++;
    if (Math.abs(native[i] - b / f) > 1e-9 * Math.max(Math.abs(native[i]), Math.abs(b / f)) + 1e-6) return 'vendor-2025-changed';
  }
  return !overlap ? 'no-baseline' : missing ? 'baseline-quarter-missing' : null;
}

/** A real calendar day YYYY-MM-DD (Codex R-pr124 R2 P2-1: '0000-00-00' and '2026-02-30' compare as strings). */
const isDay = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d + 'T00:00:00Z'))
  && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d && d >= '1990-01-01';
function fillCheck(s, res, x, ends, native, ex, xq, agree, env, ctx) {
  for (const P of policy.fillPeriods) {
    let k = ends.indexOf(P);
    if (k >= 0 && native[k] !== null) continue; // the vendor delivered
    const inserted = k < 0;
    if (inserted) {
      // Evaluate the same guards against a virtual empty row; only applyResult writes it.
      k = ends.findIndex(end => end < P);
      if (k < 0) k = ends.length;
      ends = [...ends.slice(0, k), P, ...ends.slice(k)];
      native = [...native.slice(0, k), null, ...native.slice(k)];
      ex = [...ex.slice(0, k), finite(xq[P]) ? xq[P] : null, ...ex.slice(k)];
    }
    const fill = { period: P, index: k, blocked: null, nativeValue: null, ...(inserted ? { inserted: true } : {}) };
    const nextYear = (Number(P.slice(0, 4)) + 1) + P.slice(4);
    const block = why => { fill.blocked = why; return fill; };
    if (x.stratum !== 'general') return block('not-general');
    if (k === 0 || native[0] === null || !(ends[0] > P)) return block('newest-cell');
    if (new Set(ends).size !== ends.length) return block('duplicate-quarter-end');   // Codex R-pr124 R2 P2-2
    if (x.restated) return block('restatement-signal');
    // No stored baseline blocks the fill; the shadow report still learns whether it was the only obstacle.
    const base = baselineCheck(s, ends, native, env, ctx, P.slice(0, 4));
    if (base && base !== 'no-baseline') return block(base);
    if (ends.some(e => !finite(xq[e]))) return block('store-period-missing');
    if (native.some((v, i) => v !== null && !agree(v, ex[i]))) return block('neighbour-disagrees');
    if (!(xq[P] > 0)) return block('exchange-quarter-not-positive');
    // November rule: once the next-year quarter is reported, Q3 of the fill year must be on that report's basis.
    if (res.market === 'CN' && x.latest[nextYear]) {
      const notice = x.latest[nextYear].noticeDate;
      if (!isDay(notice) || !(x.latest[P].confirmedBy || []).some(c => isDay(c.updateDate) && c.updateDate >= notice)) return block('november-not-confirmed');
      // sd-quellen 12.11.2026 (Codex R-pr124 R1-R3): Q3 = 9M - H1 needs both operands on one reporting basis, and no
      // date check proves that (an unchanged 9M only gives dH1 + dQ3 = 0, Codex R3 P1). The two guards below compare
      // stored date fields only and block risk signals, nothing more: the first stored confirmation's UPDATE_DATE is not
      // before the next-year notice (the row may already carry that report's restatement; the notice is a Beijing day),
      // or it differs from the 9M observation's own notice date (Eastmoney had rewritten the row). The fetch time is not
      // checked, and an equal date does not prove that no new version appeared on that day. Measured 07.11.: 13 of 1,099
      // July-path fills blocked by the second. From Eastmoney's single-quarter table RPT_F10_FINANCE_GINCOMEQC no
      // independent evidence of the common basis was obtained: it equals 9M - H1 within one cent for 3,149 of 3,150
      // general A-shares on 12.11. (exception 600880.SH, its Q3-2026 row is missing in the store, mechanism unexplained).
      const firstUpdate = x.latest[P].confirmedBy?.[0]?.updateDate || '';
      if (!(isDay(firstUpdate) && firstUpdate < notice)) return block('november-read-late');
      const o = x.latest[P];
      if (!(isDay(o.noticeDate) && firstUpdate === o.noticeDate)) return block('rewritten-before-first-read');
    }
    if (res.market === 'TW' && x.latest[x.keyOf(nextYear)]) {
      const [roc, season] = x.keyOf(nextYear).split('Q').map(Number);
      const v = S.taiwanSeasonValues(x.latest[x.keyOf(nextYear)], roc, season);
      if (!v || !finite(v.priorQuarter)) return block('november-not-confirmed');
    }
    if (inserted && !insertQuarter(s, P, k, null)) return block('vendor-series');
    fill.nativeValue = xq[P];
    // sd-quellen 12.11.2026: a fill without a July row (vendor agreement as the only proof) was built and withdrawn:
    // no available source proves the common reporting basis of 9M and H1 (Codex R-pr124 R3 P1). It needs the
    // comparable Q3-2025 single quarter printed in the Q3-2026 report itself.
    if (base) { fill.otherwiseFillable = true; return block(base); }
    fill.derivation = res.market === 'CN' ? '9M-H1' : 'printed-quarter';
    fill.operands = res.market === 'CN' ? [x.provenance(P), x.provenance(P.slice(0, 5) + '06-30')]
      : [x.provenance(x.latest[x.keyOf(nextYear)] ? nextYear : P)];
    const op = fill.operands[0];
    fill.source = x.source;
    fill.dataDate = op?.noticeDate || null;
    fill.fetchedAt = op?.fetchedAt || null;
    fill.sourceId = op?.src || null;
    fill.reason = fillReason(P, x.sourceLabel, op?.noticeDate ? 'veröffentlicht ' + day(op.noticeDate) : 'abgerufen ' + day(op?.fetchedAt));
    return fill;
  }
  return null;
}

// Positional readers zip the quarterly bundle. Insert only into demonstrably aligned axes,
// carrying a null for every missing sibling value; keep a sibling already on the new axis.
// The saved arrays are only the fields this overlay changes, so stripping it preserves unrelated fields.
function insertQuarter(s, period, index, row) {
  const ts0 = s.timeseries, ends = ts0.revenueQEnds, n = ends.length;
  const date = end => typeof end === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(end) &&
    Number.isFinite(Date.parse(end)) && new Date(end).toISOString().slice(0, 10) === end;
  if (!ends.every(date) || ends.some((end, i) => i > 0 && end >= ends[i - 1])) return null;
  const splice = (list, item) => [...list.slice(0, index), item, ...list.slice(index)];
  const nextEnds = splice(ends, period), ts = { ...ts0 }, originals = {}, periodOriginals = {};
  const periods0 = s.meta?.statementPeriods;
  let periods = periods0;
  const save = (field, next) => { originals[field] = ts0[field]; ts[field] = next; };
  const movePeriods = (field, length, item) => {
    const list = periods0?.[field];
    if (!Array.isArray(list) || !list.length) return true;
    if (list.length !== length) return false;
    if (periods === periods0) periods = { ...periods0 };
    periodOriginals[field] = list; periods[field] = splice(list, item);
    return true;
  };
  save('revenueQ', splice(ts0.revenueQ, row)); save('revenueQEnds', nextEnds);
  if (!movePeriods('revenueQ', n, { end: period, duration: '3M', currency: q4().envelope(s).currency,
    unit: 'currency', basis: 'exchange-fill' })) return null;
  if (Array.isArray(ts0.reportedRevenueQEnds)) {
    if (ts0.reportedRevenueQEnds.length !== n) return null;
    save('reportedRevenueQEnds', splice(ts0.reportedRevenueQEnds, period));
  }
  const prefix = (list, axis) => list.length <= axis.length && list.every((end, i) => end === axis[i]);
  for (const field of ['opIncQ', 'grossProfitQ', 'netIncomeQ']) {
    const values = ts0[field];
    if (!Array.isArray(values) || !values.length) continue;
    const key = field + 'Ends', ownEnds = ts0[key];
    if (Array.isArray(ownEnds)) {
      if (ownEnds.length !== values.length) return null;
      if (ownEnds.includes(period) && prefix(ownEnds, nextEnds)) continue;
      if (!prefix(ownEnds, ends)) return null;
    }
    // Undated siblings use the vendor bundle's positional contract, including netIncomeQ.
    // A shorter array ending before the insertion has no older value to move.
    if (index > values.length) continue;
    save(field, splice(values, null));
    if (Array.isArray(ownEnds)) save(key, splice(ownEnds, period));
    if (!movePeriods(field, values.length, null)) return null;
  }
  return { snapshot: { ...s, timeseries: ts, ...(periods !== periods0 ? { meta: { ...s.meta, statementPeriods: periods } } : {}) },
    originalAligned: { timeseries: originals, statementPeriods: periodOriginals } };
}

// ── Copy-on-write application ────────────────────────────────────────────────
function writer(snapshot) {
  let out = snapshot;
  const put = (container, field, i, row) => {
    if (out === snapshot) out = { ...snapshot };
    if (out[container] === snapshot[container]) out[container] = { ...snapshot[container] };
    if (out[container][field] === snapshot[container][field]) out[container][field] = snapshot[container][field].slice();
    out[container][field][i] = row;
  };
  const meta = m => { if (out === snapshot) out = { ...snapshot }; out.meta = m; };
  return { put, meta, get: () => out };
}

function withholdQuarters(s, res) {
  const w = writer(s), rows = s.timeseries.revenueQ;
  const growthOff = res.growth && !['agree', 'none', 'quarter'].includes(res.growth.status);
  const levelText = growthOff ? REASONS.growth : res.growth?.status === 'none' ? REASONS.levelNoAnnual : REASONS.level;
  for (const h of res.withhold) {
    const row = rows[h.index];
    w.put('timeseries', 'revenueQ', h.index, { ...(row && typeof row === 'object' ? row : {}), value: null,
      financialMissing: { reasonCode: h.fillPeriod ? 'exchange-quarter-mismatch' : 'exchange-pair-mismatch',
        reason: h.fillPeriod ? REASONS.lateQuarter : h.level ? levelText : REASONS.acceleration,
        period: h.period, originalVendorRow: row,
        exchange: { nativeValue: h.exchangeNative, line: res.line, source: res.source, stratum: res.stratum } } });
  }
  return w.get();
}

/** Apply a result (active mode). @param {object} s stripped snapshot @param {object} res evaluate() result @returns {object} */
function applyResult(s, res) {
  if (!res) return s;
  if (res.withhold.length) {
    let out = withholdQuarters(s, res);
    if (res.category === 'would-withhold-growth') {
      const w = writer(out), rows = out.annual?.annualRev;
      // Every annual revenue cell older than the newest is withheld, so no reader pairs other years instead.
      (Array.isArray(rows) ? rows : []).forEach((row, i) => {
        if (i === 0 || !finite(valueOf(row))) return;
        w.put('annual', 'annualRev', i, { ...(row && typeof row === 'object' ? row : {}), value: null,
          financialMissing: { reasonCode: 'exchange-annual-mismatch', reason: REASONS.growth,
            period: out.annual.annualRevEnds?.[i] ?? null, originalVendorRow: row } });
      });
      out = w.get();
      if (out.meta?.annualRevNewerYear) {
        // Kept in place as null (key order unchanged); the original lives in meta.exchangeCheck.
        w.meta({ ...out.meta, annualRevNewerYear: null, exchangeCheck: { withheldAnnualRevNewerYear: out.meta.annualRevNewerYear } });
        out = w.get();
      }
    }
    return out;
  }
  if (res.category === 'would-fill') {
    const f = res.fill, row = f.inserted ? null : s.timeseries.revenueQ[f.index], env = q4().envelope(s);
    const w = writer(s);
    const cell = { ...(row && typeof row === 'object' ? row : {}), value: f.nativeValue * env.factor,
      exchangeFill: { period: f.period, nativeValue: f.nativeValue, nativeCurrency: env.currency, line: res.line,
        derivation: f.derivation, operands: f.operands, source: f.source, sourceId: f.sourceId, dataDate: f.dataDate,
        fetchedAt: f.fetchedAt, reason: f.reason, originalVendorRow: row } };
    if (f.inserted) {
      const insertion = insertQuarter(s, f.period, f.index, cell);
      if (!insertion) return s;
      cell.exchangeFill.insertedRow = true;
      cell.exchangeFill.originalAligned = insertion.originalAligned;
      return insertion.snapshot;
    }
    w.put('timeseries', 'revenueQ', f.index, cell);
    return w.get();
  }
  return s;
}

/** Remove the step's own markers and restore the original vendor cells.
 * @param {object} s snapshot
 * @returns {object} the same object when there is no marker, else a copy with the vendor cells restored */
function stripOwn(s) {
  if (!s || typeof s !== 'object') return s;
  const timeseries = Object.getOwnPropertyDescriptor(s, 'timeseries')?.value;
  const revenue = timeseries && Object.getOwnPropertyDescriptor(timeseries, 'revenueQ')?.value;
  for (const row of Array.isArray(revenue) ? revenue : []) {
    const saved = row?.exchangeFill?.insertedRow && row.exchangeFill.originalAligned;
    if (!saved) continue;
    s = { ...s, timeseries: { ...s.timeseries, ...saved.timeseries } };
    if (Object.keys(saved.statementPeriods || {}).length) s.meta = { ...s.meta,
      statementPeriods: { ...s.meta.statementPeriods, ...saved.statementPeriods } };
  }
  const w = writer(s);
  for (const [container, field] of [['timeseries', 'revenueQ'], ['annual', 'annualRev']]) {
    // Snapshots are JSON data: never execute an accessor here (same rule as lib/zero-financials-guard.js).
    const bundle = Object.getOwnPropertyDescriptor(s, container)?.value;
    const rows = bundle && Object.getOwnPropertyDescriptor(bundle, field)?.value;
    if (!Array.isArray(rows)) continue;
    rows.forEach((row, i) => {
      if (!row || typeof row !== 'object') return;
      if (row.exchangeFill) w.put(container, field, i, row.exchangeFill.originalVendorRow);
      else if (OWN_CODES.has(row.financialMissing?.reasonCode)) w.put(container, field, i, row.financialMissing.originalVendorRow);
    });
  }
  const m = Object.getOwnPropertyDescriptor(w.get(), 'meta')?.value;
  if (m && typeof m === 'object' && Object.hasOwn(m, 'exchangeCheck')) {
    const { exchangeCheck, ...rest } = m;
    if (exchangeCheck && Object.hasOwn(exchangeCheck, 'withheldAnnualRevNewerYear')) rest.annualRevNewerYear = exchangeCheck.withheldAnnualRevNewerYear;
    w.meta(rest);
  }
  const m2 = Object.getOwnPropertyDescriptor(w.get(), 'meta')?.value;
  if (m2 && typeof m2 === 'object' && Object.hasOwn(m2, 'secQuarterFill')) {
    const { secQuarterFill, ...rest } = m2;
    w.meta(rest);
  }
  return w.get();
}

/**
 * The step. Mode off: own markers removed, nothing else (the identical object when there are none).
 * @param {object} snapshot snapshot after the hand tables
 * @param {object} [options] {mode, context: {stores, baseline}, tolerance}
 * @returns {{snapshot:object, mode:string, result:object|null}}
 */
function applyExchangeCheck(snapshot, options = {}) {
  const mode = options.mode ?? policy.mode;
  if (!MODES.includes(mode)) throw new Error('Invalid exchange-quarter mode: ' + mode);
  const base = stripOwn(snapshot);
  if (mode === 'off' || !base?.meta?.ticker) return { snapshot: base, mode, result: null };
  if (options.usFill ?? policy.usFill) {
    const us = evaluateUs(base, (options.context || defaultContext()).stores?.us, options);
    if (us) {
      // Outside the series on purpose: an index-0 row without operating income would empty marginTrajectory and every positional reader.
      const fill = us.fill && mode !== 'shadow';
      return { snapshot: fill ? { ...base, meta: { ...base.meta, secQuarterFill: us.fill } } : base, mode, result: us };
    }
  }
  const result = evaluate(base, options.context || defaultContext(), options);
  const apply = mode === 'active' || (mode === 'fill-only' && result?.category === 'would-fill');
  return { snapshot: apply ? applyResult(base, result) : base, mode, result };
}

/** Additive board-history record of exchange-sourced or withheld cells (null when none).
 * @param {object} snapshot prepared snapshot @returns {object|null} */
function exchangeRecord(snapshot) {
  const filled = [], withheld = [];
  for (const [container, field] of [['timeseries', 'revenueQ'], ['annual', 'annualRev']]) {
    for (const row of Array.isArray(snapshot?.[container]?.[field]) ? snapshot[container][field] : []) {
      if (row?.exchangeFill) filled.push({ field, period: row.exchangeFill.period, nativeValue: row.exchangeFill.nativeValue,
        source: row.exchangeFill.source, dataDate: row.exchangeFill.dataDate, originalVendorValue: valueOf(row.exchangeFill.originalVendorRow) ?? null });
      else if (OWN_CODES.has(row?.financialMissing?.reasonCode)) withheld.push({ field, period: row.financialMissing.period,
        reasonCode: row.financialMissing.reasonCode, originalVendorValue: valueOf(row.financialMissing.originalVendorRow) ?? null });
    }
  }
  const sec = snapshot?.meta?.secQuarterFill;
  if (sec) filled.push({ field: 'revenueQ', period: sec.end, nativeValue: sec.current, source: 'SEC ' + sec.form + ' ' + sec.concept, dataDate: sec.filed, originalVendorValue: null, derivation: sec.derivation });
  return filled.length || withheld.length ? { filled, withheld } : null;
}

module.exports = { applyExchangeCheck, evaluate, evaluateUs, loadUsStore, SEC_CONCEPTS, secQuartersKnown, exchangeSiblings, applyResult, stripOwn, exchangeRecord, loadStores, loadBaseline,
  defaultContext, validatePolicy, policy, REASONS, UNCHECKED_TEXT, OWN_CODES, MODES };
