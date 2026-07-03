#!/usr/bin/env node
/**
 * Oslo Børs (Euronext Oslo) — full equity register, keyless.
 * =================================================================
 * Source: Euronext live-markets CSV export (live-verified 2026-07-03).
 *   https://live.euronext.com/en/pd_es/data/stocks/download
 *     ?mics=XOSL,XOAS,MERK&format=csv
 *
 * This is the "Download" button behind the Oslo equities list on
 * live.euronext.com. It returns the WHOLE register (not an index) in one
 * semicolon-delimited CSV — every listed company incl. young Euronext Growth
 * IPOs, so it catches a fresh junior-board name the way a top-list never would.
 *
 * The three real Oslo MICs are included and NOTHING else:
 *   XOSL = Oslo Børs (main board, ~198)
 *   XOAS = Euronext Expand Oslo (~10)
 *   MERK = Euronext Growth Oslo (~88, the young-IPO junior board)
 * ETLX (EuroTLX) is DELIBERATELY excluded — that MIC is Borsa Italiana's
 * retail venue and lists ~424 FOREIGN stocks (3M, Adidas, AbbVie…) that are
 * NOT Oslo-listed and must not get a .OL suffix. Live count 2026-07-03: 296
 * unique Oslo symbols across the 3 kept MICs.
 *
 * CSV layout: a 4-line banner ("European Equities" / date / note), then the
 * header `Name;ISIN;Symbol;Market;Currency;…`, then rows. We match columns by
 * header name (not fixed index) so a column reshuffle can't corrupt the parse.
 * yahooTicker = Symbol + '.OL' (e.g. EQNR.OL, DNB.OL, MOWI.OL, ACED.OL).
 *
 * marketCap is intentionally NOT set (Yahoo fills it later).
 * Node built-ins only. Never throws — empty Map() on any failure (fail-silent).
 *
 * Returns Map<yahooTicker, {ticker, name, exchange, source, country}>.
 */
'use strict';
const https = require('https');

// Only the three genuine Oslo MICs — ETLX (foreign cross-listings) omitted.
const CSV_URL =
  'https://live.euronext.com/en/pd_es/data/stocks/download' +
  '?mics=XOSL,XOAS,MERK&format=csv';

// Euronext 403s the download without a live-markets Referer.
const REFERER = 'https://live.euronext.com/en/markets/oslo/equities/list';

// mirror finnhub.js / sse-cn.js redirect hardening: cap recursion, resolve
// relative Location, follow 301/302/307/308, drain non-200 bodies.
const MAX_REDIRECTS = 5;
function get(url, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) screener-data',
        'Referer': REFERER,
        'Accept': '*/*',
      },
    }, res => {
      if (res.statusCode === 301 || res.statusCode === 302 ||
          res.statusCode === 307 || res.statusCode === 308) {
        res.resume(); // drain before following redirect
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

// Split one semicolon-delimited CSV record, honouring double-quoted fields and
// escaped "" quotes. Records never span newlines in this file.
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ';') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

// A well-formed ISIN: 2 country letters + 9 alnum + 1 check digit.
const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

function parseOsloCsv(csvText) {
  const result = new Map();
  const lines = csvText.split(/\r?\n/);

  // Find the header row (skips the 4-line banner); strip any UTF-8 BOM.
  const headerIdx = lines.findIndex(l => l.replace(/^﻿/, '').startsWith('Name;ISIN;Symbol'));
  if (headerIdx < 0) return result; // layout changed → bail silently

  const header = parseCsvLine(lines[headerIdx].replace(/^﻿/, ''));
  const iName   = header.indexOf('Name');
  const iIsin   = header.indexOf('ISIN');
  const iSymbol = header.indexOf('Symbol');
  const iMarket = header.indexOf('Market');
  if (iName < 0 || iIsin < 0 || iSymbol < 0) return result;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const f = parseCsvLine(lines[i]);
    const isin = (f[iIsin] || '').trim().toUpperCase();
    if (!ISIN_RE.test(isin)) continue; // skips banner/blank/garbage rows
    const symbol = (f[iSymbol] || '').trim().toUpperCase();
    if (!symbol) continue;
    const yahooTicker = symbol + '.OL';
    if (result.has(yahooTicker)) continue;
    result.set(yahooTicker, {
      ticker: yahooTicker,
      name: (f[iName] || '').trim(),
      exchange: iMarket >= 0 ? (f[iMarket] || 'Oslo Børs').trim() : 'Oslo Børs',
      source: 'oslo',
      country: 'Norway',
    });
  }
  return result;
}

async function fetchOsloUniverse() {
  const result = new Map();
  try {
    console.log('  [Oslo] Fetching Euronext Oslo register (XOSL,XOAS,MERK)...');
    const csv = await get(CSV_URL);
    const parsed = parseOsloCsv(csv);
    for (const [k, v] of parsed) result.set(k, v);
    console.log(`  [Oslo] Total Oslo-listed stocks: ${result.size}`);
  } catch (e) {
    console.error('  [Oslo] failed: ' + e.message);
    return new Map(); // fail-silent per contract
  }
  return result;
}

module.exports = { fetchOsloUniverse };

if (require.main === module) {
  fetchOsloUniverse().then(m => {
    console.log('Total:', m.size);
    const sample = [...m.values()].slice(0, 10);
    for (const info of sample) console.log(' ', info.ticker, '-', info.name, '(' + info.exchange + ')');
  }).catch(console.error);
}
