#!/usr/bin/env node
/**
 * Live smoke test for discovery/asx-au.js (ASX listed-companies register).
 *
 * Hits the real ASX CSV endpoint (keyless, needs a browser-ish UA/Referer).
 * Asserts:
 *   - the module exports fetchAsxUniverse and returns a Map
 *   - rowCount > 1000 (a full register loaded, not a truncated/empty page)
 *   - every key is a well-formed Yahoo ticker: 3 alphanumerics + '.AX'
 *   - each value carries exchange='ASX', country='Australia', source='asx'
 *   - contract discipline: marketCap is NOT set (comes from Yahoo later)
 *   - a couple of well-known large caps are present (BHP, CBA)
 *
 * Network-dependent by design (the point is proving the live endpoint).
 * Exits non-zero on any violation (CI-friendly).
 *
 * Run:  node tests/discovery/asx-au.test.js
 */
'use strict';
const assert = require('assert');
const { fetchAsxUniverse } = require('../../discovery/asx-au');

const TICKER_RE = /^[A-Z0-9]{3}\.AX$/;

(async () => {
  const map = await fetchAsxUniverse();

  assert.ok(map instanceof Map, 'fetchAsxUniverse must return a Map');
  assert.ok(map.size > 1000, 'expected a full register (>1000 rows), got ' + map.size);

  for (const [key, info] of map) {
    assert.ok(TICKER_RE.test(key), 'bad yahooTicker key: ' + key);
    assert.strictEqual(info.ticker, key, 'info.ticker must equal the map key: ' + key);
    assert.strictEqual(info.exchange, 'ASX', 'exchange must be ASX: ' + key);
    assert.strictEqual(info.country, 'Australia', 'country must be Australia: ' + key);
    assert.strictEqual(info.source, 'asx', 'source must be asx: ' + key);
    assert.ok(typeof info.name === 'string' && info.name.length > 0, 'name must be non-empty: ' + key);
    assert.ok(!('marketCap' in info), 'marketCap must NOT be set by discovery: ' + key);
  }

  // Sanity: the two largest ASX names should always be in a full register.
  assert.ok(map.has('BHP.AX'), 'expected BHP.AX in the register');
  assert.ok(map.has('CBA.AX'), 'expected CBA.AX in the register');

  console.log('PASSED: asx-au live smoke — ' + map.size + ' listed companies');
})().catch(e => {
  console.error('FAILED: ' + e.message);
  process.exit(1);
});
