#!/usr/bin/env node
/**
 * Live smoke test for discovery/xetra.js (Deutsche Börse Xetra register).
 *
 * Hits the real Deutsche Börse "all tradable instruments" CSV (keyless, needs a
 * browser UA + Referer, self-heals the daily hash via 302). Asserts:
 *   - the module exports fetchXetraUniverse and returns a Map
 *   - rowCount > 0 (the register loaded)
 *   - every key is a well-formed Yahoo ticker: [A-Z0-9]{1,6} + '.DE'
 *   - each value carries exchange='XETRA', country='Germany', source='xetra'
 *   - a well-known blue chip (SAP.DE) is present (sanity that CS filter works)
 *   - contract discipline: marketCap is NOT set (comes from Yahoo later)
 *
 * Network-dependent by design (the whole point is proving the live endpoint).
 * Exits non-zero on any violation (CI-friendly).
 *
 * Run:  node tests/discovery/xetra.test.js
 */
'use strict';
const assert = require('assert');
const { fetchXetraUniverse } = require('../../discovery/xetra');

const TICKER_RE = /^[A-Z0-9]{1,6}\.DE$/;

(async () => {
  const map = await fetchXetraUniverse();

  assert.ok(map instanceof Map, 'fetchXetraUniverse must return a Map');
  assert.ok(map.size > 0, 'expected rowCount > 0 (register empty — endpoint/Referer broken?)');

  for (const [key, info] of map) {
    assert.ok(TICKER_RE.test(key), 'bad yahooTicker key: ' + key);
    assert.strictEqual(info.ticker, key, 'info.ticker must equal the map key: ' + key);
    assert.strictEqual(info.exchange, 'XETRA', 'exchange must be XETRA: ' + key);
    assert.strictEqual(info.country, 'Germany', 'country must be Germany: ' + key);
    assert.strictEqual(info.source, 'xetra', 'source must be xetra: ' + key);
    assert.ok(!('marketCap' in info), 'marketCap must NOT be set by discovery: ' + key);
    if (info.ipoDate !== undefined) {
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(info.ipoDate), 'bad ipoDate: ' + key + ' ' + info.ipoDate);
    }
  }

  assert.ok(map.has('SAP.DE'), 'expected SAP.DE in the Xetra register (CS filter sane?)');

  console.log('PASSED: xetra live smoke — ' + map.size + ' Xetra shares');
})().catch(e => {
  console.error('FAILED: ' + e.message);
  process.exit(1);
});
