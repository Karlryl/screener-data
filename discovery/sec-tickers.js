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
function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': USER_AGENT,
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

async function fetchSecTickers() {
  const result = new Map();
  try {
    console.log('  [SEC] Fetching company_tickers.json...');
    const body = await get(SEC_URL);
    const data = JSON.parse(body);
    for (const entry of Object.values(data)) {
      const ticker = (entry.ticker || '').toUpperCase().trim();
      const name = entry.title || '';
      const cik = String(entry.cik_str || entry.cik || '').padStart(10, '0');
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
