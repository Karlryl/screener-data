#!/usr/bin/env node
'use strict';
/**
 * scripts/fetch-hk-interims.js — append-only store of Hong Kong half-year revenue (G31, lane sd-halbjahr 12.11.2026).
 *
 * Yahoo delivers no half-year (6M) figures for Hong Kong reporters: the quarterly series is empty or holds stray old
 * quarters (measured 12.11.2026: 77 of 98 stale HK board rows have none), so the boards showed fiscal 2025 although the
 * interim report to 30.06.2026 was out since August. Eastmoney's HK F10 main indicators carry each interim with its
 * own year-ago value (owner decision 19.08.2026 "voll nutzen wie jede andere Quelle", precedent scripts/build-cnannual.js).
 *
 *   Source  https://datacenter.eastmoney.com/securities/api/data/v1/get, reportName RPT_HKF10_FN_MAININDICATOR,
 *           whole market, DATE_TYPE_CODE 002 (interim, six months), REPORT_DATE inside the last 400 days.
 *   Store   external-data/exchange-quarters/hk.json, companies[<Yahoo ticker>].halfYear[<period end>] = observations.
 *           Only ratios are ever read from it (lib/hk-interim.js): Eastmoney's CURRENCY label is unreliable
 *           (Pop Mart reports RMB, labelled HKD), so no amount from here reaches a board.
 *
 * Failure behaviour: a non-success answer, invalid JSON, a page count that does not add up to `count`, a duplicate
 * SECUCODE/REPORT_DATE, a row of another DATE_TYPE_CODE or the page cap -> abort, hk.json is not written, exit 1.
 * Before every write the new store is checked against the old one (assertAppendOnly); writes are atomic.
 *
 * Usage: node scripts/fetch-hk-interims.js [--dry-run] [--today=YYYY-MM-DD]
 * Env EXCHANGE_QUARTERS_DIR overrides the store directory (tests).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { fetchJson } = require(path.join(ROOT, 'lib/fetch-retry.js'));
const { writeFileAtomic } = require(path.join(ROOT, 'lib/atomic-write.js'));
const S = require(path.join(ROOT, 'lib/exchange-quarter-store.js'));

const USER_AGENT = 'screener-data exchange-quarters fetch';
const PAUSE_MS = 1500;
const PAGE_SIZE = 500;
const PAGE_CAP = 30; // measured 12.11.2026: 2,134 interim rows per period end, two period ends inside 400 days -> 9 pages
const WINDOW_DAYS = 400;
const ENDPOINT = 'https://datacenter.eastmoney.com/securities/api/data/v1/get';
const COLUMNS = ['SECUCODE', 'REPORT_DATE', 'DATE_TYPE_CODE', 'START_DATE', 'REPORT_DATE_SQ', 'OPERATE_INCOME',
  'OPERATE_INCOME_SQ', 'OPERATE_INCOME_YOY', 'ORG_TYPE', 'FISCAL_YEAR'];
const ABOUT = 'Hong Kong interim (six-month) revenue from Eastmoney RPT_HKF10_FN_MAININDICATOR (OPERATE_INCOME, its '
  + 'year-ago value OPERATE_INCOME_SQ and Eastmoney\'s own growth OPERATE_INCOME_YOY), filtered to watchlist.json. '
  + 'Amounts in the reporting currency as Eastmoney prints them; the CURRENCY label is not stored because it is '
  + 'unreliable, readers use ratios only. Append-only: a changed number is a new observation, nothing is removed. '
  + 'Written by scripts/fetch-hk-interims.js, read by lib/hk-interim.js.';

const tag = (s) => String(s || '').slice(0, 10);
const stamp = (iso) => iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
/** Eastmoney SECUCODE (5 digits) -> Yahoo ticker (at least 4 digits): 09992.HK -> 9992.HK, 00700.HK -> 0700.HK. */
const yahooTicker = (secucode) => /^\d{5}\.HK$/.test(secucode) ? secucode.replace(/^0(\d{4}\.HK)$/, '$1') : null;

function loadStore(file) {
  if (!fs.existsSync(file)) return null;
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (s.schemaVersion !== 1 || s.market !== 'HK') throw new Error(file + ': unexpected schemaVersion/market');
  return s;
}

/** All interim rows of the window, every check of the header applied. @returns {Promise<object[]>} */
async function fetchInterims(ctx, since) {
  const rows = [];
  let pages = 1, count = null;
  for (let p = 1; p <= pages; p++) {
    if (p > PAGE_CAP) throw new Error('HK: page cap ' + PAGE_CAP + ' reached');
    const filter = `(DATE_TYPE_CODE="002")(REPORT_DATE>='${since}')`;
    const url = `${ENDPOINT}?reportName=RPT_HKF10_FN_MAININDICATOR&columns=${COLUMNS.join(',')}`
      + `&filter=${encodeURIComponent(filter)}&pageNumber=${p}&pageSize=${PAGE_SIZE}&sortTypes=1,1&sortColumns=SECUCODE,REPORT_DATE&source=F10&client=PC`;
    const j = await ctx.fetchJson(url, { pauseMs: PAUSE_MS, headers: { 'User-Agent': USER_AGENT } });
    if (!j || j.success !== true || !j.result || !Array.isArray(j.result.data)) throw new Error('HK: answer without success/result (page ' + p + '): ' + JSON.stringify(j && j.message));
    if (count === null) { count = j.result.count; pages = j.result.pages; }
    else if (j.result.count !== count) throw new Error('HK: count changed between pages');
    rows.push(...j.result.data);
  }
  if (rows.length !== count) throw new Error(`HK: ${rows.length} rows read, header says ${count}`);
  const seen = new Set();
  for (const r of rows) {
    const key = r.SECUCODE + '|' + tag(r.REPORT_DATE);
    if (r.DATE_TYPE_CODE !== '002') throw new Error('HK: row of type ' + r.DATE_TYPE_CODE + ' in an interim query');
    if (seen.has(key)) throw new Error('HK: duplicate row ' + key);
    seen.add(key);
  }
  return rows;
}

/** One stored observation from one Eastmoney row, or null when the row carries no usable pair. */
function observation(r) {
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const o = { start: tag(r.START_DATE) || null, priorEnd: tag(r.REPORT_DATE_SQ) || null, revenue: num(r.OPERATE_INCOME),
    priorRevenue: num(r.OPERATE_INCOME_SQ), yoyPct: num(r.OPERATE_INCOME_YOY), orgType: r.ORG_TYPE || null, fiscalYear: r.FISCAL_YEAR || null };
  return o.revenue === null && o.priorRevenue === null ? null : o;
}

/** Fetch, merge append-only, write. @returns {Promise<object>} summary */
async function run(opts = {}) {
  const ctx = { fetchJson: opts.fetchJson || fetchJson };
  const now = opts.now || new Date().toISOString();
  const today = opts.today || now.slice(0, 10);
  const since = new Date(Date.parse(today + 'T00:00:00Z') - WINDOW_DAYS * 864e5).toISOString().slice(0, 10);
  const dir = opts.dir || process.env.EXCHANGE_QUARTERS_DIR || path.join(ROOT, 'external-data/exchange-quarters');
  const file = path.join(dir, 'hk.json');
  const tickers = new Set((opts.tickers || JSON.parse(fs.readFileSync(path.join(ROOT, 'watchlist.json'), 'utf8')).stocks
    .map((s) => (typeof s === 'string' ? s : s.ticker))).filter((t) => /\.HK$/.test(t || '')));
  const prev = loadStore(file);
  const next = prev ? JSON.parse(JSON.stringify(prev))
    : { schemaVersion: 1, market: 'HK', about: ABOUT, sources: {}, companies: {} };
  const rows = await fetchInterims(ctx, since);
  const src = 'hk-' + stamp(now);
  const conf = { src, fetchedAt: now, updateDate: null };
  const counts = { rows: rows.length, kept: 0, new: 0, changed: 0, confirmed: 0 };
  for (const r of rows) {
    const tk = yahooTicker(r.SECUCODE);
    if (!tk || !tickers.has(tk)) continue;
    const o = observation(r);
    if (!o) continue;
    counts.kept++;
    const c = next.companies[tk] || (next.companies[tk] = { secucode: r.SECUCODE, halfYear: {} });
    const list = c.halfYear[tag(r.REPORT_DATE)] || (c.halfYear[tag(r.REPORT_DATE)] = []);
    counts[S.mergeObservation(list, o, conf)]++;
  }
  next.sources[src] = { fetchedAt: now, endpoint: ENDPOINT + ' (RPT_HKF10_FN_MAININDICATOR, DATE_TYPE_CODE 002)', since, rows: rows.length, kept: counts.kept };
  S.assertAppendOnly(prev, next);
  if (!opts.dryRun) {
    fs.mkdirSync(dir, { recursive: true });
    writeFileAtomic(file, S.serialiseStore(next));
  }
  return counts;
}

if (require.main === module) {
  const arg = (k) => (process.argv.find((a) => a.startsWith('--' + k + '=')) || '').split('=')[1];
  run({ dryRun: process.argv.includes('--dry-run'), today: arg('today') })
    .then((c) => console.log('HK interims: ' + JSON.stringify(c)))
    .catch((e) => { console.error('::error::HK interims aborted, hk.json not written: ' + e.message); process.exit(1); });
}

module.exports = { run, observation, yahooTicker, fetchInterims };
