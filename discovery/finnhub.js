#!/usr/bin/env node
/**
 * Tag 133: Finnhub Universe Discovery
 * Fetches stock symbols per exchange from Finnhub stock/symbol API.
 * Requires FINNHUB_API_KEY env var — silently skips if not set.
 * Rate limit: 60 req/min free tier → 1100ms delay between calls.
 * Returns Map<yahooTicker, {ticker, name, exchange, source}>
 */
'use strict';
const https = require('https');

// Finnhub exchange code → Yahoo Finance suffix
// Only Common Stock type is fetched; ETFs/warrants filtered out.
const EXCHANGES = {
  'US': '',      // NASDAQ / NYSE / AMEX — no suffix
  'L':  '.L',   // London Stock Exchange
  'T':  '.T',   // Tokyo Stock Exchange
  'HK': '.HK',  // Hong Kong Exchange
  'F':  '.F',   // Frankfurt (Xetra)
  'PA': '.PA',  // Paris (Euronext)
  'MI': '.MI',  // Milan (Borsa Italiana)
  'ST': '.ST',  // Stockholm (Nasdaq Nordic)
  'TO': '.TO',  // Toronto (TSX)
  'AX': '.AX',  // Australia (ASX)
  'KS': '.KS',  // Korea Exchange
  'TW': '.TW',  // Taiwan (TWSE)
  'SI': '.SI',  // Singapore — Finnhub exchange code is SI (not SP); Yahoo suffix .SI. (audit F-A-2026-06-21)
  'SW': '.SW',  // Switzerland (SIX)
  'OL': '.OL',  // Oslo (Oslo Bors)
  'CO': '.CO',  // Copenhagen
  'HE': '.HE',  // Helsinki
};

// audit/fix: relative-Location ERR_INVALID_URL + uncapped recursion + 307/308 silently wiped this discovery source (mirror nasdaq-api hardening)
const MAX_REDIRECTS = 5;
function get(url, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'Accept': 'application/json' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302 ||
          res.statusCode === 307 || res.statusCode === 308) {
        res.resume(); // drain the body before following redirect
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function toYahooSymbol(rawSymbol, suffix) {
  const sym = (rawSymbol || '').toUpperCase().trim();
  if (!sym) return null;
  if (!suffix) return sym;
  // If symbol already contains the suffix (e.g. BP.L), don't append again
  if (sym.includes('.')) return sym;
  return sym + suffix;
}

async function fetchFinnhubUniverse() {
  const result = new Map();
  const token = process.env.FINNHUB_API_KEY;
  if (!token) {
    console.log('  [Finnhub] FINNHUB_API_KEY not set — skipping');
    return result;
  }
  console.log('  [Finnhub] Fetching symbols for ' + Object.keys(EXCHANGES).length + ' exchanges...');

  // audit F-A-2026-06-21: mirror nasdaq-api/otc-markets Tag-215i retry —
  // prevents a single transient timeout/429 from silently dropping a whole
  // exchange. Exponential backoff (5s, 20s) recovers transient rate-limit /
  // network blips before giving up.
  const RETRY_DELAYS = [5000, 20000];
  let firstExchange = true;
  for (const [exchange, suffix] of Object.entries(EXCHANGES)) {
    try {
      const url = `https://finnhub.io/api/v1/stock/symbol?exchange=${exchange}&token=${token}`;
      // audit F-A-2026-06-21: retry transient timeout / HTTP 429 with backoff
      // instead of dropping the exchange on the first blip. Persistent errors
      // (HTTP 401/403, JSON parse) are rethrown immediately — no point retrying.
      let body;
      let lastErr;
      for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
        try {
          body = await get(url);
          break;
        } catch (e) {
          lastErr = e;
          const transient = /timeout/i.test(String(e.message || '')) || /HTTP 429/i.test(String(e.message || ''));
          if (!transient || attempt >= RETRY_DELAYS.length) throw e;
          const delay = RETRY_DELAYS[attempt];
          console.warn(`  [Finnhub] ${exchange} ${e.message} (attempt ${attempt + 1}/${RETRY_DELAYS.length + 1}) — retrying in ${delay / 1000}s`);
          await sleep(delay);
        }
      }
      if (body === undefined) throw lastErr;
      firstExchange = false;
      const data = JSON.parse(body);
      if (!Array.isArray(data)) {
        console.log(`  [Finnhub] ${exchange}: unexpected response`);
        await sleep(1100);
        continue;
      }
      let added = 0;
      for (const s of data) {
        if (!s || !s.symbol) continue;
        if (s.type !== 'Common Stock') continue;
        const sym = toYahooSymbol(s.displaySymbol || s.symbol, suffix);
        if (!sym) continue;
        if (!result.has(sym)) {
          result.set(sym, { ticker: sym, name: s.description || '', exchange, source: 'finnhub' });
          added++;
        }
      }
      console.log(`  [Finnhub] ${exchange}: ${data.length} entries, ${added} common stocks added`);
    } catch (e) {
      console.error(`  [Finnhub] ${exchange} failed: ` + e.message);
      // Tag 217g (audit F-217a-03 HIGH fix): short-circuit after first 401.
      // Without this, Run #107 cascaded 17 identical HTTP 401 errors (one
      // per exchange) — each a 30s wasted attempt. If auth fails on the
      // first exchange, every remaining call WILL also fail; bail out and
      // let downstream pulls continue without burning the budget.
      //
      // audit F-A-2026-06-21: broaden the early-bail to 403 (auth/plan) and
      // persistent 429 (rate-limit) on the first exchange too — prevents the
      // full 16-exchange * (retries + 1.1s) budget being burned on an
      // auth/rate-limit storm. A persistent 401/403/429 on call #1 means every
      // remaining exchange will fail identically; stop and let siblings run.
      if (firstExchange && /HTTP (401|403|429)/i.test(e.message)) {
        console.error(`  [Finnhub] ${e.message} on first exchange — token/plan invalid or rate-limited; skipping remaining ` + (Object.keys(EXCHANGES).length - 1) + ' exchanges');
        break;
      }
    }
    await sleep(1100);
  }

  console.log(`  [Finnhub] Total: ${result.size} tickers`);
  return result;
}

module.exports = { fetchFinnhubUniverse };

if (require.main === module) {
  fetchFinnhubUniverse().then(m => console.log('Total:', m.size)).catch(console.error);
}
