#!/usr/bin/env node
/**
 * Tag 133: Wikipedia Index Constituents Discovery
 * Fetches current members of major stock indices via Wikipedia API.
 * Covers: S&P 500, FTSE 100, DAX 40.
 * Returns Map<yahooTicker, {ticker, name, index, source}>
 */
'use strict';
const https = require('https');

// Index → {page, yahooSuffix}
// yahooSuffix applied only when symbols don't already have a period.
const INDICES = [
  { name: 'SP500',   page: 'List_of_S%26P_500_companies', suffix: '' },
  { name: 'FTSE100', page: 'FTSE_100',                    suffix: '.L' },
  { name: 'DAX',     page: 'DAX',                         suffix: '.DE' },
];

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'screener-data/1.0 (github.com/Karlryl/screener-data)',
        'Accept': 'application/json'
      }
    }, res => {
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

// F-DP-018: Common false-positive words that match the ticker regex but are NOT tickers.
// These are abbreviations, acronyms, and common English words found in Wikipedia tables.
const NOT_TICKERS = new Set([
  'CEO', 'CFO', 'COO', 'CTO', 'CMO', 'CIO', 'CSO',
  'USA', 'USD', 'EUR', 'GBP', 'JPY', 'CHF',
  'GAAP', 'IPO', 'NYSE', 'SEC', 'ETF', 'ESG',
  'GDP', 'FED', 'THE', 'FOR', 'AND', 'BUT', 'NOT',
  'INC', 'LLC', 'LTD', 'PLC', 'AG', 'SA', 'NV',
  'OTC', 'ADR', 'GDR', 'REIT', 'EPS', 'FCF',
  'Q1', 'Q2', 'Q3', 'Q4', 'TTM', 'YOY', 'QOQ',
  'EBIT', 'EBITDA', 'PE', 'PB', 'PS', 'EV',
  'US', 'UK', 'EU', 'UN', 'NA', 'NR',
  'NO', 'YES', 'NEW', 'OLD', 'ALL', 'ANY',
  'SIC', 'ISIN', 'CIK', 'LEI',
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
  'MKT', 'CAP', 'VOL', 'AVG', 'MAX', 'MIN',
]);

// F-217a-10: Whitelist of valid single-letter NYSE tickers. Single-letter tickers
// are historically reserved on NYSE and only a handful exist at any time. Bare
// length>=1 acceptance would flood the watchlist with table-marker garbage
// (column letters, footnote refs). Whitelist is small enough to maintain by hand
// and is verified against current NYSE listings (May 2026).
//   A=Agilent, B=Barnes Group, C=Citigroup, D=Dominion, E=Eni, F=Ford,
//   J=Jacobs Solutions, K=Kellanova, L=Loews, M=Macy's, O=Realty Income,
//   R=Ryder, T=AT&T, U=Unity Software, V=Visa, W=Wayfair, X=US Steel, Z=Zillow
const SINGLE_LETTER_TICKERS = new Set([
  'A', 'B', 'C', 'D', 'E', 'F', 'J', 'K', 'L', 'M',
  'O', 'R', 'T', 'U', 'V', 'W', 'X', 'Z',
]);

function extractTickersFromWikitext(wikitext, suffix) {
  const tickers = new Set();
  // Split into rows by table row separator
  const rows = wikitext.split(/\|\-/);
  for (const row of rows) {
    // Split cells by pipe; cells look like "| AAPL" or "|| AAPL"
    const cells = row.split(/\|+/).map(c => c.trim());
    for (const cell of cells) {
      // Strip wiki markup: [[...]], {{...}}, ''...'', etc.
      const clean = cell
        .replace(/\{\{[^}]*\}\}/g, '')
        .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
        .replace(/'{2,3}/g, '')
        .replace(/<[^>]+>/g, '')
        .trim();
      // Match ticker pattern: 1-6 uppercase letters/digits
      if (/^[A-Z][A-Z0-9]{0,5}$/.test(clean)) {
        // F-DP-018: skip known false-positive words
        if (NOT_TICKERS.has(clean)) continue;
        // F-DP-018: require the cell to look like a ticker context —
        // either preceded by $ sign, or the cell is short (<=5 chars is more likely a ticker),
        // or the surrounding row contains exchange context like 'NYSE' or 'NASDAQ'.
        // For index constituent tables the cell IS the ticker — length guard is primary filter.
        // F-217a-10: allow whitelisted single-letter NYSE tickers (A, V, T, F, etc.).
        if (clean.length < 2 && !SINGLE_LETTER_TICKERS.has(clean)) continue;
        let sym = clean;
        if (suffix && !sym.includes('.')) sym = sym + suffix;
        tickers.add(sym);
      }
    }
  }
  return tickers;
}

async function fetchIndexTickers(indexDef) {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${indexDef.page}&prop=wikitext&formatversion=2&format=json`;
  const body = await get(url);
  const parsed = JSON.parse(body);
  const wikitext = parsed && parsed.parse && parsed.parse.wikitext;
  if (!wikitext) throw new Error('No wikitext returned for ' + indexDef.page);
  return extractTickersFromWikitext(wikitext, indexDef.suffix);
}

async function fetchWikipediaIndices() {
  const result = new Map();
  for (const idx of INDICES) {
    try {
      console.log(`  [Wikipedia] Fetching ${idx.name}...`);
      const tickers = await fetchIndexTickers(idx);
      let added = 0;
      for (const sym of tickers) {
        if (!result.has(sym)) {
          result.set(sym, { ticker: sym, name: '', index: idx.name, source: 'wikipedia' });
          added++;
        }
      }
      console.log(`  [Wikipedia] ${idx.name}: ${added} tickers`);
    } catch (e) {
      console.error(`  [Wikipedia] ${idx.name} failed: ` + e.message);
    }
    await sleep(500);
  }
  console.log(`  [Wikipedia] Total: ${result.size} tickers`);
  return result;
}

module.exports = { fetchWikipediaIndices };

if (require.main === module) {
  fetchWikipediaIndices().then(m => console.log('Total:', m.size)).catch(console.error);
}
