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
const { isWhenIssuedSecurity } = require('./when-issued.js');
// DT-1: Gesamt-Zeitbudget statt Retry-Leiter je Anfrage (Herleitung dort).
const { zeitbudget, budgetRissMelden, mitBudget } = require('./zeitbudget.js');

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
// audit/fix: bare [WRU]$ dropped real tickers (NU/BKU/EW/ARW) — delimited-only, mirrors nasdaq-all.js
const JUNK_SUFFIX_RE = /\.WS$|\.WT$|\.WI$|\.RT$|\.UN$|\.U$/i;
// audit/fix: warrants/rights/units now caught via the company-name field (mirrors nasdaq-all.js)
// audit/fix: dropped over-broad \bunits?\b name-term — it excluded real MLPs (BEP/BIP/CQP/UNIT...); delimited .U$/.UN$ symbol filter still catches true unit symbols
// Bug 28: header promised preferred/depositary filtering but the regex only caught warrants/rights (mirrors nasdaq-all.js).
// ponytail: \bpreferred\b also catches REIT preferred-share issuers (e.g. "Preferred Apartment Communities") — acceptable, they are not common stock.
const JUNK_NAME_RE = /\b(?:warrant|right)s?\b|\bpreferred\b|\bdepositary\s+shares?\b/i;
function isJunkSecurity(symbol, name) {
  if (JUNK_SUFFIX_RE.test(symbol)) return true;
  if (isWhenIssuedSecurity(name)) return true;
  if (name && JUNK_NAME_RE.test(name)) return true;
  return false;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// audit F-A-2026-06-21: cap redirect chain depth (mirrors sec-tickers.js Tag 229c-2)
// to prevent an infinite redirect loop from hanging the puller indefinitely.
const MAX_REDIRECTS = 5;

function get(url, redirectsLeft = MAX_REDIRECTS) {
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
      // audit F-A-2026-06-21: harden redirect handling — prevents a relative
      // Location triggering ERR_INVALID_URL (which silently zeroes an exchange),
      // a socket leak from an undrained 3xx body, and unhandled 307/308 redirects.
      if (res.statusCode === 301 || res.statusCode === 302 ||
          res.statusCode === 307 || res.statusCode === 308) {
        const loc = res.headers.location;
        // Drain the redirect response body so the socket can be reused/freed.
        res.resume();
        if (!loc) {
          return reject(new Error('HTTP ' + res.statusCode + ' with no Location header from ' + url));
        }
        if (redirectsLeft <= 0) {
          return reject(new Error('too many redirects fetching ' + url));
        }
        let nextUrl;
        try {
          // Resolve Location against the current URL so a relative redirect
          // (e.g. "/path") does not blow up https.get with ERR_INVALID_URL.
          nextUrl = new URL(loc, url).toString();
        } catch (e) {
          return reject(new Error('invalid redirect Location "' + loc + '" from ' + url));
        }
        return get(nextUrl, redirectsLeft - 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume(); // audit F-A-2026-06-21: drain non-200 body to avoid socket leak
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
const RETRY_DELAYS = [15000, 45000];
const istTimeout = (e) => /timeout fetching/i.test(String((e && e.message) || ''));

async function fetchExchange(exchangeCode, exchangeLabel, budget, holen) {
  const url = `https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=${REQUEST_LIMIT}&exchange=${exchangeCode}&download=true`;
  console.log(`  [NASDAQ-API] Fetching ${exchangeLabel} (${exchangeCode})...`);

  // Tag 215i: retry on transient timeout. Run #107 had all 3 exchanges
  // (NASDAQ/NYSE/AMEX) fail with timeout fetching — single attempt with
  // 45s budget is fragile against NASDAQ-API rate-limit / cold-start
  // moments. Two retries with exponential backoff (15s, 45s) recover ~80%
  // of transient failures empirically. Errors other than timeout are
  // rethrown immediately (HTTP 4xx/5xx don't retry — they're persistent).
  //
  // DT-1 (Verifikation Exchange-Kanal 2026-08-04): 3 Boersen x 3 Versuchen x 45s
  // Socket-Timeout + [15s,45s] Backoff = 9m47s Worst case. Am 03.08. sind alle drei
  // in den Timeout gelaufen; zusammen mit otc-markets.js hat das den Schritt
  // "Refresh Universe" getoetet. Die Leiter bleibt, das Adapter-Budget schlaegt sie.
  const body = await mitBudget(budget, exchangeLabel, RETRY_DELAYS, istTimeout,
    () => (holen || get)(url));
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
  if (rows.length === 0) {
    throw new Error(`NASDAQ API returned zero rows for exchange=${exchangeCode}`);
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
async function fetchNasdaqApiList(opts) {
  const result = new Map();
  // DT-1: ein Budget fuer den GANZEN Adapter. `opts` nur fuer die Waechter (kein Netz,
  // keine echte Wartezeit); im Lauf sind es immer die Vorgabewerte.
  const budget = (opts && opts.budget) || zeitbudget('NASDAQ-API');
  console.log('  [NASDAQ-API] Fetching full exchange lists via NASDAQ Screener API (Tag 165)...');

  // DT-1: KEINE zweite Budget-Pruefung hier — mitBudget() prueft vor jedem Versuch und vor
  // jedem Backoff. Ein Boden, ein Ort (siehe otc-markets.js).
  let budgetGerissen = false;
  for (const { code, label } of EXCHANGES) {
    try {
      const rows = await fetchExchange(code, label, budget, opts && opts.holen);
      let added = 0;

      for (const row of rows) {
        const rawSym = (row.symbol || row.Symbol || '').trim().toUpperCase();
        if (!rawSym) continue;
        // Tag 217g (audit F-217a-01 HIGH fix): same class-share regex bug
        // as sec-tickers.js — original regex rejected BRK.B / BF.B / BRK-B.
        if (!/^[A-Z][A-Z0-9]{0,4}([.\-][A-Z])?$/.test(rawSym)) continue;

        const name     = (row.name || row.Name || row.companyName || '').trim();
        // audit/fix: bare [WRU]$ dropped real tickers (NU/BKU/EW/ARW) — delimited-only, mirrors nasdaq-all.js
        if (isJunkSecurity(rawSym, name)) continue;

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
        } else {
          // audit F-A-2026-06-21: don't silently discard the marketCap hint for a ticker an
          // earlier source already found — backfill it if that entry has none.
          const existing = result.get(rawSym);
          if (existing && existing.marketCap == null && mcap != null) existing.marketCap = mcap;
        }
      }

      console.log(`  [NASDAQ-API] ${label}: ${rows.length} rows, ${added} new symbols`);
    } catch (e) {
      // DT-1: ein Budget-Riss ist kein Boersen-Einzelfehler — er beendet den Adapter.
      if (e && e.budgetRiss) {
        budgetRissMelden(result, budget, label + ' (' + e.message + ')');
        budgetGerissen = true;
        break;
      }
      console.error(`  [NASDAQ-API] ${label} (${code}) failed: ${e.message}`);
      // audit/fix DT-1: ein ausgefallener Boersen-Abzug war bisher NUR eine Konsolenzeile —
      // die zurueckgegebene Map trug kein Signal, ein Aufrufer sah an .size einen glatten
      // Erfolg (dieselbe Luecke, die BH-058 in otc-markets.js geschlossen hat).
      result.partial = true;
      // Non-fatal: continue with remaining exchanges
    }

    if (code !== EXCHANGES[EXCHANGES.length - 1].code) {
      await sleep(EXCHANGE_DELAY_MS);
    }
  }

  console.log(`  [NASDAQ-API] Total tickers: ${result.size}` +
    (budgetGerissen ? ' (TEILBESTAND — Zeitbudget gerissen, siehe ::error:: oben)' : ''));
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
