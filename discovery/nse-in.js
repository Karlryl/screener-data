#!/usr/bin/env node
/**
 * NSE India (National Stock Exchange) — full listed-equity universe, keyless.
 * ==========================================================================
 * Source: https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv
 * No API key required. NSE publishes the complete list of listed equities as a
 * single plain-text CSV on its archives host (live-verified 2026-07-03: HTTP
 * 200, text/csv, ~168 KB, 2381 data rows).
 *
 * IMPORTANT: this is the *archives* host (nsearchives.nseindia.com), NOT the
 * bot-protected www.nseindia.com API. The archives host serves the CSV directly
 * with only a Referer header — no Akamai cookie handshake needed. The main API
 * (www.nseindia.com/api/...) would require a cookie warm-up; we deliberately
 * avoid it by using the static CSV, which is a true full register.
 *
 * VOLLREGISTER: covers all EQ, BE and BZ series (mainboard + restricted/T2T),
 * including young IPOs — 483 of the 2381 rows were listed in 2024 or later
 * (verified 2026-07-03), so a fresh CRDO/ALAB-style Indian IPO is captured.
 *
 * CSV columns (header, matched by name not index):
 *   SYMBOL, NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE,
 *   MARKET LOT, ISIN NUMBER, FACE VALUE
 *
 * yahooTicker = SYMBOL + '.NS'. NSE symbols are A-Z/0-9 plus '&' and '-'
 * (e.g. M&M, BAJAJ-AUTO, J&KBANK); Yahoo preserves these verbatim, so
 * M&M → M&M.NS. marketCap is intentionally NOT set (Yahoo fills it later).
 *
 * Returns Map<yahooTicker, {ticker, name, exchange, source, country}>.
 * Transport/schema failure → empty Map with own `partial === true`, so the
 * discovery consumer can distinguish source loss from a healthy empty register.
 */
'use strict';
const https = require('https');

const EQUITY_URL =
  'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv';

// NSE archives 403s without a Referer from the main site.
const REFERER = 'https://www.nseindia.com/';

// mirror finnhub.js / sse-cn.js redirect hardening: cap recursion, resolve
// relative Location, follow 301/302/307/308, drain non-200 bodies.
const MAX_REDIRECTS = 5;
function get(url, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
          'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'text/csv,text/plain,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': REFERER,
      },
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

// Parse one CSV record into fields. The NSE file is simple (no quoted commas),
// but handle double-quoted fields defensively in case a company name ever
// contains a comma. Records never span newlines in this file.
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
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  if (inQuotes) throw new Error('unterminated quoted CSV field');
  out.push(cur);
  return out;
}

function parseEquityCsv(csvText) {
  const result = new Map();
  if (typeof csvText !== 'string') {
    throw new Error('required NSE headers missing: SYMBOL, NAME OF COMPANY');
  }
  const lines = csvText.split(/\r?\n/);

  const header = parseCsvLine(lines[0]).map((h, i) => {
    const normalized = i === 0 ? h.replace(/^\uFEFF/, '') : h;
    return normalized.trim().toUpperCase();
  });
  const iSym  = header.indexOf('SYMBOL');
  const iName = header.indexOf('NAME OF COMPANY');
  if (iSym < 0 || iName < 0) {
    throw new Error('required NSE headers missing: SYMBOL, NAME OF COMPANY');
  }

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const f = parseCsvLine(lines[i]);
    if (iSym >= f.length || iName >= f.length) {
      throw new Error(`NSE row ${i + 1} is missing required columns`);
    }
    const sym = (f[iSym] || '').trim().toUpperCase();
    const name = (f[iName] || '').trim();
    if (!sym || !name) {
      throw new Error(`NSE row ${i + 1} has an empty required field`);
    }
    // NSE symbols: A-Z, 0-9, '&' and '-' only (e.g. M&M, BAJAJ-AUTO).
    if (!/^[A-Z0-9&-]+$/.test(sym)) continue;
    const yahooTicker = sym + '.NS';
    if (result.has(yahooTicker)) continue;
    result.set(yahooTicker, {
      ticker: yahooTicker,
      name,
      exchange: 'NSE',
      source: 'nse-in',
      country: 'India',
    });
  }
  return result;
}

async function fetchNseIndia(dependencies = {}) {
  const getFn = dependencies.getFn || get;
  try {
    console.log('  [NSE-IN] Fetching NSE equity list...');
    const csv = await getFn(EQUITY_URL);
    const result = parseEquityCsv(csv);
    console.log(`  [NSE-IN] Total listed NSE stocks: ${result.size}`);
    return result;
  } catch (e) {
    console.error('  [NSE-IN] failed: ' + e.message);
    const partial = new Map();
    partial.partial = true;
    return partial;
  }
}

module.exports = { fetchNseIndia, parseEquityCsv };

if (require.main === module) {
  fetchNseIndia().then(m => {
    console.log('Total:', m.size);
    const sample = [...m.entries()].slice(0, 8);
    for (const [sym, info] of sample) console.log(' ', sym, '-', info.name);
  }).catch(console.error);
}
