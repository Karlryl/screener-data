#!/usr/bin/env node
'use strict';
/**
 * scripts/fcf-ttm-overlay.js — the ONE place where metrics.fcfMarginTTM is set for the boards
 * (18.11.2026, definition and source order: lib/fcf-ttm.js).
 *
 * Runs in the scoring job of daily-pull.yml right after the OpInc source step and before
 * run-screener.js, so the Rule-of-40 board, the HyperGrowth rule-of-X axis and the filter tab all
 * read the same number. Like opinc-source-migrate.js it touches neither the shard caches nor the
 * uploaded snapshots artifact.
 *
 *   node scripts/fcf-ttm-overlay.js refresh-sec    [--max=1500] [--dirs=snapshots,snapshots-smallcap]
 *   node scripts/fcf-ttm-overlay.js refresh-vendor [--max=3000] [--dirs=...]
 *   node scripts/fcf-ttm-overlay.js apply          [--dirs=...] [--json=reports/fcf-ttm-apply.json]
 *
 * Stores (committed with the board-history vintage):
 *   external-data/fcf-ttm-sec.json     byCik:    SEC TTM per company (lib/fcf-ttm.js secTtmFromFacts)
 *   external-data/fcf-ttm-vendor.json  byTicker: Yahoo trailing TTM per listing (vendorTtmFromRows)
 * A refresh that fails keeps the previous entry with its own period end and fetch date; it never
 * writes a number it did not read. apply exits 1 on an unreadable store, so the scoring job stops
 * instead of scoring with the replaced definition.
 */
const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('../lib/atomic-write.js');
const { secUserAgent, assertSecContact } = require('../lib/sec-user-agent.js');
const { RATE_DELAY_MS } = require('../lib/sec-rate-limit.js');
const { secTtmFromFacts, vendorTtmFromRows, chooseFcfMargin, OLD_COMPARISON_UNTIL } = require('../lib/fcf-ttm.js');

const ROOT = path.join(__dirname, '..');
const SEC_STORE = process.env.FCF_TTM_SEC_STORE || path.join(ROOT, 'external-data', 'fcf-ttm-sec.json');
const VENDOR_STORE = process.env.FCF_TTM_VENDOR_STORE || path.join(ROOT, 'external-data', 'fcf-ttm-vendor.json');
const CIK_MAP = path.join(ROOT, 'external-data', 'sec-ticker-cik-map.json');
const NEW_SOURCES = new Set(['sec-ttm', 'yahoo-fts-ttm']);
const RECHECK_DAYS = 30; // re-read every company at least monthly (amendments, missed index days)

function arg(name, dflt) {
  const a = process.argv.find((x) => x.startsWith('--' + name + '='));
  return a ? a.slice(name.length + 3) : dflt;
}
const sleep = (n) => new Promise((r) => setTimeout(r, n));
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Read a store; a missing file is an empty store, an unreadable one throws.
 * @param {string} file path of the store.
 * @param {string} key 'byCik' or 'byTicker'.
 * @returns {object}
 */
function readStore(file, key) {
  if (!fs.existsSync(file)) return { schema: 1, [key]: {} };
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
      if (!f.endsWith('.json') || f.startsWith('_')) continue;
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

async function secGet(url, missingStatuses = [404]) {
  const r = await fetch(url, { headers: { 'User-Agent': secUserAgent(), 'Accept-Encoding': 'gzip, deflate' } });
  if (missingStatuses.includes(r.status)) return { status: 404 };
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
  return { status: 200, body: r };
}

/** CIKs with a 10-K/10-Q (or amendment) in the EDGAR daily form index of each day after `from`. */
async function filedCiks(from, to) {
  const ciks = new Set();
  let ok = 0;
  for (let t = Date.parse(from) + 86400000; t <= Date.parse(to); t += 86400000) {
    const d = new Date(t), y = d.getUTCFullYear(), q = Math.floor(d.getUTCMonth() / 3) + 1;
    const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
    // www.sec.gov answers 403 (not 404) for an index day that does not exist (weekend, holiday).
    const res = await secGet(`https://www.sec.gov/Archives/edgar/daily-index/${y}/QTR${q}/form.${ymd}.idx`, [403, 404]);
    await sleep(RATE_DELAY_MS);
    if (res.status === 404) continue; // weekend, holiday, or not yet published
    ok++;
    for (const line of (await res.body.text()).split('\n')) {
      const m = line.match(/^(10-K|10-Q|10-KT)(\/A)?\s.*?\s(\d{1,10})\s+\d{4}-?\d{2}-?\d{2}\s/);
      if (m) ciks.add(m[3].padStart(10, '0'));
    }
  }
  return { ciks, daysRead: ok };
}

async function refreshSec(dirs, max) {
  assertSecContact();
  const store = readStore(SEC_STORE, 'byCik');
  const map = JSON.parse(fs.readFileSync(CIK_MAP, 'utf8')).byTicker || {};
  const wanted = new Map(); // cik -> tickers
  for (const { ticker } of loadSnapshots(dirs)) {
    const cik = cikFor(ticker, map);
    if (cik) wanted.set(cik, [...(wanted.get(cik) || []), ticker]);
  }
  const now = today();
  const from = store.lastIndexDate || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  let filed = new Set(), daysRead = 0;
  try { ({ ciks: filed, daysRead } = await filedCiks(from, now)); }
  catch (e) { console.warn('::warning::[fcf-ttm] EDGAR daily index unreadable, only missing and monthly re-reads this run: ' + e.message); }
  if (daysRead === 0) console.warn('::warning::[fcf-ttm] no EDGAR daily index day readable since ' + from + ' — new filings are caught by the monthly re-read only.');
  const due = [];
  for (const cik of wanted.keys()) {
    const e = store.byCik[cik];
    const age = e && e.fetchedAt ? (Date.parse(now) - Date.parse(e.fetchedAt)) / 86400000 : Infinity;
    if (!e || filed.has(cik) || age >= RECHECK_DAYS) due.push({ cik, prio: filed.has(cik) ? 0 : (!e ? 1 : 2), age });
  }
  due.sort((a, b) => a.prio - b.prio || b.age - a.age);
  let fetched = 0, failed = 0;
  for (const { cik } of due.slice(0, max)) {
    try {
      const res = await secGet(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
      const r = res.status === 404 ? { ok: false, reason: 'sec-no-companyfacts' } : secTtmFromFacts(await res.body.json());
      store.byCik[cik] = Object.assign({ tickers: wanted.get(cik), fetchedAt: now }, r);
      fetched++;
    } catch (e) { failed++; console.warn('::warning::[fcf-ttm] SEC ' + cik + ': ' + e.message); }
    await sleep(RATE_DELAY_MS);
  }
  for (const [cik, tickers] of wanted) if (store.byCik[cik]) store.byCik[cik].tickers = tickers;
  if (daysRead > 0 || !store.lastIndexDate) store.lastIndexDate = now;
  store.updatedAt = now;
  writeJsonAtomic(SEC_STORE, store);
  console.log(`[fcf-ttm] SEC: ${wanted.size} US companies, ${filed.size} filers in ${daysRead} index days, `
    + `${due.length} due, ${fetched} read, ${failed} failed, ${Math.max(0, due.length - max)} left for the next run`);
  if (failed > 0 && fetched === 0) process.exitCode = 1;
}

async function refreshVendor(dirs, max, concurrency) {
  const YF = require('yahoo-finance2').default;
  const { normalizeYahooSymbol } = require('../pull-yahoo.js');
  const yf = new YF({ suppressNotices: ['yahooSurvey'] });
  const store = readStore(VENDOR_STORE, 'byTicker');
  const now = new Date();
  const due = [];
  for (const { ticker, snap } of loadSnapshots(dirs)) {
    const e = store.byTicker[ticker];
    const pulled = snap.meta && snap.meta.fetchedAt ? Date.parse(snap.meta.fetchedAt) : NaN;
    // A full pull (meta.fetchedAt) newer than our read means new fundamentals: read again.
    if (!e || (Number.isFinite(pulled) && pulled > Date.parse(e.fetchedAt))) due.push(ticker);
  }
  let i = 0, fetched = 0, failed = 0;
  const period1 = new Date(now.getTime() - 2 * 365 * 86400000);
  async function worker() {
    while (i < Math.min(due.length, max)) {
      const t = due[i++];
      try {
        // Same symbol rule as the pull (FUNO/11.MX is FUNO11.MX at Yahoo).
        const rows = await yf.fundamentalsTimeSeries(normalizeYahooSymbol(t), { period1, period2: now, type: 'trailing', module: 'all' },
          { validateResult: false });
        store.byTicker[t] = Object.assign({ fetchedAt: new Date().toISOString() }, vendorTtmFromRows(rows));
        fetched++;
      } catch (e) {
        // A listing Yahoo does not know is recorded (reason, no number) and read again after its next full pull.
        if (/404/.test(String(e.message))) store.byTicker[t] = { fetchedAt: new Date().toISOString(), ok: false, reason: 'vendor-not-found' };
        failed++; if (failed <= 20) console.warn('::warning::[fcf-ttm] Yahoo ' + t + ': ' + e.message);
      }
      if (fetched > 0 && fetched % 500 === 0) writeJsonAtomic(VENDOR_STORE, store); // resumable
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  store.updatedAt = now.toISOString().slice(0, 10);
  writeJsonAtomic(VENDOR_STORE, store);
  console.log(`[fcf-ttm] vendor: ${due.length} due, ${fetched} read, ${failed} failed, ${Math.max(0, due.length - max)} left`);
  if (failed > 0 && fetched === 0) process.exitCode = 1;
}

/**
 * Write the chosen margin into one snapshot (pure on the object; returns whether it changed).
 * The replaced value is kept once as metrics.fcfMarginTTMOld (comparison until OLD_COMPARISON_UNTIL).
 * @param {object} snap snapshot object, changed in place.
 * @param {{value:(number|null),source:(string|null),periodEnd:(string|null),reason:(string|null),suppressed:boolean}} choice
 * @returns {boolean}
 */
function applyChoice(snap, choice) {
  const m = snap.metrics || (snap.metrics = {});
  const meta = snap.meta || (snap.meta = {});
  const before = JSON.stringify([m.fcfMarginTTM, m.fcfMarginTTMOld, meta.fcfMarginTTMSuppressed, meta.fcfMarginTTMReason]);
  const cur = m.fcfMarginTTM;
  if (!m.fcfMarginTTMOld && !(cur && NEW_SOURCES.has(cur.source))) {
    m.fcfMarginTTMOld = cur && typeof cur === 'object'
      ? Object.assign({}, cur, { until: OLD_COMPARISON_UNTIL })
      : { value: null, source: 'yahoo_quoteSummary', until: OLD_COMPARISON_UNTIL };
    if (meta.fcfMarginTTMSuppressed) m.fcfMarginTTMOld.suppressed = true;
  }
  if (choice.value === null) delete m.fcfMarginTTM;
  else m.fcfMarginTTM = { value: choice.value, source: choice.source, confidence: 0.95, asOf: choice.periodEnd, periodEnd: choice.periodEnd };
  meta.fcfMarginTTMSuppressed = choice.suppressed;
  meta.fcfMarginTTMReason = choice.reason;
  meta.fcfMarginTTMSource = choice.source;
  meta.fcfMarginTTMPeriodEnd = choice.periodEnd;
  return before !== JSON.stringify([m.fcfMarginTTM, m.fcfMarginTTMOld, meta.fcfMarginTTMSuppressed, meta.fcfMarginTTMReason]);
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

function apply(dirs, jsonOut) {
  const sec = readStore(SEC_STORE, 'byCik');
  const vendor = readStore(VENDOR_STORE, 'byTicker');
  const map = JSON.parse(fs.readFileSync(CIK_MAP, 'utf8')).byTicker || {};
  const counts = { total: 0, changed: 0, 'sec-ttm': 0, 'yahoo-fts-ttm': 0, empty: 0, suppressed: 0, reasons: {} };
  for (const { file, ticker, snap } of loadSnapshots(dirs)) {
    const cik = cikFor(ticker, map);
    const choice = chooseFcfMargin({ sec: cik ? sec.byCik[cik] || null : null, vendor: vendor.byTicker[ticker] || null,
      newestQuarterEnd: newestQuarterEnd(snap) });
    counts.total++;
    if (choice.suppressed) counts.suppressed++;
    if (choice.value === null) { counts.empty++; counts.reasons[choice.reason] = (counts.reasons[choice.reason] || 0) + 1; }
    else counts[choice.source]++;
    if (applyChoice(snap, choice)) { writeJsonAtomic(file, snap); counts.changed++; }
  }
  console.log('[fcf-ttm] apply: ' + JSON.stringify(counts));
  if (jsonOut) writeJsonAtomic(path.isAbsolute(jsonOut) ? jsonOut : path.join(ROOT, jsonOut), counts);
  return counts;
}

async function main() {
  const cmd = process.argv[2];
  const dirs = arg('dirs', 'snapshots,snapshots-smallcap').split(',').filter(Boolean);
  if (cmd === 'refresh-sec') return refreshSec(dirs, Number(arg('max', 1500)));
  if (cmd === 'refresh-vendor') return refreshVendor(dirs, Number(arg('max', 3000)), Number(arg('concurrency', 4)));
  if (cmd === 'apply') { apply(dirs, arg('json', null)); return; }
  console.error('usage: fcf-ttm-overlay.js refresh-sec|refresh-vendor|apply [--dirs=a,b] [--max=n]');
  process.exitCode = 2;
}

if (require.main === module) main().catch((e) => { console.error('[fcf-ttm] ' + e.stack); process.exitCode = 1; });

module.exports = { applyChoice, cikFor, readStore, apply, newestQuarterEnd };
