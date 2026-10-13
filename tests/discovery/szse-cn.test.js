#!/usr/bin/env node
/**
 * Live smoke test for discovery/szse-cn.js (SZSE Shenzhen A-share universe).
 *
 * Hits the real SZSE report endpoint (keyless, needs a Referer header) and
 * asserts the adapter honours the discovery contract:
 *   - returns a non-empty Map
 *   - every yahooTicker matches the 6-digit + '.SZ' suffix form
 *   - exchange/source/country stamped correctly, marketCap NOT set
 *   - at least one ChiNext (300/301xxx) code is present
 *
 * ONLINE — needs network. Exits non-zero on any violation (CI-friendly).
 *
 * Run:
 *   node tests/discovery/szse-cn.test.js
 */
'use strict';

const assert = require('assert');
const { fetchSzseUniverse } = require('../../discovery/szse-cn.js');

(async () => {
  const map = await fetchSzseUniverse();

  assert.ok(map instanceof Map, 'must return a Map');
  assert.ok(map.size > 0, `rowCount must be > 0, got ${map.size}`);

  const TICKER_RE = /^\d{6}\.SZ$/;
  let chinext = 0;
  for (const [sym, info] of map) {
    assert.ok(TICKER_RE.test(sym), `bad yahooTicker suffix form: ${sym}`);
    assert.strictEqual(info.ticker, sym, `info.ticker mismatch for ${sym}`);
    assert.strictEqual(info.exchange, 'SZSE', `exchange must be SZSE for ${sym}`);
    assert.strictEqual(info.source, 'szse-cn', `source must be szse-cn for ${sym}`);
    assert.strictEqual(info.country, 'China', `country must be China for ${sym}`);
    assert.ok(!('marketCap' in info), `marketCap must NOT be set for ${sym}`);
    assert.ok(info.name && info.name.length > 0, `name must be non-empty for ${sym}`);
    if (/^30[01]/.test(sym)) chinext++;
  }
  assert.ok(chinext > 0, 'expected at least one ChiNext (300/301) listing');

  console.log(`OK szse-cn: ${map.size} tickers, ${chinext} ChiNext`);
  const sample = [...map.keys()].slice(0, 3).join(', ');
  console.log(`  sample: ${sample}`);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
