#!/usr/bin/env node
/**
 * Live smoke test for discovery/oslo.js (Euronext Oslo register).
 *
 * Hits the real Euronext live-markets CSV download (keyless, needs a Referer).
 * Asserts:
 *   - the module exports fetchOsloUniverse and returns a Map
 *   - rowCount > 0 (register loaded)
 *   - every key is a well-formed Yahoo Oslo ticker: SYMBOL + '.OL'
 *   - each value carries source='oslo', country='Norway'
 *   - exchange is one of the three real Oslo markets (proves ETLX foreign
 *     cross-listings were excluded — those carry Market='EuroTLX')
 *   - Euronext Growth Oslo (the young-IPO junior board) is present, so a fresh
 *     junior name would be caught, not just the main board
 *   - a couple of anchor blue chips resolve (EQNR.OL, DNB.OL)
 *   - contract discipline: marketCap is NOT set (comes from Yahoo later)
 *
 * Network-dependent by design. Exits non-zero on any violation (CI-friendly).
 * Run:  node tests/discovery/oslo.test.js
 */
'use strict';
const assert = require('assert');
const { fetchOsloUniverse } = require('../../discovery/oslo');

const TICKER_RE = /^[A-Z0-9][A-Z0-9.\-]*\.OL$/;
const OSLO_MARKETS = new Set(['Oslo Børs', 'Euronext Expand Oslo', 'Euronext Growth Oslo']);

(async () => {
  const map = await fetchOsloUniverse();

  assert.ok(map instanceof Map, 'fetchOsloUniverse must return a Map');
  assert.ok(map.size > 0, 'expected rowCount > 0 (register empty — endpoint/Referer broken?)');

  let growth = 0;
  for (const [key, info] of map) {
    assert.ok(TICKER_RE.test(key), 'bad yahooTicker key: ' + key);
    assert.ok(key.endsWith('.OL'), 'ticker must carry .OL suffix: ' + key);
    assert.strictEqual(info.ticker, key, 'info.ticker must equal the map key: ' + key);
    assert.strictEqual(info.source, 'oslo', 'source must be oslo: ' + key);
    assert.strictEqual(info.country, 'Norway', 'country must be Norway: ' + key);
    assert.ok(OSLO_MARKETS.has(info.exchange),
      'exchange must be a real Oslo market (ETLX leaked?): ' + key + ' => ' + info.exchange);
    assert.ok(!('marketCap' in info), 'marketCap must NOT be set by discovery: ' + key);
    if (info.exchange === 'Euronext Growth Oslo') growth++;
  }

  assert.ok(growth > 0, 'expected Euronext Growth Oslo (young-IPO board) tickers in the register');
  assert.ok(map.has('EQNR.OL'), 'expected anchor blue chip EQNR.OL (Equinor) in the register');
  assert.ok(map.has('DNB.OL'), 'expected anchor blue chip DNB.OL (DNB Bank) in the register');

  console.log('PASSED: oslo live smoke — ' + map.size + ' Oslo stocks, ' + growth + ' Euronext Growth');
})().catch(e => {
  console.error('FAILED: ' + e.message);
  process.exit(1);
});
