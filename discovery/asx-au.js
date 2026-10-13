#!/usr/bin/env node
/**
 * ASX Australia (Australian Securities Exchange) Universe Discovery
 * =================================================================
 * Source: ASX company-directory export (keyless, live-verified 2026-08-03).
 *   https://asx.api.markitdigital.com/asx-research/1.0/companies/directory/file
 *
 * ENDPOINT MOVED 2026-08-03. The old register path
 * www.asx.com.au/asx/research/ASXListedCompanies.csv is switched off: the origin
 * answers 404, but the Imperva WAF in front of it hands our UA an HTTP **200**
 * with 378 bytes of "Request Rejected" HTML. Fed to a CSV parser, that reads as a
 * layout change — which is why get() below carries a Content-Type guard: being
 * turned away must never masquerade as "header row not found".
 *
 * The access_token in the URL is NOT a secret: the same value ships verbatim as
 * API_TOKEN inside the public asx.com.au clientlib bundle
 * (/etc.clientlibs/asx/clientlibs/clientlib-base-*.min.js) and is what the ASX
 * website itself calls this endpoint with — free, no account. Rotation risk: if
 * ASX cycles it we get 401/403 instead of data; pull a fresh token out of that
 * same bundle (its version number changes with every site release).
 *
 * A single plain-CSV file — no ZIP, no JSON, no paging. It is a full register
 * of every company listed on ASX (1840 data rows on 2026-08-03, incl. small caps
 * and young IPOs), not an index/top-list, so it catches early-stage listings.
 *
 * File layout (verified live 2026-08-03 — NO banner line any more):
 *   line 0: "ASX code","Company name","GICs industry group","Listing date","Market Cap"
 *   line 1+: `"CODE","NAME","GICs group","YYYY-MM-DD","<almost always empty>"`
 * All fields double-quoted, no BOM. locateColumns() matches columns by NAME and
 * order-independently, so this layout parses unchanged. Ordinary share codes are
 * 3-char [A-Z0-9]; the ~9 longer codes are second lines and are dropped on
 * purpose. yahooTicker = CODE + '.AX'.
 *
 * Do NOT wire up the new `Market Cap` column: it is populated on 1 of 1840 rows,
 * i.e. worthless. marketCap stays unset and comes from Yahoo later — that is the
 * contract, asserted in tests/discovery/asx-au.test.js:38.
 *
 * Node built-ins only. Never throws — returns an empty Map() on any failure
 * (fail-silent, mirroring sse-cn.js / edinet-jp.js).
 *
 * Returns Map<yahooTicker, {ticker, name, exchange, source, country}>.
 */
'use strict';
const https = require('https');

const ASX_URL = 'https://asx.api.markitdigital.com/asx-research/1.0/companies/directory/file'
  + '?access_token=83ff96335c2d45a094df02a206a39ff4';
const REFERER = 'https://www.asx.com.au/';
const MAX_REDIRECTS = 5;

// Redirect hardening mirrors sse-cn.js / edinet-jp.js: cap recursion, resolve
// relative Location, follow 301/302/307/308, drain non-200 bodies.
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
      // A 200 does not mean "we got the file": on 2026-08-03 the WAF in front of
      // asx.com.au answered 200 + 378 bytes of HTML. Checking the Content-Type keeps
      // a rejection out of the CSV parser, where it would surface as a bogus
      // "layout changed". Checked after buffering so the message can name the real size.
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const ct = String((res.headers || {})['content-type'] || '').split(';')[0].trim();
        if (!/^text\/(csv|plain)$/i.test(ct)) {
          return reject(new Error('HTTP 200 aber Content-Type ' + (ct || '(fehlt)')
            + ' (WAF-/Fehlerseite, ' + buf.length + ' Bytes)'));
        }
        resolve(buf.toString('utf8'));
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// Parse one CSV record into fields. Handles double-quoted fields, escaped ""
// quotes, and commas inside quotes. Records never span newlines in this file.
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
  out.push(cur);
  return out;
}

// Locate the header row by name ("ASX code") rather than a fixed index, so the
// banner-line count changing doesn't corrupt the parse. Returns {iName, iCode,
// width, dataStart} or null if the header can't be found.
function locateColumns(lines) {
  for (let i = 0; i < lines.length && i < 10; i++) {
    const f = parseCsvLine(lines[i]);
    const iCode = f.findIndex(h => h.trim().toLowerCase() === 'asx code');
    const iName = f.findIndex(h => h.trim().toLowerCase() === 'company name');
    if (iCode >= 0 && iName >= 0) return { iName, iCode, width: f.length, dataStart: i + 1 };
  }
  return null;
}

async function fetchAsxUniverse() {
  const result = new Map();
  console.log('  [ASX-AU] Fetching ASX listed-companies register...');
  let body;
  try {
    body = await get(ASX_URL);
  } catch (e) {
    console.error('  [ASX-AU] fetch failed: ' + e.message);
    return result; // fail-silent per contract
  }

  const lines = body.split(/\r?\n/);
  const cols = locateColumns(lines);
  if (!cols) {
    console.error('  [ASX-AU] header row not found (layout changed?)');
    return result;
  }

  for (let i = cols.dataStart; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const f = parseCsvLine(lines[i]);
    if (f.length !== cols.width) {
      result.partial = true;
      continue;
    }
    const code = (f[cols.iCode] || '').trim().toUpperCase();
    // ASX codes are 3-char alphanumeric. Reject anything else (stray footer text,
    // instrument codes) rather than emitting a broken Yahoo ticker.
    if (!/^[A-Z0-9]{3}$/.test(code)) continue;
    const yahooTicker = code + '.AX';
    if (result.has(yahooTicker)) continue;
    result.set(yahooTicker, {
      ticker: yahooTicker,
      name: (f[cols.iName] || '').trim(),
      exchange: 'ASX',
      source: 'asx',
      country: 'Australia',
    });
  }

  console.log(`  [ASX-AU] ${result.size} listed companies`);
  return result;
}

module.exports = { fetchAsxUniverse };

if (require.main === module) {
  fetchAsxUniverse().then(m => {
    console.log('Total:', m.size);
    const sample = [...m.values()].slice(0, 8);
    for (const info of sample) console.log(' ', info.ticker, '-', info.name);
  }).catch(console.error);
}
