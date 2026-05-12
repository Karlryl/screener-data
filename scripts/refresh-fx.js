#!/usr/bin/env node
/**
 * Tag 124b: Daily FX-Refresh
 * Holt aktuelle FX-Raten via Yahoo Currency-Endpoint und schreibt fx-rates.json.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let YahooFinance = null;
try { YahooFinance = require('yahoo-finance2').default; }
catch (e) { try { YahooFinance = require('/tmp/node_modules/yahoo-finance2').default; } catch (e2) {} }
const yf = YahooFinance ? new YahooFinance({ suppressNotices: ['yahooSurvey'] }) : null;

const CURRENCIES = ['EUR', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'JPY', 'HKD', 'CNY',
                    'AUD', 'CAD', 'KRW', 'INR', 'TWD', 'BRL', 'MXN', 'ZAR', 'SGD'];

async function fetchFXRate(currency) {
  if (!yf) throw new Error('yahoo-finance2 not available');
  const symbol = currency + 'USD=X';
  try {
    const q = await yf.quote(symbol);
    return q && q.regularMarketPrice ? q.regularMarketPrice : null;
  } catch (e) {
    console.error('FX fetch failed for ' + currency + ': ' + e.message);
    return null;
  }
}

async function main() {
  const outPath = path.join(__dirname, '..', 'fx-rates.json');
  let existing = { USD: 1.0 };
  if (fs.existsSync(outPath)) {
    try { existing = JSON.parse(fs.readFileSync(outPath, 'utf8')).rates || existing; } catch (e) {}
  }
  const rates = Object.assign({ USD: 1.0 }, existing);
  const failed = [];
  for (const c of CURRENCIES) {
    const rate = await fetchFXRate(c);
    if (rate != null && rate > 0) {
      rates[c] = rate;
      console.log('  ' + c + 'USD = ' + rate.toFixed(5));
    } else {
      failed.push(c);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  const out = { fetchedAt: new Date().toISOString(), rates, failed };
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('Wrote fx-rates.json with ' + Object.keys(rates).length + ' currencies, ' + failed.length + ' failed');
  if (failed.length > CURRENCIES.length / 2) process.exit(1);
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
module.exports = { fetchFXRate };
