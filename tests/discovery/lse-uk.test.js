#!/usr/bin/env node
/**
 * Live smoke test for discovery/lse-uk.js (LSE Main Market + AIM register).
 *
 * Hits the real LSE price-explorer gateway (keyless, needs a Referer header).
 * Asserts:
 *   - the module exports fetchLseUniverse and returns a Map
 *   - rowCount is large (full register, not an index — expect > 1000)
 *   - every key is a well-formed Yahoo .L ticker
 *   - each value carries exchange in {LSE,AIM}, country='United Kingdom', source='lse'
 *   - both Main Market and AIM are represented
 *   - contract discipline: marketCap is NOT set (comes from Yahoo later)
 *   - the tidm→Yahoo mapping (pure) handles the dot/share-class quirks
 *
 * Network-dependent by design (the whole point is proving the live endpoint).
 * Exits non-zero on any violation (CI-friendly).
 *
 * Run:  node tests/discovery/lse-uk.test.js
 */
'use strict';
const assert = require('assert');
const { fetchLseUniverse, toYahooTicker } = require('../../discovery/lse-uk');

const TICKER_RE = /^[A-Z0-9-]+\.L$/;

// Pure-mapping unit checks (no network) — the load-bearing tidm quirks.
assert.strictEqual(toYahooTicker('AAL'), 'AAL.L', 'plain tidm');
assert.strictEqual(toYahooTicker('BP.'), 'BP.L', 'trailing-dot ordinary line');
assert.strictEqual(toYahooTicker('BT.A'), 'BT-A.L', 'share-class dot → hyphen');
assert.strictEqual(toYahooTicker('AO.'), 'AO.L', 'trailing-dot');
assert.strictEqual(toYahooTicker(''), null, 'empty tidm → null');

(async () => {
  const map = await fetchLseUniverse();

  assert.ok(map instanceof Map, 'fetchLseUniverse must return a Map');
  assert.ok(map.size > 1000, 'expected full register > 1000 (got ' + map.size + ' — endpoint/Referer broken?)');

  let main = 0, aim = 0;
  for (const [key, info] of map) {
    assert.ok(TICKER_RE.test(key), 'bad yahooTicker key: ' + key);
    assert.strictEqual(info.ticker, key, 'info.ticker must equal the map key: ' + key);
    assert.ok(info.exchange === 'LSE' || info.exchange === 'AIM', 'exchange must be LSE/AIM: ' + key);
    assert.strictEqual(info.country, 'United Kingdom', 'country must be United Kingdom: ' + key);
    assert.strictEqual(info.source, 'lse', 'source must be lse: ' + key);
    assert.ok(!('marketCap' in info), 'marketCap must NOT be set by discovery: ' + key);
    if (info.exchange === 'LSE') main++; else aim++;
  }

  assert.ok(main > 0, 'expected Main Market tickers');
  assert.ok(aim > 0, 'expected AIM tickers');

  console.log('PASSED: lse-uk live smoke — ' + map.size + ' equities (' + main + ' Main, ' + aim + ' AIM)');
})().catch(e => {
  console.error('FAILED: ' + e.message);
  process.exit(1);
});
