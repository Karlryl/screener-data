#!/usr/bin/env node
/**
 * Workstream A1: SEC EDGAR Form-4 DAILY puller (index-driven, not per-CIK).
 * =========================================================================
 * The per-ticker puller (pull-insider-form4.js) walks the SEC submissions
 * API once PER CIK — O(watchlist) requests/day, far too slow to run daily
 * for a 24k-ticker universe. This script flips the access pattern: it reads
 * SEC's DAILY FORM INDEX (one fixed-width text file per trading day listing
 * EVERY filing of every form type), keeps only FormType `4`, and intersects
 * the issuer CIK against the watchlist. That makes the per-day cost a single
 * index fetch plus one fetch per WATCHLIST HIT — typically a few dozen, not
 * thousands. NEVER iterate per-CIK over the whole universe here.
 *
 *   Daily index URL:
 *     https://www.sec.gov/Archives/edgar/daily-index/{YYYY}/QTR{n}/form.{YYYYMMDD}.idx
 *   Each Form-4 row:
 *     4   {ISSUER COMPANY NAME}   {ISSUER CIK}   {YYYYMMDD}   edgar/data/{cik}/{ACCESSION}.txt
 *   The FileName is the FULL submission .txt (Form-4 XML inline) so
 *   parseForm4Xml works on it directly.
 *
 * Merges into external-data/sec-form4-cache.json (shape shared with
 * pull-insider-form4.js: { updatedAt, userAgent, lookbackDays, byTicker }).
 * Transactions deduped by accession+date+code+shares; anything older than
 * 180 days is dropped at merge time to keep the cache bounded.
 *
 * SEC rules respected: contact User-Agent, gzip Accept-Encoding (the index
 * is large), ≥125ms throttle (≤8 req/s), atomic writes (lib/atomic-write),
 * resumable (cache re-written after every date).
 *
 * Env knobs:
 *   DAYS=5            number of recent trading days to pull (default 5)
 *   DATE=YYYYMMDD     pull a single specific date (overrides DAYS)
 *   SAMPLE_LIMIT=N    cap number of filing .txt fetches (smoke testing)
 *
 * Run:
 *   node scripts/pull-insider-form4-daily.js              # last 5 trading days
 *   DAYS=10 node scripts/pull-insider-form4-daily.js
 *   DATE=20260529 SAMPLE_LIMIT=5 node scripts/pull-insider-form4-daily.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

const { writeFileAtomic } = require('../lib/atomic-write.js');
// Reuse the (now-extended) Form-4 XML parser — the full submission .txt
// carries the ownership XML inline so parseForm4Xml works on it directly.
const { parseForm4Xml } = require('./pull-insider-form4.js');

// ─── Config ─────────────────────────────────────────────────────────────
const ROOT = path.join(__dirname, '..');
const WATCHLIST_PATH = path.join(ROOT, 'watchlist.json');
const EXTERNAL_DIR = path.join(ROOT, 'external-data');
const TICKER_CIK_MAP_PATH = path.join(EXTERNAL_DIR, 'sec-ticker-cik-map.json');
const FORM4_CACHE_PATH = path.join(EXTERNAL_DIR, 'sec-form4-cache.json');

const USER_AGENT = 'Karl Viehrig screener-data karl_viehrig@web.de';
const RATE_DELAY_MS = 125;          // ≤8 req/s, under SEC's 10/s/IP limit
const FORM4_LOOKBACK_DAYS = 180;    // drop txns older than this at merge time

const DAILY_INDEX_URL = (y, q, ymd) =>
  `https://www.sec.gov/Archives/edgar/daily-index/${y}/QTR${q}/form.${ymd}.idx`;
const SUBMISSION_TXT_URL = (cik, accDotted) =>
  `https://www.sec.gov/Archives/edgar/data/${cik}/${accDotted}.txt`;

const DAYS = process.env.DAYS ? Math.max(1, parseInt(process.env.DAYS, 10)) : 5;
const SINGLE_DATE = process.env.DATE ? String(process.env.DATE).trim() : null;
const SAMPLE_LIMIT = process.env.SAMPLE_LIMIT
  ? Math.max(1, parseInt(process.env.SAMPLE_LIMIT, 10))
  : null;

// ─── Tiny utils ─────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return null; }
}

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

// HTTP GET with gzip/deflate support (the daily index is large), redirect
// cap, and 404→{notFound} (mirrors pull-insider-form4.js's httpGet but adds
// Accept-Encoding so the index download stays small).
function httpGet(url, _depth) {
  const depth = _depth | 0;
  if (depth > 5) return Promise.reject(new Error('too many redirects (>5) for ' + url));
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate'
      }
    }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        res.resume();
        const nextUrl = res.headers.location;
        if (!nextUrl) return reject(new Error('redirect w/o Location: ' + url));
        return httpGet(nextUrl, depth + 1).then(resolve).catch(reject);
      }
      if (res.statusCode === 404) return resolve({ notFound: true });
      if (res.statusCode === 403) return reject(new Error('HTTP 403 (rate-limited or bad UA): ' + url));
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let buf = Buffer.concat(chunks);
        const enc = (res.headers['content-encoding'] || '').toLowerCase();
        try {
          if (enc === 'gzip') buf = zlib.gunzipSync(buf);
          else if (enc === 'deflate') buf = zlib.inflateSync(buf);
        } catch (e) { return reject(new Error('gunzip failed for ' + url + ': ' + e.message)); }
        resolve({ body: buf.toString('utf8') });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('timeout: ' + url)); });
  });
}

// ─── Date helpers ───────────────────────────────────────────────────────
function ymd(d) {
  return d.getUTCFullYear().toString() +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    String(d.getUTCDate()).padStart(2, '0');
}
function quarterOf(month1to12) { return Math.floor((month1to12 - 1) / 3) + 1; }
function parseYmd(s) {
  // YYYYMMDD → UTC Date
  const y = parseInt(s.slice(0, 4), 10);
  const m = parseInt(s.slice(4, 6), 10);
  const d = parseInt(s.slice(6, 8), 10);
  return new Date(Date.UTC(y, m - 1, d));
}
function isWeekend(d) { const wd = d.getUTCDay(); return wd === 0 || wd === 6; }

// Build the list of target YYYYMMDD strings. The index is posted ~22:00 ET,
// so "today" is usually not yet available — start from yesterday and walk
// back DAYS *trading* days (skipping weekends; SEC posts no index then).
function targetDates() {
  if (SINGLE_DATE) {
    if (!/^\d{8}$/.test(SINGLE_DATE)) {
      throw new Error('DATE must be YYYYMMDD, got: ' + SINGLE_DATE);
    }
    return [SINGLE_DATE];
  }
  const out = [];
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  cursor.setUTCDate(cursor.getUTCDate() - 1); // start at yesterday
  let guard = 0;
  while (out.length < DAYS && guard < DAYS * 3 + 14) {
    guard++;
    if (!isWeekend(cursor)) out.push(ymd(cursor));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return out;
}

// ─── Watchlist + ticker↔CIK maps ────────────────────────────────────────
// Build, from the SEC ticker→CIK map intersected with the watchlist:
//   - watchlistCiks: Set of UNPADDED int CIKs that are on the watchlist
//   - cikToTicker:   unpadded-int CIK → watchlist ticker symbol
// The daily index lists issuer CIKs UNPADDED, so we strip leading zeros to
// compare against the 10-digit-padded map CIKs.
function buildMaps() {
  const watchlist = readJsonSafe(WATCHLIST_PATH);
  if (!watchlist || !Array.isArray(watchlist.stocks)) {
    throw new Error('watchlist.json missing or malformed (.stocks[] required)');
  }
  const map = readJsonSafe(TICKER_CIK_MAP_PATH);
  if (!map || !map.byTicker) {
    throw new Error('sec-ticker-cik-map.json missing or malformed (.byTicker required)');
  }
  const byTicker = map.byTicker;

  // Watchlist tickers that have a known SEC CIK (i.e. US-listed bare symbols).
  const watchlistTickers = new Set();
  for (const s of watchlist.stocks) {
    const t = (s.ticker || s.yahoo_symbol || '').toUpperCase().trim();
    if (t && byTicker[t]) watchlistTickers.add(t);
  }

  const watchlistCiks = new Set();
  const cikToTicker = new Map();
  for (const ticker of watchlistTickers) {
    const cikPadded = byTicker[ticker].cik;
    const cikInt = parseInt(cikPadded, 10);
    if (!Number.isFinite(cikInt)) continue;
    watchlistCiks.add(cikInt);
    // First ticker wins if two map to the same CIK (rare share-class case);
    // the daily index resolves the issuer, not the share class, so either
    // symbol is acceptable for keying.
    if (!cikToTicker.has(cikInt)) cikToTicker.set(cikInt, ticker);
  }
  return { watchlistCiks, cikToTicker, watchlistTickers, byTicker };
}

// ─── Daily-index parsing ────────────────────────────────────────────────
// Rows are fixed-width-ish but the company name contains spaces, so we
// anchor on the stable trailing fields: FileName (last token, matches
// edgar/data/...), DateFiled (8 digits before it), CIK (digits before that).
// FormType is the first token. Returns [{cik:int, dateFiled, fileName,
// accession}].
function parseDailyForm4Rows(text) {
  const rows = [];
  const lines = text.split(/\r?\n/);
  // audit F-A-2026-06-21: prevents silent loss of Form 4/A amendments that the
  // quarterly backfill keeps (daily-vs-history cache divergence). Accept the
  // optional '/A' amendment suffix in both the fast-path prefilter and regex.
  const re = /^4(\/A)?\s+.+?\s+(\d+)\s+(\d{8})\s+(edgar\/data\/\d+\/([0-9-]+)\.txt)\s*$/;
  for (const line of lines) {
    if (line.charAt(0) !== '4') continue;       // FormType column starts with '4' (covers '4' and '4/A')
    const m = re.exec(line);
    if (!m) continue;
    rows.push({
      cik: parseInt(m[1], 10),
      dateFiled: m[2],
      fileName: m[3],
      accession: m[4]                            // dotted, e.g. 0001105965-26-000001
    });
  }
  return rows;
}

// ─── Merge / dedupe ─────────────────────────────────────────────────────
function txnKey(t) {
  return [t.accessionNumber, t.transactionDate, t.transactionCode, t.transactionShares].join('|');
}
function withinLookback(dateStr, lookbackDays) {
  if (!dateStr) return false;
  const t = Date.parse(dateStr);
  if (!Number.isFinite(t)) return false;
  return (Date.now() - t) <= lookbackDays * 86400000;
}

// Merge a batch of new txns into byTicker[ticker], dedupe by txnKey, and
// drop anything older than the 180d lookback. Returns count actually added.
function mergeTransactions(byTicker, ticker, cikPadded, name, newTxns) {
  let entry = byTicker[ticker];
  if (!entry || typeof entry !== 'object') {
    entry = { ticker, cik: cikPadded, name: name || '', fetchedAt: null, transactions: [] };
    byTicker[ticker] = entry;
  }
  if (!Array.isArray(entry.transactions)) entry.transactions = [];
  // Prune stale txns already in the cache so it stays bounded.
  entry.transactions = entry.transactions.filter(t =>
    withinLookback(t.transactionDate || t.filingDate, FORM4_LOOKBACK_DAYS));

  const seen = new Set(entry.transactions.map(txnKey));
  let added = 0;
  for (const t of newTxns) {
    if (!withinLookback(t.transactionDate || t.filingDate, FORM4_LOOKBACK_DAYS)) continue;
    const k = txnKey(t);
    if (seen.has(k)) continue;
    seen.add(k);
    entry.transactions.push(t);
    added++;
  }
  entry.cik = cikPadded;
  if (name && !entry.name) entry.name = name;
  entry.fetchedAt = new Date().toISOString();
  return added;
}

function writeCache(byTicker) {
  writeFileAtomic(FORM4_CACHE_PATH, JSON.stringify({
    updatedAt: new Date().toISOString(),
    userAgent: USER_AGENT,
    lookbackDays: FORM4_LOOKBACK_DAYS,
    byTicker
  }, null, 2));
}

// ─── Main ───────────────────────────────────────────────────────────────
async function main() {
  ensureDir(EXTERNAL_DIR);

  const { watchlistCiks, cikToTicker, watchlistTickers, byTicker: tickerCikMap } = buildMaps();
  console.log('[maps] watchlist US tickers (CIK known): ' + watchlistTickers.size +
    ' → ' + watchlistCiks.size + ' distinct issuer CIKs');

  const dates = targetDates();
  console.log('[dates] targeting ' + dates.length + ' date(s): ' + dates.join(', '));

  const existing = readJsonSafe(FORM4_CACHE_PATH) || {};
  const byTicker = (existing.byTicker && typeof existing.byTicker === 'object')
    ? existing.byTicker : {};

  let grandFetched = 0, grandHits = 0, grandAdded = 0, grandPBuys = 0, grandErrors = 0;
  let fetchBudgetLeft = SAMPLE_LIMIT == null ? Infinity : SAMPLE_LIMIT;

  for (const date of dates) {
    if (fetchBudgetLeft <= 0) {
      console.log('[sample] SAMPLE_LIMIT reached — stopping before date ' + date);
      break;
    }
    const d = parseYmd(date);
    const q = quarterOf(d.getUTCMonth() + 1);
    const url = DAILY_INDEX_URL(d.getUTCFullYear(), q, date);

    let idxRes;
    try { idxRes = await httpGet(url); }
    catch (e) {
      console.warn('[' + date + '] index fetch ERROR: ' + e.message + ' — skipping date');
      grandErrors++;
      await sleep(RATE_DELAY_MS);
      continue;
    }
    await sleep(RATE_DELAY_MS);
    if (idxRes.notFound) {
      console.log('[' + date + '] no daily index (holiday/weekend/not-yet-posted) — skipping');
      continue;
    }

    const allRows = parseDailyForm4Rows(idxRes.body);
    // Intersect issuer CIK with the watchlist.
    const hits = allRows.filter(r => watchlistCiks.has(r.cik));
    console.log('[' + date + '] form-4 rows=' + allRows.length +
      ' watchlist hits=' + hits.length);

    let dayFetched = 0, dayAdded = 0, dayPBuys = 0;
    for (const hit of hits) {
      if (fetchBudgetLeft <= 0) {
        console.log('  [sample] SAMPLE_LIMIT reached mid-date — stopping');
        break;
      }
      const ticker = cikToTicker.get(hit.cik);
      const cikPadded = (tickerCikMap[ticker] && tickerCikMap[ticker].cik) ||
        String(hit.cik).padStart(10, '0');
      const name = (tickerCikMap[ticker] && tickerCikMap[ticker].name) || '';

      const docUrl = SUBMISSION_TXT_URL(hit.cik, hit.accession);
      let docRes;
      try { docRes = await httpGet(docUrl); }
      catch (e) {
        console.warn('  [' + ticker + '] fetch ERROR ' + hit.accession + ': ' + e.message);
        grandErrors++;
        await sleep(RATE_DELAY_MS);
        continue;
      }
      await sleep(RATE_DELAY_MS);
      fetchBudgetLeft--;
      dayFetched++; grandFetched++;
      if (docRes.notFound || !docRes.body) continue;

      let parsed;
      try { parsed = parseForm4Xml(docRes.body); }
      catch (e) { continue; } // tolerate per-filing parse errors

      const filingDate = hit.dateFiled.slice(0, 4) + '-' +
        hit.dateFiled.slice(4, 6) + '-' + hit.dateFiled.slice(6, 8);
      const newTxns = [];
      for (const t of parsed) {
        t.accessionNumber = hit.accession;
        t.filingDate = filingDate;
        // Prefer the symbol parsed from the filing; fall back to the
        // watchlist ticker the CIK resolved to.
        if (!t.issuerTradingSymbol) t.issuerTradingSymbol = ticker;
        newTxns.push(t);
        if (t.transactionCode === 'P') { dayPBuys++; grandPBuys++; }
      }
      const added = mergeTransactions(byTicker, ticker, cikPadded, name, newTxns);
      dayAdded += added; grandAdded += added;
    }

    grandHits += hits.length;
    console.log('[' + date + '] done: fetched=' + dayFetched + ' txnsAdded=' +
      dayAdded + ' P-buys=' + dayPBuys);

    // Resumable: atomically re-write the full cache after every date.
    writeCache(byTicker);
  }

  // Final write (covers the SINGLE_DATE / early-break paths).
  writeCache(byTicker);

  const cacheTickers = Object.keys(byTicker).length;
  console.log('');
  console.log('Done. dates=' + dates.length + ' hits=' + grandHits +
    ' fetched=' + grandFetched + ' txnsAdded=' + grandAdded +
    ' P-buys=' + grandPBuys + ' errors=' + grandErrors);
  console.log('Cache: ' + FORM4_CACHE_PATH + ' (' + cacheTickers + ' tickers)');
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = {
  parseDailyForm4Rows, targetDates, buildMaps, mergeTransactions,
  _internals: { httpGet, quarterOf, ymd, parseYmd, withinLookback, txnKey }
};
