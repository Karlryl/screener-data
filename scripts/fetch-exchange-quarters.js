#!/usr/bin/env node
'use strict';
/**
 * scripts/fetch-exchange-quarters.js — append-only store of year-to-date revenue as printed by
 * exchange-fed sources, for the later pair guard and gap fill (G2b). Tag 1399.
 *
 *   China A  Eastmoney RPT_F10_FINANCE_GINCOME (general companies, TOTAL_OPERATE_INCOME and
 *            OPERATE_INCOME) and RPT_F10_FINANCE_SINCOME (securities firms, OPERATE_INCOME),
 *            whole market per period, filtered to watchlist.json -> external-data/exchange-quarters/cn.json
 *   Taiwan   MOPS POST https://mops.twse.com.tw/mops/api/t164sb04, one company and season per call,
 *            row 營業收入合計 (general) or 收益合計 (securities/futures)
 *            -> external-data/exchange-quarters/tw.json
 *
 * NOTHING READS THE STORE YET. No board number can change through this script.
 *
 * Precedent and owner decision: scripts/build-cnannual.js lines 19-21 (Eastmoney, owner decision of
 * 19.08.2026 "voll nutzen wie jede andere Quelle"). Only the columns and periods the guard and the
 * fill need are stored. The legacy host mopsov.twse.com.tw (robots Disallow: /) is never called and
 * MOPS `urlList` links are never followed.
 *
 * Failure behaviour (per market, the other market is independent):
 *   China   any non-200, success:false other than 9201, invalid JSON, count/uniqueness mismatch
 *           (holeBericht), unknown REPORT_TYPE, a currency other than CNY, a row for another period
 *           or the call cap (220) -> the market aborts, cn.json is not written, exit code 1.
 *   Taiwan  A season is first asked 25 days after its quarter end. MOPS code 406 (no data, season not
 *           filed yet) is recorded and retried after 3 days;
 *           no revenue line (banks, insurers, holdings) is recorded and retried after 30 days; code 500
 *           公司代號格式錯誤 for a company without stored seasons whose id contains a letter (preferred
 *           shares: 1312A, 2002A are the only two in the watchlist) is recorded as 'bad-id' and retried
 *           after 30 days. The same answer for an all-digit id, or for a company with stored seasons,
 *           is a failure: MOPS serves every listed numeric id, so that answer there means a systemic
 *           change, and it falls under the abort rule below. A share threshold on the bad-id count
 *           cannot do this: on a quiet day the two preferred ids are 2 of 2 calls (100 %), while a
 *           systemic answer in the fill phase hits up to 600 numeric ids. The letter rule depends on
 *           neither the call count nor the day. Code 500 "該 1262 公開發行公司不繼續公開發行！" (measured
 *           06.10.2026), when it names the requested company, is recorded per season as 'ceased' and
 *           retried after 30 days, including for companies with stored seasons, without counting as a failure.
 *           Any other failure skips the company and is counted.
 *           10 failures in a row, or at least 5 failures that are more than 20 % of the calls -> abort, tw.json is not written, exit 1.
 *   Before every write the new store is checked against the old one (assertAppendOnly): an old
 *   observation that would be lost or changed throws and nothing is written. Writes are atomic.
 *
 * Usage: node scripts/fetch-exchange-quarters.js [--market=cn,tw] [--dry-run] [--force-cn] [--tw-cap=600]
 *   --dry-run   fetch and check everything, write nothing (branch runs of the workflow)
 *   --force-cn  run the China pass even when the weekly cadence would skip it
 * Env EXCHANGE_QUARTERS_DIR overrides the store directory (tests).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { fetchJson } = require(path.join(ROOT, 'lib/fetch-retry.js'));
const { writeFileAtomic } = require(path.join(ROOT, 'lib/atomic-write.js'));
const { holeBericht, secucodeFuerYahoo, istEchterACode } = require(path.join(ROOT, 'scripts/build-cnannual.js'));
const S = require(path.join(ROOT, 'lib/exchange-quarter-store.js'));

const USER_AGENT = 'screener-data exchange-quarters fetch';
const PAUSE_MS = 1500;
// Measured 02.10.2026 (count of RPT_F10_FINANCE_GINCOME per REPORT_DATE): 7,216-7,420 rows at 03-31 and
// 09-30, but 13,469-14,563 rows at 06-30 and 12-31 (the answers also carry .NQ and .BJ codes; that
// half-year/annual-only NEEQ reporters cause the doubling is a guess, not verified). At 500 rows per page the 8-period window is about 160 GINCOME pages
// plus 8 SINCOME pages, about 185 at the peak of the Q3 season. The planned cap of 150 assumed 14
// pages per period. A server-side type filter (SECURITY_TYPE_CODE) would cut the NEEQ pages but also
// drops listings with another type code (689009.SH is 058001008), so the cap is raised instead.
const CN_CAP = 220;
const TW_CAP = 600;
const DAY_MS = 24 * 3600 * 1000;
const CN_WEEKLY_MS = 6 * DAY_MS;          // outside the report seasons: at most one China pass per 6 days
const TW_REFRESH_MS = 7 * DAY_MS;         // newest season of every company re-read once every 7 days
const TW_RETRY_NODATA_MS = 3 * DAY_MS;    // 406: season not filed yet
const TW_RETRY_NOLINE_MS = 30 * DAY_MS;   // no revenue line, a rejected company id, or ceased public reporting
const TW_RETRY_FAIL_MS = 1 * DAY_MS;
const TW_SEASON_LEAD_MS = 25 * DAY_MS;    // no MOPS call for a season younger than this
const MOPS_URL = 'https://mops.twse.com.tw/mops/api/t164sb04';
const TW_LINES = ['營業收入合計', '收益合計'];
// MOPS t164sb04 answer for a preferred-share id, measured 02.10.2026 for 1312A and 2002A (115Q2):
// {"code":500,"message":"公司代號格式錯誤","result":null}
const MOPS_BAD_ID = '公司代號格式錯誤';
// MOPS t164sb04 answer for 1262 (115Q2), measured 06.10.2026:
// {"code":500,"message":"該 1262 公開發行公司不繼續公開發行！","result":null}
const MOPS_CEASED = '公開發行公司不繼續公開發行';
const EASTMONEY_ENDPOINT = 'https://datacenter.eastmoney.com/securities/api/data/v1/get (source=HSF10)';

const CN_TABLES = [
  { table: 'GINCOME', report: 'RPT_F10_FINANCE_GINCOME', orgType: '通用',
    columns: ['SECUCODE', 'ORG_TYPE', 'REPORT_DATE', 'REPORT_TYPE', 'NOTICE_DATE', 'UPDATE_DATE', 'CURRENCY', 'TOTAL_OPERATE_INCOME', 'OPERATE_INCOME'] },
  { table: 'SINCOME', report: 'RPT_F10_FINANCE_SINCOME', orgType: '证券',
    columns: ['SECUCODE', 'ORG_TYPE', 'REPORT_DATE', 'REPORT_TYPE', 'NOTICE_DATE', 'UPDATE_DATE', 'CURRENCY', 'OPERATE_INCOME'] },
];

const ABOUT = {
  CN: 'Year-to-date revenue (yuan) as printed in the A-share reports, from Eastmoney RPT_F10_FINANCE_GINCOME '
    + '(general companies: total = TOTAL_OPERATE_INCOME, operate = OPERATE_INCOME) and RPT_F10_FINANCE_SINCOME '
    + '(securities firms: operate = OPERATE_INCOME), filtered to watchlist.json. Append-only: a changed number '
    + 'is a new observation, nothing is removed. Precedent: scripts/build-cnannual.js lines 19-21 (owner decision '
    + 'of 19.08.2026). Written by scripts/fetch-exchange-quarters.js. Not read by scoring yet.',
  TW: 'Revenue as printed in the MOPS t164sb04 income statement (row 營業收入合計, or 收益合計 for securities/futures '
    + 'firms), in thousand TWD, with the column titles as printed (quarter, prior-year quarter, year to date, '
    + 'prior-year year to date; season 4 = full year). Append-only. Precedent: scripts/build-cnannual.js lines '
    + '19-21 (owner decision of 19.08.2026). Written by scripts/fetch-exchange-quarters.js. Not read by scoring yet.',
};

const tag = (s) => String(s || '').slice(0, 10);
const stamp = (iso) => iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

function loadStore(file, market) {
  if (!fs.existsSync(file)) return null;
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (s.schemaVersion !== 1 || s.market !== market) throw new Error(file + ': unexpected schemaVersion/market');
  return s;
}
function emptyStore(market) {
  return market === 'CN'
    ? { schemaVersion: 1, market: 'CN', currency: 'CNY', unit: 1, tables: { GINCOME: '通用', SINCOME: '证券' }, about: ABOUT.CN, sources: {}, companies: {} }
    : { schemaVersion: 1, market: 'TW', currency: 'TWD', unit: S.TW_UNIT, about: ABOUT.TW, sources: {}, companies: {} };
}
const clone = (o) => JSON.parse(JSON.stringify(o));

function watchlistTickers(file) {
  const w = JSON.parse(fs.readFileSync(file, 'utf8'));
  return (w.stocks || []).map((s) => (typeof s === 'string' ? s : s.ticker)).filter(Boolean);
}

/** Latest board-history day: rank and quarter gaps of the Taiwan cohort rows (queue order). */
function boardPriority(boardRoot) {
  const out = new Map();
  if (!fs.existsSync(boardRoot)) return out;
  const days = fs.readdirSync(boardRoot).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (!days.length) return out;
  const dir = path.join(boardRoot, days[days.length - 1]);
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;   // calibration.json has no cohort and adds nothing
    const b = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const rows of Object.values(b.cohort || {})) {
      for (const r of rows || []) {
        if (!r || !/\.TWO?$/.test(r.ticker || '')) continue;
        const q = (r.pit && r.pit.revenueQ) || [];
        const ends = (r.pit && r.pit.revenueQEnds) || [];
        let gap = q.some((v) => !Number.isFinite(v));
        for (let i = 1; i < ends.length && !gap; i += 1) {
          const a = new Date(ends[i - 1] + 'T00:00:00Z'), c = new Date(ends[i] + 'T00:00:00Z');
          const months = (a.getUTCFullYear() - c.getUTCFullYear()) * 12 + a.getUTCMonth() - c.getUTCMonth();
          if (months !== 3) gap = true;
        }
        const prev = out.get(r.ticker);
        const rank = Number.isFinite(r.rank) ? r.rank : 1e9;
        if (!prev || rank < prev.rank) out.set(r.ticker, { rank, gap: gap || (prev && prev.gap) || false });
        else if (gap) prev.gap = true;
      }
    }
  }
  return out;
}

// ── China ─────────────────────────────────────────────────────────────────────
async function runChina(ctx) {
  const file = path.join(ctx.dir, 'cn.json');
  const prev = loadStore(file, 'CN');
  const today = ctx.now().toISOString().slice(0, 10);
  const lastRun = prev ? Object.values(prev.sources).map((s) => s.fetchedAt).sort().pop() : null;
  if (!ctx.forceCn && !S.inChinaReportSeason(today) && lastRun && ctx.now() - Date.parse(lastRun) < CN_WEEKLY_MS) {
    ctx.log('CN: skipped (outside the report seasons, last pass ' + lastRun + ' is less than 6 days old)');
    return { market: 'CN', skipped: true };
  }
  const want = new Map();
  for (const tk of ctx.tickers) {
    if (!/\.(SS|SZ)$/.test(tk)) continue;
    const sec = secucodeFuerYahoo(tk);
    if (istEchterACode(sec)) want.set(sec, tk);
  }
  const fetchedAt = ctx.now().toISOString();
  const src = 'cn-' + stamp(fetchedAt);
  let calls = 0;
  const holen = (url, o) => {
    calls += 1;
    if (calls > ctx.cnCap) throw new Error('call cap of ' + ctx.cnCap + ' reached');
    return ctx.fetchJson(url, { ...o, pauseMs: PAUSE_MS, headers: { 'User-Agent': USER_AGENT } });
  };
  const periods = S.chinaPeriodWindow(today);
  const requests = [];
  const fresh = [];                 // [tk, period, obs, updateDate]
  const otherOrgTypes = {};
  let ambiguous = 0;
  for (const period of periods) {
    for (const t of CN_TABLES) {
      const rows = await holeBericht(t.report, t.columns, "(REPORT_DATE='" + period + "')", 'HSF10', 'SECUCODE', holen);
      requests.push({ report: t.report, period, rows: rows.length });
      ctx.log('CN ' + t.table + ' ' + period + ': ' + rows.length + ' rows, ' + calls + ' calls so far');
      const seen = new Map();
      for (const z of rows) {
        if (tag(z.REPORT_DATE) !== period) throw new Error(t.report + ': row for ' + z.REPORT_DATE + ' in the answer for ' + period);
        const tk = want.get(z.SECUCODE);
        if (!tk) continue;
        if (z.ORG_TYPE !== t.orgType) {
          const k = t.table + ':' + z.ORG_TYPE;
          otherOrgTypes[k] = (otherOrgTypes[k] || 0) + 1;
          continue;
        }
        if (!S.CN_REPORT_TYPES.has(z.REPORT_TYPE)) throw new Error(t.report + ': unknown REPORT_TYPE ' + JSON.stringify(z.REPORT_TYPE) + ' (' + z.SECUCODE + ' ' + period + ')');
        if (z.CURRENCY !== 'CNY') throw new Error(t.report + ': currency ' + JSON.stringify(z.CURRENCY) + ' (' + z.SECUCODE + ' ' + period + '), the store is CNY only');
        const obs = { table: t.table, reportType: z.REPORT_TYPE };   // ORG_TYPE = tables[table] in the header
        if (t.table === 'GINCOME') obs.total = z.TOTAL_OPERATE_INCOME;
        obs.operate = z.OPERATE_INCOME;
        obs.noticeDate = tag(z.NOTICE_DATE);
        const key = JSON.stringify(obs);
        if (seen.has(z.SECUCODE)) {
          if (seen.get(z.SECUCODE).key !== key) seen.get(z.SECUCODE).bad = true;
          continue;
        }
        seen.set(z.SECUCODE, { tk, obs, key, updateDate: tag(z.UPDATE_DATE) });
      }
      for (const v of seen.values()) {
        if (v.bad) { ambiguous += 1; continue; }   // two different rows for one company and period: not decidable
        fresh.push([v.tk, period, v.obs, v.updateDate]);
      }
    }
  }
  const next = prev ? clone(prev) : emptyStore('CN');
  const counts = { new: 0, confirmed: 0, changed: 0 };
  const readNow = new Set();
  for (const [tk, period, obs, updateDate] of fresh) {
    const c = next.companies[tk] || (next.companies[tk] = { secucode: secucodeFuerYahoo(tk), ytd: {} });
    const list = c.ytd[period] || (c.ytd[period] = []);
    counts[S.mergeObservation(list, obs, { src, fetchedAt, updateDate })] += 1;
    readNow.add(tk + ' ' + period);
  }
  // Stored companies this run did not read again for a covered period (missing from the answer,
  // ambiguous, other table): listed so that lastConfirmedAt() does not count this run for them.
  const absent = {};
  for (const [tk, c] of Object.entries(next.companies)) {
    for (const period of periods) {
      if (c.ytd[period] && !readNow.has(tk + ' ' + period)) (absent[period] || (absent[period] = [])).push(tk);
    }
  }
  next.sources[src] = { fetchedAt, endpoint: EASTMONEY_ENDPOINT, periods, calls, requests, absent };
  S.assertAppendOnly(prev, next);
  const text = S.serialiseStore(next);
  if (!ctx.dryRun) writeFileAtomic(file, text);
  const absentCount = Object.values(absent).reduce((n, a) => n + a.length, 0);
  const summary = { market: 'CN', src, calls, periods: periods.length, rows: fresh.length, ...counts, ambiguous, absent: absentCount, otherOrgTypes,
    companies: Object.keys(next.companies).length, bytes: Buffer.byteLength(text), written: !ctx.dryRun };
  ctx.log('CN: ' + JSON.stringify(summary));
  return summary;
}

// ── Taiwan ────────────────────────────────────────────────────────────────────
function taiwanQueue(store, tickers, seasons, priority, nowMs) {
  const lastRead = new Map();   // 'ticker key' -> newest fetchedAt (from the run log)
  for (const s of Object.values((store && store.sources) || {})) {
    for (const k of s.read || []) if (!lastRead.has(k) || lastRead.get(k) < s.fetchedAt) lastRead.set(k, s.fetchedAt);
  }
  const tw = tickers.filter((t) => /\.TWO?$/.test(t));
  const tier = (t) => { const p = priority.get(t); if (!p) return 3; if (p.rank <= 100) return 0; return p.gap ? 1 : 2; };
  const rank = (t) => (priority.get(t) ? priority.get(t).rank : 1e9);
  tw.sort((a, b) => tier(a) - tier(b) || rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
  const first = [], refresh = [];
  for (const tk of tw) {
    const c = (store && store.companies[tk]) || { seasons: {}, noData: {} };
    for (const s of seasons) {
      if (c.seasons[s.key]) continue;
      // ponytail: fixed lead time instead of per-company filing calendars; a season is not asked
      // before 25 days after its quarter end (02.10.2026: 115Q3 waits, it would only answer 406).
      if (nowMs - Date.parse(s.periodEnd + 'T00:00:00Z') < TW_SEASON_LEAD_MS) continue;
      const nd = c.noData && c.noData[s.key];
      if (nd) {
        const wait = nd.code === 406 ? TW_RETRY_NODATA_MS : nd.code === 'no-line' || nd.code === 'bad-id' || nd.code === 'ceased' ? TW_RETRY_NOLINE_MS : TW_RETRY_FAIL_MS;
        if (nowMs - Date.parse(nd.at) < wait) continue;
      }
      first.push({ tk, s });
    }
    const newest = seasons.find((s) => c.seasons[s.key]);
    if (newest) {
      const nd = c.noData && c.noData[newest.key];
      if (nd && nd.code === 'ceased' && nowMs - Date.parse(nd.at) < TW_RETRY_NOLINE_MS) continue;
      const at = lastRead.get(tk + ' ' + newest.key);
      if (!at || nowMs - Date.parse(at) >= TW_REFRESH_MS) refresh.push({ tk, s: newest });
    }
  }
  return [...first, ...refresh];
}

async function runTaiwan(ctx) {
  const file = path.join(ctx.dir, 'tw.json');
  const prev = loadStore(file, 'TW');
  const now = ctx.now();
  const today = now.toISOString().slice(0, 10);
  const seasons = S.taiwanSeasonWindow(today);
  const queue = taiwanQueue(prev, ctx.tickers, seasons, ctx.priority, now.getTime()).slice(0, ctx.twCap);
  const next = prev ? clone(prev) : emptyStore('TW');
  const fetchedAt = now.toISOString();
  const src = 'tw-' + stamp(fetchedAt);
  const st = { calls: 0, ok: 0, noData: 0, noLine: 0, badId: 0, ceased: 0, failed: 0, new: 0, confirmed: 0, changed: 0 };
  const failures = [];
  const read = [];
  let inARow = 0;
  for (const { tk, s } of queue) {
    const c = next.companies[tk] || (next.companies[tk] = { companyId: tk.replace(/\.TWO?$/, ''), seasons: {}, noData: {} });
    const at = ctx.now().toISOString();
    const body = JSON.stringify({ companyId: c.companyId, dataType: '2', season: String(s.season), year: String(s.rocYear), subsidiaryCompanyId: '' });
    st.calls += 1;
    let why = null;
    try {
      const j = await ctx.fetchJson(MOPS_URL, { body, pauseMs: PAUSE_MS, headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/json' } });
      if (j && j.code === 406) { c.noData[s.key] = { at, code: 406 }; st.noData += 1; inARow = 0; continue; }
      if (j && j.code === 500 && j.message === MOPS_BAD_ID && /[A-Za-z]/.test(c.companyId) && !Object.keys(c.seasons).length) {
        c.noData[s.key] = { at, code: 'bad-id' }; st.badId += 1; inARow = 0; continue;
      }
      if (j && j.code === 500 && typeof j.message === 'string' && j.message.includes(MOPS_CEASED)
        && j.message.split(/[^A-Za-z0-9]+/).includes(c.companyId)) {
        c.noData[s.key] = { at, code: 'ceased' }; st.ceased += 1; inARow = 0; continue;
      }
      const r = j && j.result;
      if (!j || j.code !== 200 || !r) why = 'code ' + (j && j.code) + ' ' + JSON.stringify(j && j.message);
      else if (String(r.year) !== String(s.rocYear) || String(r.season) !== String(s.season)) why = 'answer is for ' + r.year + 'Q' + r.season;
      else {
        const rows = (r.reportList || []).filter((x) => Array.isArray(x) && TW_LINES.includes(x[0]));
        if (!rows.length) { c.noData[s.key] = { at, code: 'no-line' }; st.noLine += 1; inARow = 0; continue; }
        if (rows.length > 1) why = 'more than one revenue line';
        else {
          const labels = (r.titles || []).slice(1).map((t) => t && t.main);
          const row = rows[0];
          if (!labels.length || row.length !== 1 + 2 * labels.length) why = 'titles do not match the row';
          else {
            const columns = labels.map((l, i) => [l, S.parseMopsNumber(row[1 + 2 * i])]);
            const obs = { reportType: r.reportType, line: row[0], columns };
            const list = c.seasons[s.key] || (c.seasons[s.key] = []);
            st[S.mergeObservation(list, obs, { src, fetchedAt: at, updateDate: null })] += 1;
            read.push(tk + ' ' + s.key);
            delete c.noData[s.key];
            st.ok += 1; inARow = 0;
            continue;
          }
        }
      }
    } catch (e) {
      why = e.message;
    }
    st.failed += 1; inARow += 1;
    failures.push(tk + ' ' + s.key + ': ' + why);
    c.noData[s.key] = { at, code: 'failed' };
    if (inARow >= 10) throw new Error('MOPS: 10 failures in a row (last: ' + failures.slice(-3).join(' | ') + ')');
  }
  if (st.failed >= 5 && st.failed > 0.2 * st.calls) {
    throw new Error('MOPS: ' + st.failed + ' of ' + st.calls + ' calls failed (more than 20 %): ' + failures.slice(0, 5).join(' | '));
  }
  next.sources[src] = { fetchedAt, endpoint: 'POST ' + MOPS_URL, seasons: seasons.map((x) => x.key), calls: st.calls,
    ok: st.ok, noData: st.noData, noLine: st.noLine, badId: st.badId, ceased: st.ceased, failed: st.failed, read };
  S.assertAppendOnly(prev, next);
  const text = S.serialiseStore(next);
  if (!ctx.dryRun) writeFileAtomic(file, text);
  const summary = { market: 'TW', src, queued: queue.length, ...st, companies: Object.keys(next.companies).length,
    bytes: Buffer.byteLength(text), written: !ctx.dryRun };
  ctx.log('TW: ' + JSON.stringify(summary));
  if (failures.length) ctx.log('TW failures: ' + failures.slice(0, 20).join(' | '));
  return summary;
}

async function main(opts = {}) {
  const ctx = {
    fetchJson: opts.fetchJson || fetchJson,
    now: opts.now || (() => new Date()),
    dir: opts.dir || process.env.EXCHANGE_QUARTERS_DIR || path.join(ROOT, 'external-data', 'exchange-quarters'),
    tickers: opts.tickers || watchlistTickers(path.join(ROOT, 'watchlist.json')),
    priority: opts.priority || boardPriority(path.join(ROOT, 'board-history')),
    dryRun: !!opts.dryRun,
    forceCn: !!opts.forceCn,
    cnCap: opts.cnCap || CN_CAP,
    twCap: opts.twCap || TW_CAP,
    log: opts.log || ((m) => console.log(m)),
  };
  const markets = opts.markets || ['cn', 'tw'];
  if (!ctx.dryRun) fs.mkdirSync(ctx.dir, { recursive: true });
  const results = [];
  let exitCode = 0;
  for (const m of markets) {
    try { results.push(await (m === 'cn' ? runChina(ctx) : runTaiwan(ctx))); }
    catch (e) {
      exitCode = 1;
      results.push({ market: m.toUpperCase(), aborted: e.message });
      ctx.log('::error::exchange-quarters ' + m.toUpperCase() + ' aborted, store not written: ' + e.message);
    }
  }
  return { exitCode, results };
}

if (require.main === module) {
  const arg = (name) => { const a = process.argv.find((x) => x.startsWith('--' + name + '=')); return a ? a.split('=')[1] : null; };
  main({
    markets: arg('market') ? arg('market').split(',') : undefined,
    dryRun: process.argv.includes('--dry-run'),
    forceCn: process.argv.includes('--force-cn'),
    twCap: arg('tw-cap') ? Number(arg('tw-cap')) : undefined,
  }).then((r) => process.exit(r.exitCode), (e) => { console.error('::error::' + e.message); process.exit(1); });
}

module.exports = { main, taiwanQueue, boardPriority, CN_TABLES, CN_CAP, TW_CAP, MOPS_URL, USER_AGENT };
