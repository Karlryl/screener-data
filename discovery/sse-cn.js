#!/usr/bin/env node
/**
 * SSE China (Shanghai Stock Exchange) Universe Discovery
 * ======================================================
 * Source: official SSE company register (keyless, live-verified 2026-07-03).
 *   https://query.sse.com.cn/sseQuery/commonQuery.do
 *     ?sqlId=COMMON_SSE_CP_GPJCTPZ_GPLB_GP_L  (A-share listed companies)
 *
 * The endpoint 403s without a `Referer: https://www.sse.com.cn/` header.
 * Rows live under BOTH `result[]` and `pageHelp.data[]` (identical content);
 * we read `result`. Each row carries A_STOCK_CODE, FULL_NAME_IN_ENGLISH,
 * LIST_DATE (YYYYMMDD), LIST_BOARD and DELIST_DATE.
 *
 * pageSize=2000 returns the full register (~2508 rows) in a single response —
 * the endpoint ignores paging once pageSize exceeds the total, so no loop is
 * needed. Delisted rows (DELIST_DATE != '-') are dropped, leaving ~2300 live
 * A-shares incl. the STAR Market (688xxx).
 *
 * yahooTicker = A_STOCK_CODE + '.SS'  (e.g. 600000.SS, 688797.SS)
 * exchange = 'SSE', country = 'China'.
 *
 * Node built-ins only. Never throws — returns an empty Map() on any failure
 * (fail-silent, mirroring finnhub.js).
 *
 * Returns Map<yahooTicker, {ticker, name, exchange, source, country, ipoDate?}>
 */
'use strict';
const https = require('https');

const SSE_URL =
  'https://query.sse.com.cn/sseQuery/commonQuery.do' +
  '?sqlId=COMMON_SSE_CP_GPJCTPZ_GPLB_GP_L' +
  '&isPagination=true&pageHelp.pageSize=2000' +
  '&pageHelp.pageNo=1&pageHelp.beginPage=1&pageHelp.endPage=1';

const REFERER = 'https://www.sse.com.cn/';

// mirror finnhub.js / nasdaq-all.js redirect hardening: cap recursion, resolve
// relative Location, follow 301/302/307/308.
const MAX_REDIRECTS = 5;
function get(url, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        // SSE serves 403 without this Referer.
        'Referer': REFERER,
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (screener-data)'
      }
    }, res => {
      if (res.statusCode === 301 || res.statusCode === 302 ||
          res.statusCode === 307 || res.statusCode === 308) {
        res.resume(); // drain body before following redirect
        const loc = res.headers.location;
        if (!loc) return reject(new Error('HTTP ' + res.statusCode + ' without Location header'));
        if (redirectsLeft <= 0) return reject(new Error('too many redirects'));
        let nextUrl;
        try { nextUrl = new URL(loc, url).toString(); }
        catch (e) { return reject(new Error('invalid redirect Location: ' + loc)); }
        return get(nextUrl, redirectsLeft - 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume(); // drain non-200 body to avoid socket leak
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// SSE LIST_DATE is 'YYYYMMDD'; emit 'YYYY-MM-DD' or undefined if malformed.
function toIpoDate(raw) {
  const s = String(raw || '').trim();
  if (!/^\d{8}$/.test(s)) return undefined;
  return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
}

async function fetchSseUniverse() {
  const result = new Map();
  console.log('  [SSE-CN] Fetching Shanghai A-share register...');
  let body;
  try {
    body = await get(SSE_URL);
  } catch (e) {
    console.error('  [SSE-CN] fetch failed: ' + e.message);
    return result;
  }

  let data;
  try {
    const j = JSON.parse(body);
    // Rows live under result[] (mirror of pageHelp.data[]).
    data = Array.isArray(j.result) ? j.result
      : (j.pageHelp && Array.isArray(j.pageHelp.data) ? j.pageHelp.data : null);
  } catch (e) {
    console.error('  [SSE-CN] JSON parse failed: ' + e.message);
    return result;
  }
  if (!Array.isArray(data)) {
    console.error('  [SSE-CN] unexpected response shape (no result[] / pageHelp.data[])');
    return result;
  }

  let delisted = 0;
  for (const row of data) {
    if (!row) continue;
    const code = String(row.A_STOCK_CODE || '').trim();
    if (!/^\d{6}$/.test(code)) continue;
    // Drop delisted companies (DELIST_DATE holds a real date; '-' means active).
    if (row.DELIST_DATE && String(row.DELIST_DATE).trim() !== '-') { delisted++; continue; }
    const yahooTicker = code + '.SS';
    if (result.has(yahooTicker)) continue;
    const name = String(row.FULL_NAME_IN_ENGLISH || row.SEC_NAME_FULL || '').trim();
    const info = {
      ticker: yahooTicker,
      name,
      exchange: 'SSE',
      source: 'sse-cn',
      country: 'China'
    };
    const ipoDate = toIpoDate(row.LIST_DATE);
    if (ipoDate) info.ipoDate = ipoDate;
    result.set(yahooTicker, info);
  }

  console.log(`  [SSE-CN] ${data.length} rows, ${delisted} delisted dropped, ${result.size} live A-shares`);
  return result;
}

module.exports = { fetchSseUniverse };

if (require.main === module) {
  fetchSseUniverse().then(m => {
    console.log('Total:', m.size);
    const sample = [...m.values()].slice(0, 5);
    for (const info of sample) console.log(' ', info.ticker, '-', info.name, '(', info.ipoDate || '?', ')');
  }).catch(console.error);
}
