#!/usr/bin/env node
/**
 * Live smoke test for discovery/sse-cn.js (Shanghai Stock Exchange register).
 *
 * Hits the real SSE endpoint (keyless, needs a Referer header). Asserts:
 *   - the module exports fetchSseUniverse and returns a Map
 *   - rowCount > 0 (the register loaded)
 *   - every key is a well-formed Yahoo ticker: 6 digits + '.SS'
 *   - each value carries exchange='SSE', country='China', source='sse-cn'
 *   - STAR Market (688xxx) is present
 *   - contract discipline: marketCap is NOT set (comes from Yahoo later)
 *
 * Network-dependent by design (the whole point is proving the live endpoint).
 * Exits non-zero on any violation (CI-friendly).
 *
 * Run:  node tests/discovery/sse-cn.test.js
 */
'use strict';
const assert = require('assert');
const { fetchSseUniverse } = require('../../discovery/sse-cn');

const TICKER_RE = /^\d{6}\.SS$/;

(async () => {
  const map = await fetchSseUniverse();

  assert.ok(map instanceof Map, 'fetchSseUniverse must return a Map');
  assert.ok(map.size > 0, 'expected rowCount > 0 (register empty — endpoint/Referer broken?)');

  let star = 0;
  for (const [key, info] of map) {
    assert.ok(TICKER_RE.test(key), 'bad yahooTicker key: ' + key);
    assert.strictEqual(info.ticker, key, 'info.ticker must equal the map key: ' + key);
    assert.strictEqual(info.exchange, 'SSE', 'exchange must be SSE: ' + key);
    assert.strictEqual(info.country, 'China', 'country must be China: ' + key);
    assert.strictEqual(info.source, 'sse-cn', 'source must be sse-cn: ' + key);
    assert.ok(!('marketCap' in info), 'marketCap must NOT be set by discovery: ' + key);
    if (info.ipoDate !== undefined) {
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(info.ipoDate), 'bad ipoDate: ' + key + ' ' + info.ipoDate);
    }
    if (key.startsWith('688')) star++;
  }

  assert.ok(star > 0, 'expected STAR Market (688xxx) tickers in the register');

  console.log('PASSED: sse-cn live smoke — ' + map.size + ' A-shares, ' + star + ' STAR (688xxx)');
})().catch(e => {
  console.error('FAILED: ' + e.message);
  process.exit(1);
});
