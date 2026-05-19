#!/usr/bin/env node
/**
 * Tag 135: NASDAQ Trader Exchange Files — comprehensive US universe
 * =================================================================
 * Source: https://www.nasdaqtrader.com/dynamic/SymDir/
 * No API key required. Updated daily by NASDAQ.
 *
 * nasdaqlisted.txt  → all NASDAQ-listed stocks (Global Select + Global + Capital)
 * otherlisted.txt   → all NYSE / NYSE American / NYSE Arca stocks
 *
 * Together these cover ~7,000–8,000 US common stocks.
 * ETFs, warrants, test issues, and preferred shares are filtered out.
 *
 * Returns Map<yahooTicker, {ticker, name, exchange, source}>
 */
'use strict';
const https = require('https');

const NASDAQ_LISTED = 'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt';
const OTHER_LISTED  = 'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt';

// Symbols ending in these suffixes are almost always not common stock:
// W = warrant, R = right, U = unit, P = preferred, Z = miscellaneous
// We allow symbols with dots (e.g. BRK.B) but reject multi-char junk suffixes.
const JUNK_SUFFIX_RE = /[WRU]$|\.WS$|\.WT$|\.WI$|\.RT$|\.UN$|\.U$/i;

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'screener-data/1.0 (github.com/Karlryl/screener-data)',
        'Accept': 'text/plain'
      }
    }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        res.resume(); // drain the body before following redirect
        return get(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error('HTTP ' + res.statusCode + ' from ' + url));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    }).on('error', reject).setTimeout(30000, function() {
      this.destroy(); reject(new Error('timeout fetching ' + url));
    });
  });
}

/**
 * Parse nasdaqlisted.txt
 * Format: Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares
 * Market Category: Q=Global Select, G=Global, S=Capital Market
 */
function parseNasdaqListed(text) {
  const result = new Map();
  const lines = text.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('File Creation')) continue;
    const parts = line.split('|');
    if (parts.length < 7) continue;
    const symbol     = (parts[0] || '').trim().toUpperCase();
    const name       = (parts[1] || '').trim();
    const testIssue  = (parts[3] || '').trim();
    const etf        = (parts[6] || '').trim();
    if (!symbol || testIssue === 'Y' || etf === 'Y') continue;
    if (JUNK_SUFFIX_RE.test(symbol)) continue;
    result.set(symbol, { ticker: symbol, name, exchange: 'NASDAQ', source: 'nasdaq-trader' });
  }
  return result;
}

/**
 * Parse otherlisted.txt
 * Format: ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol
 * Exchange codes: A=NYSE American, N=NYSE, P=NYSE Arca, Z=BATS, V=OTC Bulletin Board
 */
function parseOtherListed(text) {
  const result = new Map();
  const lines = text.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('File Creation')) continue;
    const parts = line.split('|');
    if (parts.length < 7) continue;
    const symbol     = (parts[0] || '').trim().toUpperCase();
    const name       = (parts[1] || '').trim();
    const exchange   = (parts[2] || '').trim();
    const etf        = (parts[4] || '').trim();
    const testIssue  = (parts[6] || '').trim();
    if (!symbol || testIssue === 'Y' || etf === 'Y') continue;
    // Skip OTC Bulletin Board (V) — Yahoo Finance rarely has data for these
    if (exchange === 'V') continue;
    if (JUNK_SUFFIX_RE.test(symbol)) continue;
    const exchName = exchange === 'N' ? 'NYSE'
      : exchange === 'A' ? 'NYSE American'
      : exchange === 'P' ? 'NYSE Arca'
      : exchange === 'Z' ? 'BATS'
      : 'US';
    result.set(symbol, { ticker: symbol, name, exchange: exchName, source: 'nasdaq-trader' });
  }
  return result;
}

async function fetchNasdaqAll() {
  const result = new Map();
  console.log('  [NASDAQ-Trader] Fetching nasdaqlisted.txt...');
  try {
    const nasdaqText = await get(NASDAQ_LISTED);
    const nasdaqMap = parseNasdaqListed(nasdaqText);
    for (const [sym, info] of nasdaqMap) result.set(sym, info);
    console.log(`  [NASDAQ-Trader] NASDAQ: ${nasdaqMap.size} common stocks`);
  } catch (e) {
    console.error('  [NASDAQ-Trader] nasdaqlisted.txt failed: ' + e.message);
  }

  console.log('  [NASDAQ-Trader] Fetching otherlisted.txt...');
  try {
    const otherText = await get(OTHER_LISTED);
    const otherMap = parseOtherListed(otherText);
    let added = 0;
    for (const [sym, info] of otherMap) {
      if (!result.has(sym)) { result.set(sym, info); added++; }
    }
    console.log(`  [NASDAQ-Trader] NYSE/AMEX/Arca: ${otherMap.size} entries, ${added} not already in NASDAQ list`);
  } catch (e) {
    console.error('  [NASDAQ-Trader] otherlisted.txt failed: ' + e.message);
  }

  console.log(`  [NASDAQ-Trader] Total US stocks: ${result.size}`);
  return result;
}

module.exports = { fetchNasdaqAll };

if (require.main === module) {
  fetchNasdaqAll().then(m => {
    console.log('Total:', m.size);
    const sample = [...m.entries()].slice(0, 5);
    for (const [sym, info] of sample) console.log(' ', sym, '-', info.name, '(', info.exchange, ')');
  }).catch(console.error);
}
