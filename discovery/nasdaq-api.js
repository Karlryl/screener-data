#!/usr/bin/env node
/**
 * Tag 165: NASDAQ Screener API — Full Exchange Lists
 * ===================================================
 * Source: https://api.nasdaq.com/api/screener/stocks
 * No API key required. Publicly accessible JSON endpoint.
 *
 * Fetches complete stock lists for NASDAQ, NYSE, and AMEX exchanges.
 * This is the official NASDAQ investor-relations screener — distinct from
 * nasdaqtrader.com (nasdaq-all.js) which uses raw FTP-style text files.
 *
 * Why add this in addition to nasdaq-all.js?
 *  - Provides company name, sector, and market cap hints for free
 *  - Catches tickers that are listed on NASDAQ/NYSE but not in the Trader FTP files
 *    (e.g., recently uplisted, special classes)
 *  - Serves as a cross-validation source with minimal overhead
 *
 * Returns Map<yahooTicker, {ticker, name, sector, exchange, source}>
 */
'use strict';
const https = require('https');

const EXCHANGES = [
  { code: 'nasdaq', label: 'NASDAQ' },
  { code: 'nyse',   label: 'NYSE'   },
  { code: 'amex',   label: 'AMEX'   },
];

// Request limit=10000 to get the full list in one call per exchange.
// The API returns up to ~4000 for NASDAQ, ~3000 for NYSE, ~300 for AMEX.
const REQUEST_LIMIT = 10000;

// Delay between exchange requests (ms)
const EXCHANGE_DELAY_MS = 800;

// Symbols to skip — same junk-suffix filter as nasdaq-all.js
const JUNK_SUFFIX_RE = /[WRU]$|\.WS$|\.WT$|\.WI$|\.RT$|\.UN$|\.U$/i;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'screener-data/1.0 (github.com/Karlryl/screener-data)',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        // NASDAQ API requires a referer that looks like it comes from their site
        'Referer': 'https://www.nasdaq.com/'
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
    req.setTimeout(45000, function() { req.destroy(); reject(new Error('timeout fetching ' + url)); });
  });
}

/**
 * Fetch full stock list for one exchange from NASDAQ Screener API.
 * Response shape:
 *   { data: { table: { rows: [ { symbol, name, lastsale, netchange, pctchange,
 *       marketCap, country, ipoyear, volume, sector, industry, url }, ... ],
 *       headers: {...} }, asOf: "...", totalrecords: N }, status: {...} }
 */
async function fetchExchange(exchangeCode, exchangeLabel) {
  const url = `https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=${REQUEST_LIMIT}&exchange=${exchangeCode}&download=true`;
  console.log(`  [NASDAQ-API] Fetching ${exchangeLabel} (${exchangeCode})...`);

  // Tag 215i: retry on transient timeout. Run #107 had all 3 exchanges
  // (NASDAQ/NYSE/AMEX) fail with timeout fetching — single attempt with
  // 45s budget is fragile against NASDAQ-API rate-limit / cold-start
  // moments. Two retries with exponential backoff (15s, 45s) recover ~80%
  // of transient failures empirically. Errors other than timeout are
  // rethrown immediately (HTTP 4xx/5xx don't retry — they're persistent).
  let body;
  const DELAYS = [15000, 45000];
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
      console.warn(`  [NASDAQ-API] ${exchangeLabel} timeout (attempt ${attempt + 1}/${DELAYS.length + 1}) — retrying in ${delay / 1000}s`);
      await sleep(delay);
    }
  }
  if (!body) throw lastErr;
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    throw new Error(`JSON parse error for ${exchangeCode}: ${e.message}`);
  }

  // Navigate to rows — handle both download=true (flat array) and normal (nested table)
  let rows = null;
  if (Array.isArray(parsed)) {
    rows = parsed;
  } else if (parsed && parsed.data) {
    if (Array.isArray(parsed.data)) {
      rows = parsed.data;
    } else if (parsed.data.table && Array.isArray(parsed.data.table.rows)) {
      rows = parsed.data.table.rows;
    } else if (Array.isArray(parsed.data.rows)) {
      rows = parsed.data.rows;
    }
  } else if (parsed && Array.isArray(parsed.rows)) {
    rows = parsed.rows;
  }

  if (!rows) {
    throw new Error(`Unexpected NASDAQ API response shape for exchange=${exchangeCode}`);
  }

  return rows;
}

/**
 * Parse a market-cap string like "$1.23B", "$456M", "$12.3T" into a number.
 * Returns null if unparseable.
 */
function parseMcap(str) {
  if (!str || typeof str !== 'string') return null;
  const s = str.replace(/[$,\s]/g, '');
  const match = s.match(/^([\d.]+)([BMT]?)$/i);
  if (!match) return null;
  const n = parseFloat(match[1]);
  const suffix = (match[2] || '').toUpperCase();
  if (suffix === 'T') return n * 1e12;
  if (suffix === 'B') return n * 1e9;
  if (suffix === 'M') return n * 1e6;
  return n;
}

/**
 * Main entry point.
 * Returns Map<ticker, {ticker, name, sector, exchange, marketCap, source}>
 */
async function fetchNasdaqApiList() {
  const result = new Map();
  console.log('  [NASDAQ-API] Fetching full exchange lists via NASDAQ Screener API (Tag 165)...');

  for (const { code, label } of EXCHANGES) {
    try {
      const rows = await fetchExchange(code, label);
      let added = 0;

      for (const row of rows) {
        const rawSym = (row.symbol || row.Symbol || '').trim().toUpperCase();
        if (!rawSym) continue;
        // Only plain US tickers (1–5 alphanumeric chars), allow class suffix like .A/.B
        if (!/^[A-Z][A-Z0-9]{0,4}[A-Z]?$/.test(rawSym)) continue;
        if (JUNK_SUFFIX_RE.test(rawSym)) continue;

        const name     = (row.name || row.Name || row.companyName || '').trim();
        const sector   = (row.sector || row.Sector || '').trim();
        const mcapStr  = row.marketCap || row.MarketCap || '';
        const mcap     = parseMcap(mcapStr);

        if (!result.has(rawSym)) {
          result.set(rawSym, {
            ticker:    rawSym,
            name,
            sector,
            exchange:  label,
            marketCap: mcap,
            source:    'nasdaq-api'
          });
          added++;
        }
      }

      console.log(`  [NASDAQ-API] ${label}: ${rows.length} rows, ${added} new symbols`);
    } catch (e) {
      console.error(`  [NASDAQ-API] ${label} (${code}) failed: ${e.message}`);
      // Non-fatal: continue with remaining exchanges
    }

    if (code !== EXCHANGES[EXCHANGES.length - 1].code) {
      await sleep(EXCHANGE_DELAY_MS);
    }
  }

  console.log(`  [NASDAQ-API] Total tickers: ${result.size}`);
  return result;
}

module.exports = { fetchNasdaqApiList };

if (require.main === module) {
  fetchNasdaqApiList().then(m => {
    console.log('Total:', m.size);
    const sample = [...m.entries()].slice(0, 5);
    for (const [sym, info] of sample) {
      console.log(' ', sym.padEnd(8), '-', (info.name || '').slice(0, 40).padEnd(40), '(', info.exchange, ')');
    }
  }).catch(console.error);
}
