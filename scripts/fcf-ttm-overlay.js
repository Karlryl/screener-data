#!/usr/bin/env node
'use strict';
/**
 * scripts/fcf-ttm-overlay.js — the ONE place where metrics.fcfMarginTTM is set for the boards
 * (18.11.2026, definition and source order: lib/fcf-ttm.js).
 *
 * Runs in the scoring job of daily-pull.yml right after the OpInc source step and before
 * run-screener.js, so the Rule-of-40 board, the HyperGrowth rule-of-X axis and track and the filter
 * tab all read the same number. Like opinc-source-migrate.js it touches neither the shard caches nor
 * the uploaded snapshots artifact.
 *
 *   node scripts/fcf-ttm-overlay.js refresh-sec    [--max=1500] [--budget-min=8] [--dirs=snapshots,snapshots-smallcap]
 *   node scripts/fcf-ttm-overlay.js refresh-vendor [--max=3000] [--budget-min=8] [--dirs=...]
 *   node scripts/fcf-ttm-overlay.js apply          [--dirs=...] [--json=reports/fcf-ttm-apply.json]
 *
 * Stores (committed with the board-history vintage):
 *   external-data/fcf-ttm-sec.json     byCik:    SEC TTM per company (lib/fcf-ttm.js secTtmFromFacts)
 *   external-data/fcf-ttm-vendor.json  byTicker: Yahoo trailing TTM per listing (vendorTtmFromRows)
 * A refresh reads within a time budget, saves its progress every 100 reads, and never replaces a good
 * entry by a failed or empty read (the failure is recorded as lastAttempt*). apply exits 1 on a missing
 * or unreadable store or when almost no SEC margin is left, so the scoring job stops instead of scoring
 * with the replaced definition.
 */
const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('../lib/atomic-write.js');
const { isMetadataSnapshot } = require('../lib/snapshot-fs.js');
const { secUserAgent, assertSecContact } = require('../lib/sec-user-agent.js');
const { RATE_DELAY_MS } = require('../lib/sec-rate-limit.js');
const { secTtmFromFacts, vendorTtmFromRows, chooseFcfMargin, OLD_COMPARISON_UNTIL } = require('../lib/fcf-ttm.js');

const ROOT = path.join(__dirname, '..');
const SEC_STORE = process.env.FCF_TTM_SEC_STORE || path.join(ROOT, 'external-data', 'fcf-ttm-sec.json');
const VENDOR_STORE = process.env.FCF_TTM_VENDOR_STORE || path.join(ROOT, 'external-data', 'fcf-ttm-vendor.json');
const CIK_MAP = path.join(ROOT, 'external-data', 'sec-ticker-cik-map.json');
const NEW_SOURCES = new Set(['sec-ttm', 'yahoo-fts-ttm']);
// Every company is re-read at least every 23 to 36 days (amendments, missed index days); the spread by
// CIK keeps the seeded companies from falling due on one day.
const RECHECK_BASE_DAYS = 23, RECHECK_SPREAD_DAYS = 14;
const INDEX_REREAD_DAYS = 3;       // the daily index of a day is published late: always read the last 3 days again
const SEC_FLOOR = { usListings: 1000, minSecMargins: 200 }; // apply guard: the SEC path went missing

function arg(name, dflt) {
  const a = process.argv.find((x) => x.startsWith('--' + name + '='));
  return a ? a.slice(name.length + 3) : dflt;
}
const sleep = (n) => new Promise((r) => setTimeout(r, n));
const isoDay = (t) => new Date(t).toISOString().slice(0, 10);
/** Run day: RUN_DATE_UTC of the daily run, else the clock. */
const runDay = () => (/^\d{4}-\d{2}-\d{2}$/.test(process.env.RUN_DATE_UTC || '') ? process.env.RUN_DATE_UTC : isoDay(Date.now()));

/**
 * Read a store; a missing file is an empty store only when `allowMissing` (first refresh), an
 * unreadable one always throws.
 * @param {string} file path of the store.
 * @param {string} key 'byCik' or 'byTicker'.
 * @param {boolean} [allowMissing=false] treat a missing file as empty.
 * @returns {object}
 */
function readStore(file, key, allowMissing = false) {
  if (!fs.existsSync(file)) {
    if (allowMissing) return { schema: 1, [key]: {} };
    throw new Error(file + ' missing');
  }
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!s || typeof s[key] !== 'object' || s[key] === null) throw new Error(file + ': no ' + key + ' object');
  return s;
}

/**
 * Snapshots of the given folders: {file, ticker, snap}.
 * @param {string[]} dirs folders relative to the repo root.
 * @returns {Array<{file:string, ticker:string, snap:object}>}
 */
function loadSnapshots(dirs) {
  const out = [];
  for (const d of dirs) {
    const dir = path.isAbsolute(d) ? d : path.join(ROOT, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json') || isMetadataSnapshot(f)) continue; // the project's one metadata rule (P1 wave 8)
      const file = path.join(dir, f);
      let snap;
      try { snap = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
      const ticker = snap && snap.meta && snap.meta.ticker;
      if (typeof ticker === 'string' && ticker) out.push({ file, ticker, snap });
    }
  }
  return out;
}

/**
 * CIK of a US listing (no exchange suffix) from the SEC ticker map, else null.
 * @param {string} ticker Yahoo ticker.
 * @param {object} byTicker sec-ticker-cik-map.json byTicker.
 * @returns {string|null}
 */
function cikFor(ticker, byTicker) {
  if (ticker.includes('.')) return null;
  const e = byTicker[ticker] || byTicker[ticker.replace('-', '.')];
  return e && e.cik ? String(e.cik).padStart(10, '0') : null;
}

const REQUEST_TIMEOUT_MS = 30000; // one hanging request must not outlive the time budget

async function secGet(url, missingStatuses = [404]) {
  const r = await fetch(url, { headers: { 'User-Agent': secUserAgent(), 'Accept-Encoding': 'gzip, deflate' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (missingStatuses.includes(r.status)) return { status: r.status, missing: true };
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
  return { status: 200, body: r };
}

/**
 * CIKs with a 10-K/10-Q (or amendment) in the EDGAR daily form index from `from` through `to`.
 * www.sec.gov answers 403 for an index day that does not exist; on a weekday that can also be
 * throttling, so it counts as an error there. Returns the last day actually read.
 */
async function filedCiks(days, deadline) {
  const ciks = new Map(); // cik -> latest index day it filed on
  let daysRead = 0, lastRead = null;
  const failedDays = [];
  for (const day of days) {
    if (Date.now() > deadline) { failedDays.push(day); continue; } // out of time: read next run
    const t = Date.parse(day), d = new Date(t), y = d.getUTCFullYear(), q = Math.floor(d.getUTCMonth() / 3) + 1;
    const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
    let res;
    try { res = await secGet(`https://www.sec.gov/Archives/edgar/daily-index/${y}/QTR${q}/form.${day.replace(/-/g, '')}.idx`, [403, 404]); }
    catch { failedDays.push(day); continue; }
    await sleep(RATE_DELAY_MS);
    // A weekday 403 can be throttling: kept as a failed day and read again (not on weekends: no index exists).
    if (res.missing) { if (!weekend && res.status === 403) failedDays.push(day); continue; }
    let text;
    try { text = await res.body.text(); } catch { failedDays.push(day); continue; } // body timeout: day kept (Codex round 3)
    daysRead++; if (!lastRead || day > lastRead) lastRead = day;
    for (const line of text.split('\n')) {
      const m = line.match(/^(10-K|10-Q|10-KT)(\/A)?\s.*?\s(\d{1,10})\s+\d{4}-?\d{2}-?\d{2}\s/);
      if (m) { const c = m[3].padStart(10, '0'); if (!ciks.has(c) || ciks.get(c) < day) ciks.set(c, day); }
    }
  }
  return { ciks, daysRead, lastRead, failedDays };
}

/** Days until a company is re-read without a new filing: 23 to 36, fixed per CIK. */
const recheckDays = (cik) => RECHECK_BASE_DAYS + (parseInt(cik, 10) % RECHECK_SPREAD_DAYS);

async function refreshSec(dirs, max, budgetMin) {
  assertSecContact();
  const deadline = Date.now() + budgetMin * 60000;
  const store = readStore(SEC_STORE, 'byCik', true);
  const map = JSON.parse(fs.readFileSync(CIK_MAP, 'utf8')).byTicker || {};
  const wanted = new Map(); // cik -> tickers
  for (const { ticker } of loadSnapshots(dirs)) {
    const cik = cikFor(ticker, map);
    if (cik) wanted.set(cik, [...(wanted.get(cik) || []), ticker]);
  }
  const now = runDay();
  // Work that must not get lost behind the cursor (Codex review round 2): filers found in an index but
  // not yet read (pendingCiks) and index days that failed (retryIndexDays) live in the store until done.
  const pending = new Set(Array.isArray(store.pendingCiks) ? store.pendingCiks : []);
  const retryDays = new Set(Array.isArray(store.retryIndexDays) ? store.retryIndexDays : []);
  const cursor = store.lastIndexDate || isoDay(Date.now() - 7 * 86400000);
  const days = new Set(retryDays);
  for (let t = Date.parse(cursor) - INDEX_REREAD_DAYS * 86400000; t <= Date.parse(now); t += 86400000) days.add(isoDay(t));
  const idx = await filedCiks([...days].sort(), deadline);
  if (idx.failedDays.length) console.warn(`::warning::[fcf-ttm] ${idx.failedDays.length} index days unread (403/timeout/budget); kept for the next run.`);
  // A filer is pending unless its entry was read on a later day than the filing (a read on the filing
  // day itself may have come before the filing; the overlap re-reads days). Codex round 3.
  const pendingSince = store.pendingSince && typeof store.pendingSince === 'object' ? store.pendingSince : {};
  for (const [c, day] of idx.ciks) {
    const e = store.byCik[c];
    if (!e || !e.fetchedAt || e.fetchedAt.slice(0, 10) <= day) { pending.add(c); if (!pendingSince[c]) pendingSince[c] = now; }
  }
  // Pending work stays until a read ANSWERED with facts (the filing is then consumed); a missing or
  // failed answer keeps it pending with a backoff of 1, 2, 4, 7, 7 ... days (Codex round 4: no expiry).
  const attempts = store.pendingAttempts && typeof store.pendingAttempts === 'object' ? store.pendingAttempts : {};
  const dayMs = 86400000;
  const backoffOver = (cik) => {
    const e = store.byCik[cik], last = e && e.lastAttemptAt ? Date.parse(e.lastAttemptAt) : NaN;
    return !Number.isFinite(last) || Date.parse(now) - last >= Math.min(7, 2 ** Math.max(0, (attempts[cik] || 1) - 1)) * dayMs;
  };
  const due = [];
  for (const cik of wanted.keys()) {
    const e = store.byCik[cik];
    const age = e && e.fetchedAt ? (Date.parse(now) - Date.parse(e.fetchedAt)) / dayMs : Infinity;
    // A company whose last read gave no figures is re-read weekly, not after 23-36 days.
    const recheck = e && !e.ok ? Math.min(7, recheckDays(cik)) : recheckDays(cik);
    if (pending.has(cik) ? backoffOver(cik) : (!e || age >= recheck)) due.push({ cik, prio: pending.has(cik) ? 0 : (!e ? 1 : 2), age });
  }
  due.sort((a, b) => a.prio - b.prio || b.age - a.age);
  let fetched = 0, failed = 0, outOfTime = 0;
  const failedRead = (cik, reason) => {
    const old = store.byCik[cik];
    store.byCik[cik] = old ? Object.assign({}, old, { lastAttemptAt: now, lastAttemptReason: reason })
      : { tickers: wanted.get(cik), fetchedAt: now, lastAttemptAt: now, ok: false, reason };
    if (pending.has(cik)) attempts[cik] = (attempts[cik] || 0) + 1;
  };
  for (const { cik } of due.slice(0, max)) {
    if (Date.now() > deadline) { outOfTime++; continue; }
    try {
      const res = await secGet(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
      if (res.missing) { failedRead(cik, 'sec-no-companyfacts'); fetched++; continue; }
      const r = secTtmFromFacts(await res.body.json());
      const old = store.byCik[cik];
      // The filing is consumed (facts answered). A result without figures never replaces a good entry.
      if (!r.ok && old && old.ok) store.byCik[cik] = Object.assign({}, old, { lastAttemptAt: now, lastAttemptReason: r.reason });
      else store.byCik[cik] = Object.assign({ tickers: wanted.get(cik), fetchedAt: now }, r);
      pending.delete(cik); delete attempts[cik];
      fetched++;
      if (fetched % 100 === 0) { store.pendingCiks = [...pending].sort(); writeJsonAtomic(SEC_STORE, store); } // resumable
    } catch (e) { failed++; failedRead(cik, 'sec-read-failed'); if (failed <= 20) console.warn('::warning::[fcf-ttm] SEC ' + cik + ': ' + e.message); }
    await sleep(RATE_DELAY_MS);
  }
  for (const [cik, tickers] of wanted) if (store.byCik[cik]) store.byCik[cik].tickers = tickers;
  for (const c of [...pending]) if (!wanted.has(c)) pending.delete(c); // filers outside the universe
  store.pendingCiks = [...pending].sort();
  store.pendingSince = Object.fromEntries(store.pendingCiks.map((c) => [c, pendingSince[c] || now]));
  store.pendingAttempts = Object.fromEntries(store.pendingCiks.filter((c) => attempts[c]).map((c) => [c, attempts[c]]));
  store.retryIndexDays = idx.failedDays.filter((d) => d >= isoDay(Date.parse(now) - 30 * 86400000)).sort();
  // The cursor moves only to the last day actually read; failed days stay in retryIndexDays.
  if (idx.lastRead && (!store.lastIndexDate || idx.lastRead > store.lastIndexDate)) store.lastIndexDate = idx.lastRead;
  store.updatedAt = now;
  writeJsonAtomic(SEC_STORE, store);
  const left = Math.max(0, due.length - max) + outOfTime;
  console.log(`[fcf-ttm] SEC: ${wanted.size} US companies, ${idx.ciks.size} filers in ${idx.daysRead} index days, ${pending.size} still pending, `
    + `${due.length} due, ${fetched} read, ${failed} failed, ${left} left for the next run`);
  if (failed > 0 && fetched === 0) process.exitCode = 1;
}

const VENDOR_RETRY_DAYS = 1; // a failed or empty Yahoo read is tried again after a day (Codex review round 2)

/**
 * Is a Yahoo listing due for a read? New: yes. Last good read older than the snapshot's last full
 * pull: yes, unless a failed attempt was made less than VENDOR_RETRY_DAYS ago. Never read with
 * success: retried every VENDOR_RETRY_DAYS.
 * @param {object|undefined} e store entry.
 * @param {string|undefined} pulledAt snapshot meta.fetchedAt (last full pull).
 * @param {number} nowMs current time.
 * @returns {boolean}
 */
function vendorDue(e, pulledAt, nowMs) {
  if (!e) return true;
  const day = 86400000, pulled = Date.parse(pulledAt || ''), good = e.ok ? Date.parse(e.fetchedAt) : NaN;
  const attempt = Date.parse(e.lastAttemptAt || (e.ok ? '' : e.fetchedAt) || '');
  const backoffOver = !Number.isFinite(attempt) || nowMs - attempt >= VENDOR_RETRY_DAYS * day;
  if (!e.ok) return backoffOver;
  return Number.isFinite(pulled) && pulled > good && backoffOver;
}

async function refreshVendor(dirs, max, concurrency, budgetMin) {
  const YF = require('yahoo-finance2').default;
  const { normalizeYahooSymbol } = require('../pull-yahoo.js');
  const yf = new YF({ suppressNotices: ['yahooSurvey'] });
  const deadline = Date.now() + budgetMin * 60000;
  const store = readStore(VENDOR_STORE, 'byTicker', true);
  const now = new Date();
  const due = [];
  for (const { ticker, snap } of loadSnapshots(dirs)) {
    if (vendorDue(store.byTicker[ticker], snap.meta && snap.meta.fetchedAt, now.getTime())) due.push(ticker);
  }
  // Fair order (Codex round 3): never-read listings first, then the longest-waiting; a listing that keeps
  // failing moves to the back by its own attempt time and cannot starve the others.
  const waitedSince = (t) => { const e = store.byTicker[t]; return e ? (e.lastAttemptAt || e.fetchedAt || '') : ''; };
  due.sort((a, b) => waitedSince(a).localeCompare(waitedSince(b)) || a.localeCompare(b));
  let i = 0, fetched = 0, failed = 0;
  const period1 = new Date(now.getTime() - 2 * 365 * 86400000);
  const keep = (t, reason) => {
    const old = store.byTicker[t];
    const at = new Date().toISOString();
    if (old && old.ok) store.byTicker[t] = Object.assign({}, old, { lastAttemptAt: at, lastAttemptReason: reason });
    else store.byTicker[t] = { fetchedAt: at, ok: false, reason };
  };
  async function worker() {
    while (i < Math.min(due.length, max) && Date.now() < deadline) {
      const t = due[i++];
      try {
        // Same symbol rule as the pull (FUNO/11.MX is FUNO11.MX at Yahoo).
        const rows = await yf.fundamentalsTimeSeries(normalizeYahooSymbol(t), { period1, period2: now, type: 'trailing', module: 'all' },
          { validateResult: false, fetchOptions: { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) } });
        const r = vendorTtmFromRows(rows);
        // An empty answer (Yahoo sometimes returns none for a while) never replaces a good entry.
        if (r.ok) store.byTicker[t] = Object.assign({ fetchedAt: new Date().toISOString() }, r); else keep(t, r.reason);
        fetched++;
      } catch (e) {
        // Every failed attempt is recorded (404, 5xx, timeout), so the fair order and the one-day
        // backoff apply to all of them (Codex round 4).
        const status = e && (e.response && e.response.status || e.status || e.code);
        const notFound = status === 404 || /\b404\b|not found/i.test(String(e && e.message));
        keep(t, notFound ? 'vendor-not-found' : 'vendor-read-failed' + (status ? '-' + String(status).toLowerCase() : ''));
        failed++; if (failed <= 20) console.warn('::warning::[fcf-ttm] Yahoo ' + t + ': ' + e.message);
      }
      if (fetched > 0 && fetched % 100 === 0) writeJsonAtomic(VENDOR_STORE, store); // resumable
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  store.updatedAt = isoDay(now);
  writeJsonAtomic(VENDOR_STORE, store);
  console.log(`[fcf-ttm] vendor: ${due.length} due, ${fetched} read, ${failed} failed, ${Math.max(0, due.length - i)} left`);
  if (failed > 0 && fetched === 0) process.exitCode = 1;
}

/**
 * Write the chosen margin into one snapshot (pure on the object; returns whether it changed).
 * The replaced value is kept once as meta.fcfMarginTTMOld (outside metrics, so no "oldest metric
 * date" reader counts it) and removed once the run day is past OLD_COMPARISON_UNTIL.
 * @param {object} snap snapshot object, changed in place.
 * @param {{value:(number|null),source:(string|null),periodEnd:(string|null),reason:(string|null),suppressed:boolean}} choice
 * @param {string} day run day (ISO), the asOf of the new value.
 * @returns {boolean}
 */
function applyChoice(snap, choice, day) {
  const m = snap.metrics || (snap.metrics = {});
  const meta = snap.meta || (snap.meta = {});
  const state = () => JSON.stringify([m.fcfMarginTTM, meta.fcfMarginTTMOld, meta.fcfMarginTTMSuppressed, meta.fcfMarginTTMReason,
    meta.fcfMarginTTMSource, meta.fcfMarginTTMPeriodEnd]);
  const before = state();
  const cur = m.fcfMarginTTM;
  if (!meta.fcfMarginTTMOld && !(cur && NEW_SOURCES.has(cur.source))) {
    meta.fcfMarginTTMOld = { value: cur && typeof cur.value === 'number' ? cur.value : null,
      source: (cur && cur.source) || 'yahoo_quoteSummary', asOf: (cur && cur.asOf) || null, until: OLD_COMPARISON_UNTIL };
    if (meta.fcfMarginTTMSuppressed) meta.fcfMarginTTMOld.suppressed = true;
  }
  if (meta.fcfMarginTTMOld && day > meta.fcfMarginTTMOld.until) delete meta.fcfMarginTTMOld; // four weeks are over
  if (choice.value === null) delete m.fcfMarginTTM;
  else m.fcfMarginTTM = { value: choice.value, source: choice.source, confidence: 0.95, asOf: day, periodEnd: choice.periodEnd };
  meta.fcfMarginTTMSuppressed = choice.suppressed;
  meta.fcfMarginTTMReason = choice.reason;
  meta.fcfMarginTTMSource = choice.source;
  meta.fcfMarginTTMPeriodEnd = choice.periodEnd;
  return before !== state();
}

/**
 * Newest reported quarter end of a snapshot (timeseries.revenueQEnds, newest first), or null.
 * @param {object} snap snapshot.
 * @returns {string|null}
 */
function newestQuarterEnd(snap) {
  const ends = snap && snap.timeseries && snap.timeseries.revenueQEnds;
  const iso = Array.isArray(ends) ? ends.find((e) => typeof e === 'string' && /^\d{4}-\d{2}-\d{2}/.test(e)) : null;
  return iso ? iso.slice(0, 10) : null;
}

/**
 * Apply the one FCF margin to every snapshot of `dirs`.
 * @param {string[]} dirs snapshot folders.
 * @param {string|null} jsonOut optional path of the count report.
 * @param {string} [day] run day (ISO); default RUN_DATE_UTC or the clock.
 * @returns {object} counts by source and reason.
 */
function apply(dirs, jsonOut, day = runDay()) {
  const sec = readStore(SEC_STORE, 'byCik');
  const vendor = readStore(VENDOR_STORE, 'byTicker');
  const map = JSON.parse(fs.readFileSync(CIK_MAP, 'utf8')).byTicker || {};
  const counts = { day, total: 0, changed: 0, usListings: 0, 'sec-ttm': 0, 'yahoo-fts-ttm': 0, empty: 0, suppressed: 0, reasons: {} };
  const plan = [];
  for (const { file, ticker, snap } of loadSnapshots(dirs)) {
    const cik = cikFor(ticker, map);
    if (cik) counts.usListings++;
    const choice = chooseFcfMargin({ sec: cik ? sec.byCik[cik] || null : null, vendor: vendor.byTicker[ticker] || null,
      newestQuarterEnd: newestQuarterEnd(snap), today: day });
    counts.total++;
    if (choice.suppressed) counts.suppressed++;
    if (choice.reason) counts.reasons[choice.reason] = (counts.reasons[choice.reason] || 0) + 1;
    if (choice.value === null) counts.empty++; else counts[choice.source]++;
    plan.push({ file, snap, choice });
  }
  // Guard before anything is written: with many US listings and almost no SEC margin the SEC path is broken.
  if (counts.usListings >= SEC_FLOOR.usListings && counts['sec-ttm'] < SEC_FLOOR.minSecMargins) {
    throw new Error(`only ${counts['sec-ttm']} SEC margins for ${counts.usListings} US listings (floor ${SEC_FLOOR.minSecMargins}); store broken?`);
  }
  for (const { file, snap, choice } of plan) if (applyChoice(snap, choice, day)) { writeJsonAtomic(file, snap); counts.changed++; }
  console.log('[fcf-ttm] apply: ' + JSON.stringify(counts));
  if (jsonOut) writeJsonAtomic(path.isAbsolute(jsonOut) ? jsonOut : path.join(ROOT, jsonOut), counts);
  return counts;
}

async function main() {
  const cmd = process.argv[2];
  const dirs = arg('dirs', 'snapshots,snapshots-smallcap').split(',').filter(Boolean);
  const budget = Number(arg('budget-min', 8));
  if (cmd === 'refresh-sec') return refreshSec(dirs, Number(arg('max', 1500)), budget);
  if (cmd === 'refresh-vendor') return refreshVendor(dirs, Number(arg('max', 3000)), Number(arg('concurrency', 4)), budget);
  if (cmd === 'apply') { apply(dirs, arg('json', null)); return; }
  console.error('usage: fcf-ttm-overlay.js refresh-sec|refresh-vendor|apply [--dirs=a,b] [--max=n] [--budget-min=m]');
  process.exitCode = 2;
}

if (require.main === module) main().catch((e) => { console.error('[fcf-ttm] ' + e.stack); process.exitCode = 1; });

module.exports = { applyChoice, cikFor, readStore, apply, newestQuarterEnd, recheckDays, vendorDue, filedCiks, refreshSec };
