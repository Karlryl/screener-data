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
      // Only plain alphanumeric US tickers (1-6 chars), allow class suffix like .A, .B
      if (!/^[A-Z][A-Z0-9]{0,4}[A-Z]?$/.test(ticker)) continue;
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
