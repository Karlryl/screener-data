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
  'SP': '.SI',  // Singapore (Yahoo uses .SI)
  'SW': '.SW',  // Switzerland (SIX)
  'OL': '.OL',  // Oslo (Oslo Bors)
  'CO': '.CO',  // Copenhagen
  'HE': '.HE',  // Helsinki
};

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'Accept': 'application/json' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        res.resume(); // drain the body before following redirect
        return get(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
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

  for (const [exchange, suffix] of Object.entries(EXCHANGES)) {
    try {
      const url = `https://finnhub.io/api/v1/stock/symbol?exchange=${exchange}&token=${token}`;
      const body = await get(url);
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
      if (/HTTP 401/i.test(e.message)) {
        console.error('  [Finnhub] HTTP 401 on first exchange — token invalid or missing; skipping remaining ' + (Object.keys(EXCHANGES).length - 1) + ' exchanges');
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
