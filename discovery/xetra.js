#!/usr/bin/env node
/**
 * Deutsche Börse Xetra — full tradable-instrument register, keyless.
 * ==================================================================
 * Source: the official "All tradable instruments" CSV that Deutsche Börse
 * publishes daily for the Xetra (XETR) venue (keyless, live-verified 2026-07-03).
 *   https://www.cashmarket.deutsche-boerse.com/resource/blob/1528/<hash>/data/t7-xetr-allTradableInstruments.csv
 *
 * The blob id 1528 is stable; the <hash> segment changes on every daily update,
 * but the server 302-redirects any old-hash URL to the current one — so a fixed
 * old-hash URL is self-healing (verified: b2b41f36… → 5783d2f3…). We follow
 * redirects (MAX_REDIRECTS) rather than scraping the download page.
 *
 * File layout (semicolon-delimited, UTF-8):
 *   line 0: "Market:;XETR"
 *   line 1: "Date Last Update:;DD.MM.YYYY"
 *   line 2: column header
 *   line 3+: one row per instrument
 * Columns are matched by header NAME (not fixed index) so a column reshuffle
 * doesn't corrupt the parse. Columns used: Instrument (name), Mnemonic (Xetra
 * ticker), Instrument Type, First Trading Date.
 *
 * Only Instrument Type == 'CS' (common shares) is kept — this drops ETF/ETN/
 * ETC/SR (3036 ETF + 380 ETN + 205 ETC + 1 SR on 2026-07-03), leaving ~1396
 * shares, all EUR. The full register catches young IPOs (IONOS 2023, SCHOTT
 * PHARMA 2023, SPRINGER NATURE 2024, DOUGLAS 2025 all present).
 *
 * yahooTicker = Mnemonic + '.DE'. Verified against real Yahoo tickers:
 * SAP.DE, SIE.DE, MBG.DE, RHM.DE, ADS.DE, P911.DE, PAH3.DE, SHL.DE, ENR.DE.
 * Mnemonics are [A-Z0-9]{3,4}, unique across the CS rows (0 collisions).
 *
 * Foreign issuers dual-listed on Xetra (e.g. US/NL/CH ISINs) are kept — they
 * genuinely trade on Xetra with a .DE Yahoo ticker; country is the VENUE
 * ('Germany'), mirroring how the other venue adapters set country.
 *
 * marketCap is intentionally NOT set (Yahoo fills it later). Node built-ins
 * only. Never throws — returns an empty Map() on any failure (fail-silent,
 * mirroring finnhub.js / sse-cn.js).
 *
 * Returns Map<yahooTicker, {ticker, name, exchange, source, country, ipoDate?}>
 */
'use strict';
const https = require('https');

const XETRA_URL =
  'https://www.cashmarket.deutsche-boerse.com/resource/blob/1528/' +
  'b2b41f36cd1ccdc2a05d180d6966b9fb/data/t7-xetr-allTradableInstruments.csv';

// The download host serves the file only with a plausible browser UA + Referer.
const REFERER = 'https://www.cashmarket.deutsche-boerse.com/';

// mirror finnhub.js / sse-cn.js redirect hardening: cap recursion, resolve
// relative Location, follow 301/302/307/308. The daily-hash 302 lands here.
const MAX_REDIRECTS = 5;
function get(url, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (screener-data)',
        'Referer': REFERER,
        'Accept': 'text/csv,*/*',
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

// First Trading Date is already 'YYYY-MM-DD'; pass through if well-formed.
function toIpoDate(raw) {
  const s = String(raw || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
}

function parseXetra(csvText) {
  const result = new Map();
  const lines = csvText.split(/\r?\n/);
  // line 0/1 banner, line 2 header, line 3+ data.
  if (lines.length < 4) return result;

  const header = lines[2].split(';').map(h => h.trim());
  const iName = header.indexOf('Instrument');
  const iMnem = header.indexOf('Mnemonic');
  const iType = header.indexOf('Instrument Type');
  const iFTD  = header.indexOf('First Trading Date');
  if (iName < 0 || iMnem < 0 || iType < 0) return result; // layout changed → bail silently

  for (let i = 3; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    // ponytail: leading columns we read carry no quoted/embedded ';', so a plain
    // split is safe. Swap in a CSV parser only if those columns ever gain quotes.
    const f = lines[i].split(';');
    if ((f[iType] || '').trim() !== 'CS') continue; // common shares only
    const mnem = (f[iMnem] || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{1,6}$/.test(mnem)) continue; // skip empty / malformed mnemonics
    const yahooTicker = mnem + '.DE';
    if (result.has(yahooTicker)) continue;
    const info = {
      ticker: yahooTicker,
      name: (f[iName] || '').trim(),
      exchange: 'XETRA',
      source: 'xetra',
      country: 'Germany',
    };
    const ipoDate = iFTD >= 0 ? toIpoDate(f[iFTD]) : undefined;
    if (ipoDate) info.ipoDate = ipoDate;
    result.set(yahooTicker, info);
  }
  return result;
}

async function fetchXetraUniverse() {
  const result = new Map();
  try {
    console.log('  [XETRA] Fetching Xetra all-tradable-instruments register...');
    const csv = await get(XETRA_URL);
    const parsed = parseXetra(csv);
    for (const [k, v] of parsed) result.set(k, v);
    console.log(`  [XETRA] Total listed Xetra shares: ${result.size}`);
  } catch (e) {
    console.error('  [XETRA] failed: ' + e.message);
    return new Map(); // fail-silent per contract
  }
  return result;
}

module.exports = { fetchXetraUniverse };

if (require.main === module) {
  fetchXetraUniverse().then(m => {
    console.log('Total:', m.size);
    const sample = [...m.values()].slice(0, 8);
    for (const info of sample) console.log(' ', info.ticker, '-', info.name, '(', info.ipoDate || '?', ')');
  }).catch(console.error);
}
