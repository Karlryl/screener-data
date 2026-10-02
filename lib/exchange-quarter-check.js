'use strict';
/**
 * lib/exchange-quarter-check.js — Tag 1403 (G2b). Read-time cross-check of the vendor's quarterly
 * revenue against the exchange-fed store (external-data/exchange-quarters/{cn,tw}.json, Tag 1399).
 *
 * Mode (configs/exchange-quarter-policy.json, one setting):
 *   off     default for every reader: the step only removes its own markers (none exist on disk,
 *           the pull never runs it) and returns the input object unchanged.
 *   shadow  computes what it would do (`result`) and returns the snapshot unchanged; used only by
 *           scripts/exchange-check-report.js.
 *   active  applies it. Not enabled by this change (G2c is the one-line switch).
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
 * not agree (or cannot be checked) the growth figure is withheld entirely. A vendor-delivered cell of a
 * fill period (2025-09-30) that misses the exchange figure is withheld wherever it sits (F5, general stratum).
 * Fill: an EMPTY vendor cell of a fill period (2025-09-30) gets the exchange single quarter only
 * when every vendor quarter agrees with the store, the vendor's 2025 quarters are unchanged since
 * the board-history vintage before 2026-08-01 (a quarter that vintage does not carry is unproven), the store has no restatement signal, and (once the
 * Q3-2026 reports exist) the Q3-2025 observation was confirmed after the Q3-2026 notice date.
 *
 * Nothing under src/scoring/ changes; readers see the result only through prepareSnapshot, and
 * only in active mode.
 */
const fs = require('fs');
const path = require('path');
const policy = require('../configs/exchange-quarter-policy.json');
const S = require('./exchange-quarter-store.js');
const { jahresVergleichIdx, norm } = require('../src/scoring/snapshot.js');
const { revGrowthLeg } = require('./rev-growth-basis.js');
const financialTable = require('../configs/financial-known-cases.json');
const q4Table = require('../configs/yahoo-q4-known-cases.json');

const ROOT = path.join(__dirname, '..');
const MODES = ['off', 'shadow', 'active'];
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
      !(p.maxStoreAgeDays > 0) || !(p.maxStoreAgeDaysInSeason > 0)) {
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
    defaultCtx = { stores, baseline, warnings: [...stores.warnings, ...baseline.warnings] };
  }
  return defaultCtx;
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

function storeTooOld(store, m) {
  const at = Date.parse(m.fetchedAt || '');
  const newest = Math.max(...Object.values(store.sources || {}).map(s => Date.parse(s.fetchedAt)).filter(finite));
  if (!finite(at) || !finite(newest)) return true;
  const md = new Date(at).toISOString().slice(5, 10);
  const limit = md >= '10-15' && md <= '11-20' ? policy.maxStoreAgeDaysInSeason : policy.maxStoreAgeDays;
  return (at - newest) / 864e5 > limit;
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
  const un = why => { res.why = why; return res; };
  const store = ctx.stores?.[market.toLowerCase()];
  if (!store) return un('store-missing');
  if (storeTooOld(store, m)) return un('store-old');
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
  // F5: once the vendor delivers a fill-period quarter, a value off the exchange is withheld wherever it sits
  // (general stratum only: a broker's level gap is definition). The newest quarter is never withheld (G1).
  for (const P of x.stratum === 'general' ? policy.fillPeriods : []) {
    const k = ends.indexOf(P);
    if (k > 0 && native[k] !== null && ex[k] !== null && !agree(native[k], ex[k])) {
      res.fillPeriodVendorDisagrees = true;
      if (!res.withhold.some(w => w.index === k)) {
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
      if (level || (revGrowthLeg(s).basis === 'quarter' && revGrowthLeg(guarded).basis !== 'quarter')) {
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
  if (leg.basis === 'none' || leg.basis === 'quarter') { out.status = leg.basis; return out; }
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

function fillCheck(s, res, x, ends, native, ex, xq, agree, env, ctx) {
  for (const P of policy.fillPeriods) {
    const k = ends.indexOf(P);
    if (k < 0 || native[k] !== null) continue; // absent row (not built here) or vendor delivered
    const fill = { period: P, index: k, blocked: null, nativeValue: null };
    const nextYear = (Number(P.slice(0, 4)) + 1) + P.slice(4);
    const block = why => { fill.blocked = why; return fill; };
    if (x.stratum !== 'general') return block('not-general');
    if (k === 0 || native[0] === null || !(ends[0] > P)) return block('newest-cell');
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
      if (!(x.latest[P].confirmedBy || []).some(c => c.updateDate && notice && c.updateDate >= notice)) return block('november-not-confirmed');
    }
    if (res.market === 'TW' && x.latest[x.keyOf(nextYear)]) {
      const [roc, season] = x.keyOf(nextYear).split('Q').map(Number);
      const v = S.taiwanSeasonValues(x.latest[x.keyOf(nextYear)], roc, season);
      if (!v || !finite(v.priorQuarter)) return block('november-not-confirmed');
    }
    fill.nativeValue = xq[P];
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
    const f = res.fill, row = s.timeseries.revenueQ[f.index], env = q4().envelope(s);
    const w = writer(s);
    w.put('timeseries', 'revenueQ', f.index, { ...(row && typeof row === 'object' ? row : {}), value: f.nativeValue * env.factor,
      exchangeFill: { period: f.period, nativeValue: f.nativeValue, nativeCurrency: env.currency, line: res.line,
        derivation: f.derivation, operands: f.operands, source: f.source, sourceId: f.sourceId, dataDate: f.dataDate,
        fetchedAt: f.fetchedAt, reason: f.reason, originalVendorRow: row } });
    return w.get();
  }
  return s;
}

/** Remove the step's own markers and restore the original vendor cells.
 * @param {object} s snapshot
 * @returns {object} the same object when there is no marker, else a copy with the vendor cells restored */
function stripOwn(s) {
  if (!s || typeof s !== 'object') return s;
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
  const result = evaluate(base, options.context || defaultContext(), options);
  return { snapshot: mode === 'active' ? applyResult(base, result) : base, mode, result };
}

/** Additive board-history record of exchange-sourced or withheld cells (null when none, i.e. outside active mode).
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
  return filled.length || withheld.length ? { filled, withheld } : null;
}

module.exports = { applyExchangeCheck, evaluate, applyResult, stripOwn, exchangeRecord, loadStores, loadBaseline,
  defaultContext, validatePolicy, policy, REASONS, OWN_CODES, MODES };
