#!/usr/bin/env node
/**
 * Nasdaq Nordic (Stockholm / Copenhagen / Helsinki / Reykjavik) — full share
 * register, keyless. Live-verified 2026-07-03.
 * =========================================================================
 * Source: the JSON screener that powers www.nasdaq.com/european-market-activity/shares
 *   https://api.nasdaq.com/api/nordic/screener/shares?category={CATEGORY}
 *
 * Three categories together are the WHOLE listed share universe of the four
 * Nasdaq Nordic venues (not an index / top-list), so young IPOs on First North
 * Growth Market are included — the analog of catching a fresh CRDO/ALAB:
 *   MAIN_MARKET  (~253 rows)  — the regulated main markets
 *   FIRST_NORTH  (~413 rows)  — First North Growth Market (young / small caps)
 *   OTHERS       (~4 rows)    — misc (mostly BTA/TR temp instruments, dropped)
 *
 * The endpoint 403s / behaves oddly without a nasdaq.com Referer + Origin.
 * pageSize is irrelevant — each category returns its full row set in one call.
 *
 * VENUE → Yahoo suffix via the row `currency`, NOT the ISIN prefix.
 * ---------------------------------------------------------------------------
 * The screener has no per-row venue field and rejects any exchange filter
 * (all `&exchange=…` variants → HTTP 400). But each of the four venues trades
 * in its own national currency, and those four are mutually exclusive:
 *   SEK → Stockholm  (.ST)     DKK → Copenhagen (.CO)
 *   EUR → Helsinki   (.HE)     ISK → Reykjavik  (.IC)
 * Finland is the only euro member of the four, so EUR unambiguously = Helsinki.
 * Currency reflects the actual TRADING VENUE; the ISIN country prefix reflects
 * the issuer's domicile (a CH/US/CA-domiciled firm listed in Stockholm still
 * trades .ST), so currency is the correct, per-row-reliable venue key.
 *
 * yahooTicker = symbol.replace(/\s+/g,'-').toUpperCase() + suffix
 *   e.g. "MAERSK B"/DKK → MAERSK-B.CO, "ERIC B"/SEK → ERIC-B.ST,
 *        "ARION SDB"/SEK → ARION-SDB.ST, "NOKIA"/EUR → NOKIA.HE
 * (space→dash + suffix confirmed live against Yahoo's own symbol search.)
 *
 * marketCap intentionally NOT set (Yahoo fills it later). Node built-ins only.
 * Never throws — returns an empty Map() on any failure (fail-silent, mirroring
 * finnhub.js / sse-cn.js).
 *
 * Returns Map<yahooTicker, {ticker, name, exchange, source, country}>.
 */
'use strict';
const https = require('https');
const zlib = require('zlib');

const REMOTE = 'https://api.nasdaq.com/api/nordic/screener/shares?category=';
const CATEGORIES = ['MAIN_MARKET', 'FIRST_NORTH', 'OTHERS'];
const REQUIRED_NONEMPTY_CATEGORIES = new Set(['MAIN_MARKET', 'FIRST_NORTH']);

// Nasdaq Nordic trades each venue in its national currency; the four are
// disjoint, so currency is a reliable per-row venue key. → { suffix, exchange, country }
const CURRENCY_VENUE = {
  SEK: { suffix: '.ST', exchange: 'Nasdaq Stockholm', country: 'Sweden' },
  DKK: { suffix: '.CO', exchange: 'Nasdaq Copenhagen', country: 'Denmark' },
  EUR: { suffix: '.HE', exchange: 'Nasdaq Helsinki', country: 'Finland' },
  ISK: { suffix: '.IC', exchange: 'Nasdaq Iceland', country: 'Iceland' },
};

const REFERER = 'https://www.nasdaq.com/european-market-activity/shares';

// mirror finnhub.js / sse-cn.js redirect hardening: cap recursion, resolve a
// relative Location, follow 301/302/307/308, drain non-200 bodies.
const MAX_REDIRECTS = 5;
function get(url, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        // api.nasdaq.com gatekeeps on a nasdaq.com Referer/Origin.
        'Referer': REFERER,
        'Origin': 'https://www.nasdaq.com',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) screener-data',
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
      const enc = res.headers['content-encoding'];
      let stream = res;
      if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
      const chunks = [];
      stream.on('data', c => chunks.push(c));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      stream.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// "MAERSK B" → "MAERSK-B"; collapse inner whitespace to a single dash (Yahoo's
// convention for class shares). Reject anything with chars Yahoo won't carry.
function toYahooSymbol(rawSymbol, suffix) {
  const base = String(rawSymbol || '').trim().toUpperCase().replace(/\s+/g, '-');
  if (!base) return null;
  // Yahoo Nordic tickers are [A-Z0-9-] before the dotted suffix; skip oddballs.
  if (!/^[A-Z0-9][A-Z0-9-]*$/.test(base)) return null;
  return base + suffix;
}

function addRows(rows, result) {
  let added = 0;
  for (const row of rows) {
    if (!row) continue;
    const venue = CURRENCY_VENUE[String(row.currency || '').trim()];
    if (!venue) continue; // unknown/empty currency (e.g. BTA/TR temp instruments) → drop
    const yahooTicker = toYahooSymbol(row.symbol, venue.suffix);
    if (!yahooTicker) continue;
    if (result.has(yahooTicker)) continue;
    result.set(yahooTicker, {
      ticker: yahooTicker,
      name: String(row.fullName || '').trim(),
      exchange: venue.exchange,
      source: 'nordic',
      country: venue.country,
    });
    added++;
  }
  return added;
}

async function fetchNordicUniverse() {
  const result = new Map();
  console.log('  [Nordic] Fetching Nasdaq Nordic share register...');
  for (const category of CATEGORIES) {
    try {
      const body = await get(REMOTE + category);
      const j = JSON.parse(body);
      const rows = j && j.data && j.data.instrumentListing && Array.isArray(j.data.instrumentListing.rows)
        ? j.data.instrumentListing.rows : null;
      if (!rows) {
        console.error(`  [Nordic] ${category}: unexpected response shape`);
        result.partial = true; // S4-DISC-001: eine verlorene Kategorie ist ein Teilausfall
        continue;
      }
      if (rows.length === 0 && REQUIRED_NONEMPTY_CATEGORIES.has(category)) {
        console.error(`  [Nordic] ${category}: empty required category`);
        result.partial = true;
      }
      const added = addRows(rows, result);
      console.log(`  [Nordic] ${category}: ${rows.length} rows, ${added} shares added`);
    } catch (e) {
      // fail-silent per contract: one bad category must not kill the others.
      console.error(`  [Nordic] ${category} failed: ` + e.message);
      result.partial = true; // S4-DISC-001: dito — sonst sieht 2-von-3 aus wie 3-von-3
    }
  }
  console.log(`  [Nordic] Total: ${result.size} tickers`);
  return result;
}

module.exports = { fetchNordicUniverse };

if (require.main === module) {
  fetchNordicUniverse().then(m => {
    console.log('Total:', m.size);
    const sample = [...m.values()].slice(0, 10);
    for (const info of sample) console.log(' ', info.ticker, '-', info.name, '(', info.country, ')');
  }).catch(console.error);
}
