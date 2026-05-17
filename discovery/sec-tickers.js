#!/usr/bin/env node
/**
 * Tag 133: SEC EDGAR Universe Discovery
 * Fetches all US-listed companies from SEC company_tickers.json (~10k tickers).
 * No auth required. User-Agent required per SEC robots policy.
 * Returns Map<ticker, {ticker, name, cik, source}>
 */
'use strict';
const https = require('https');

const SEC_URL = 'https://www.sec.gov/files/company_tickers.json';

// Tag 215g: SEC EDGAR rejects User-Agents without a real email contact.
// Run #107 log shows '[SEC] Failed: HTTP 403'. SEC policy requires the UA
// header to include a real contact so they can reach the requester. Same
// pattern as Tag 211j fix for scripts/pull-insider-form4.js.
const USER_AGENT = 'Karl Viehrig screener-data karl_viehrig@web.de';
// Tag 229c-2: redirect handler hardened.
// Prior implementation had two latent failure modes that would silently
// degrade the entire US universe (≈10k tickers vanish):
//   (a) `get(res.headers.location)` was passed straight to https.get(url, …).
//       The Node https client accepts either a string URL or an options object.
//       A *relative* Location header (e.g. SEC re-issues `/files/foo.json`
//       through a CDN that returns `Location: /alt-path/foo.json`) throws
//       `TypeError [ERR_INVALID_URL]` because https.get can't parse a path
//       without scheme/host. The .catch(reject) would surface it, but the
//       outer try/catch at line 62 swallows it as "[SEC] Failed: …" and
//       fetchSecTickers returns an empty Map. Downstream discovery proceeds
//       without the SEC source — the universe quietly shrinks.
//   (b) The redirect branch returned without consuming the 3xx response body.
//       Node holds the socket open expecting data; with HTTP keep-alive the
//       worker leaks a socket per redirect. Over a multi-hop chain (CDN →
//       origin) this can exhaust the agent socket pool.
//   (c) Redirect chains were unbounded — a misconfigured CDN that returns a
//       redirect loop would recurse until stack overflow.
// Fix: (a) resolve Location against the source URL via URL constructor;
// (b) call res.resume() to drain & free the socket; (c) cap chain depth at 5.
const MAX_REDIRECTS = 5;
function get(url, redirectsRemaining) {
  if (redirectsRemaining == null) redirectsRemaining = MAX_REDIRECTS;
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json'
      }
    }, res => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        // (b) drain the response so the socket is released back to the agent.
        res.resume();
        if (redirectsRemaining <= 0) {
          return reject(new Error('too many redirects (>' + MAX_REDIRECTS + ')'));
        }
        const loc = res.headers.location;
        if (!loc) return reject(new Error('HTTP ' + res.statusCode + ' without Location header'));
        // (a) resolve relative Location against the request URL — the URL
        // constructor returns the input unchanged when it's already absolute,
        // and joins paths correctly when relative.
        let nextUrl;
        try { nextUrl = new URL(loc, url).toString(); }
        catch (e) { return reject(new Error('invalid redirect Location: ' + loc)); }
        return get(nextUrl, redirectsRemaining - 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();  // drain socket on error responses too
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

async function fetchSecTickers() {
  const result = new Map();
  try {
    console.log('  [SEC] Fetching company_tickers.json...');
    const body = await get(SEC_URL);
    const data = JSON.parse(body);
    for (const entry of Object.values(data)) {
      const ticker = (entry.ticker || '').toUpperCase().trim();
      const name = entry.title || '';
      // Tag 229c-2: don't synthesize fake CIKs for entries missing both
      // cik_str and cik. Previously `String(undefined || '').padStart(10, '0')`
      // returned '0000000000' — a syntactically valid CIK that downstream code
      // (form-4-puller, EDGAR filing lookups) would happily query, returning
      // either 404 or — worse — the wrong company's filings if EDGAR ever
      // assigns CIK 0. Emit null instead so consumers can branch on it.
      const cikRaw = entry.cik_str != null ? entry.cik_str : entry.cik;
      const cik = (cikRaw != null && cikRaw !== '') ? String(cikRaw).padStart(10, '0') : null;
      if (!ticker) continue;
      if (/[\s\/\\]/.test(ticker)) continue;
      // Tag 217g (audit F-217a-01 HIGH fix): the original regex
      // /^[A-Z][A-Z0-9]{0,4}[A-Z]?$/ rejects ALL class-share tickers
      // despite the comment claiming "allow class suffix like .A, .B".
      // BRK.B, BF.B, BRK-B all rejected → SEC's authoritative feed silently
      // drops Berkshire-B and every other class-share variant. Fixed regex
      // accepts both dot (BRK.B) and dash (BRK-B) class separators.
      if (!/^[A-Z][A-Z0-9]{0,4}([.\-][A-Z])?$/.test(ticker)) continue;
      result.set(ticker, { ticker, name, cik, exchange: 'US', source: 'sec-edgar' });
    }
    console.log(`  [SEC] ${result.size} tickers loaded`);
  } catch (e) {
    console.error('  [SEC] Failed: ' + e.message);
  }
  return result;
}

module.exports = { fetchSecTickers };

if (require.main === module) {
  fetchSecTickers().then(m => console.log('Total:', m.size)).catch(console.error);
}
