#!/usr/bin/env node
/**
 * Live test for discovery/nse-in.js
 * Hits the real NSE EQUITY_L.csv endpoint. Asserts rowCount>0, correct
 * yahooTicker (.NS) form, contract shape, and that a stable large-cap
 * (RELIANCE) plus a special-char symbol (M&M) survive the parse.
 */
'use strict';
const assert = require('assert');
const { fetchNseIndia } = require('../../discovery/nse-in');

(async () => {
  const map = await fetchNseIndia();
  assert(map instanceof Map, 'must return a Map');
  assert(map.size > 0, 'rowCount must be > 0 (got ' + map.size + ')');

  for (const [sym, info] of map) {
    // Suffix form: NSE symbol (A-Z/0-9/&/-) + .NS
    assert(/^[A-Z0-9&-]+\.NS$/.test(sym), 'bad yahooTicker form: ' + sym);
    assert.strictEqual(info.ticker, sym, 'info.ticker must equal key');
    assert(typeof info.name === 'string' && info.name.length > 0, 'name must be non-empty string: ' + sym);
    assert.strictEqual(info.exchange, 'NSE', 'bad exchange: ' + info.exchange);
    assert.strictEqual(info.source, 'nse-in', 'bad source: ' + info.source);
    assert.strictEqual(info.country, 'India', 'bad country: ' + info.country);
    assert.strictEqual(info.marketCap, undefined, 'marketCap must not be set: ' + sym);
  }

  // Sanity: RELIANCE — a stable large-cap — must be present.
  assert(map.has('RELIANCE.NS'), 'RELIANCE.NS should be present');
  // Sanity: at least one '&'/'-' special-char symbol must survive (e.g. M&M).
  assert(map.has('M&M.NS'), 'M&M.NS (special-char symbol) should be present');

  console.log('PASS nse-in:', map.size, 'tickers');
})().catch(e => { console.error('FAIL', e && e.message); process.exit(1); });
