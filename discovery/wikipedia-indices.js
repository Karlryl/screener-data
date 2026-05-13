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
