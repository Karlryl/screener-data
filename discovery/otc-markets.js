#!/usr/bin/env node
/**
 * Tag 165: OTC Markets Universe Discovery
 * ========================================
 * Source: https://www.otcmarkets.com/research/stock-screener/api
 * No API key required. Publicly accessible JSON endpoint.
 *
 * Fetches OTCQX, OTCQB, and Expert Market tiers (pages 1-10, pageSize=500).
 * Together these add ~3,000–5,000 additional US OTC tickers.
 * Yahoo Finance covers OTCQX and OTCQB well; Expert Market is best-effort.
 *
 * Returns Map<yahooTicker, {ticker, name, exchange, market, source}>
 */
'use strict';
const https = require('https');

// OTC market tiers to fetch — OTCQX and OTCQB have best Yahoo Finance coverage
const OTC_MARKETS = ['OTCQX', 'OTCQB', 'Expert'];
const PAGE_SIZE = 500;
const MAX_PAGES = 10;

// Delay between page requests (ms) — OTC Markets has no official rate limit published;
// be polite with 500ms between calls.
const PAGE_DELAY_MS = 500;

// Symbols unlikely to have Yahoo Finance data — skip pure preferred/warrant/unit suffixes
const JUNK_SUFFIX_RE = /[WRU]$|\.WS$|\.WT$|\.WI$|\.RT$|\.UN$|\.U$/i;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'screener-data/1.0 (github.com/Karlryl/screener-data)',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return get(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error('HTTP ' + res.statusCode + ' from ' + url));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30000, function() { req.destroy(); reject(new Error('timeout fetching ' + url)); });
  });
}

/**
 * Fetch one page of OTC screener results.
 * URL format: /research/stock-screener/api?market=OTCQX&market=OTCQB&pageSize=500&page=1
 * Response JSON shape (observed):
 *   { stocks: { rows: [ { symbol, companyName, marketTier, ... }, ... ], totalRecords: N } }
 *   or top-level array or { rows: [...] } — we handle the common variants.
 */
async function fetchOTCPage(markets, page) {
  const marketParams = markets.map(m => `market=${encodeURIComponent(m)}`).join('&');
  const url = `https://www.otcmarkets.com/research/stock-screener/api?${marketParams}&pageSize=${PAGE_SIZE}&page=${page}`;
  // Tag 215i: retry on transient timeout. Run #107 logs show OTC Page 1
  // failed with timeout fetching — same pattern as NASDAQ-API. Two retries
  // with exponential backoff (10s, 30s) before giving up. Non-timeout
  // errors (HTTP 4xx/5xx, JSON parse) re-thrown immediately.
  let body;
  const DELAYS = [10000, 30000];
  let lastErr;
  for (let attempt = 0; attempt <= DELAYS.length; attempt++) {
    try {
      body = await get(url);
      break;
    } catch (e) {
      lastErr = e;
      const isTimeout = /timeout fetching/i.test(String(e.message || ''));
      if (!isTimeout || attempt >= DELAYS.length) throw e;
      const delay = DELAYS[attempt];
      console.warn(`  [OTC-Markets] Page ${page} timeout (attempt ${attempt + 1}/${DELAYS.length + 1}) — retrying in ${delay / 1000}s`);
      await sleep(delay);
    }
  }
  if (!body) throw lastErr;
  let data;
  try {
    data = JSON.parse(body);
  } catch (e) {
    throw new Error('JSON parse error: ' + e.message);
  }

  // Handle multiple response shapes the OTC API has used historically
  let rows = null;
  let total = null;
  if (Array.isArray(data)) {
    rows = data;
  } else if (data && Array.isArray(data.rows)) {
    rows = data.rows;
    total = data.totalRecords || null;
  } else if (data && data.stocks) {
    if (Array.isArray(data.stocks)) {
      rows = data.stocks;
    } else if (Array.isArray(data.stocks.rows)) {
      rows = data.stocks.rows;
      total = data.stocks.totalRecords || null;
    }
  }

  if (!rows) {
    throw new Error('Unexpected OTC response shape — no rows found');
  }

  return { rows, total };
}

/**
 * Main entry point.
 * Returns Map<ticker, {ticker, name, exchange, market, source}>
 */
async function fetchOTCMarkets() {
  const result = new Map();
  console.log('  [OTC-Markets] Fetching OTCQX, OTCQB, Expert tiers (Tag 165)...');

  let totalRecords = null;

  for (let page = 1; page <= MAX_PAGES; page++) {
    try {
      const { rows, total } = await fetchOTCPage(OTC_MARKETS, page);

      if (total !== null && totalRecords === null) {
        totalRecords = total;
        console.log(`  [OTC-Markets] Total records reported: ${totalRecords}`);
      }

      if (rows.length === 0) {
        console.log(`  [OTC-Markets] Page ${page}: empty — stopping pagination`);
        break;
      }

      let added = 0;
      for (const row of rows) {
        // Field names vary: symbol / ticker / Symbol / tickerSymbol
        const rawSym = row.symbol || row.ticker || row.Symbol || row.tickerSymbol || '';
        const sym = rawSym.trim().toUpperCase();
        if (!sym) continue;
        // Tag 217g (audit F-217a-01 HIGH fix): same class-share regex bug
        // as sec-tickers.js / nasdaq-api.js — original regex rejected
        // BRK.B / BF.B / BRK-B despite the comment claiming to allow them.
        if (!/^[A-Z][A-Z0-9]{0,4}([.\-][A-Z])?$/.test(sym)) continue;
        if (JUNK_SUFFIX_RE.test(sym)) continue;

        const name = (row.companyName || row.name || row.CompanyName || '').trim();
        const market = (row.marketTier || row.market || row.MarketTier || '').trim();

        if (!result.has(sym)) {
          result.set(sym, {
            ticker: sym,
            name,
            exchange: 'OTC',
            market,   // OTCQX / OTCQB / Expert
            source: 'otc-markets'
          });
          added++;
        }
      }

      console.log(`  [OTC-Markets] Page ${page}: ${rows.length} rows, ${added} new symbols`);

      // F-DP-017: Stop pagination only when we get an EMPTY page, not a short page.
      // A short final page is normal for the last page of results and should not
      // terminate pagination early (which would miss data on the last page).
      const fetched = (page - 1) * PAGE_SIZE + rows.length;
      if (totalRecords !== null && fetched >= totalRecords) {
        console.log(`  [OTC-Markets] Fetched ${fetched} of ${totalRecords} — done`);
        break;
      }

      await sleep(PAGE_DELAY_MS);
    } catch (e) {
      console.error(`  [OTC-Markets] Page ${page} failed: ${e.message}`);
      // Non-fatal: stop pagination for this batch but keep what we have
      break;
    }
  }

  console.log(`  [OTC-Markets] Total OTC tickers: ${result.size}`);
  return result;
}

module.exports = { fetchOTCMarkets };

if (require.main === module) {
  fetchOTCMarkets().then(m => {
    console.log('Total:', m.size);
    const sample = [...m.entries()].slice(0, 5);
    for (const [sym, info] of sample) {
      console.log(' ', sym, '-', info.name, '(', info.market, ')');
    }
  }).catch(console.error);
}
