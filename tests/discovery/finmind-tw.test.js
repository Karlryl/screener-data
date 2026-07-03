#!/usr/bin/env node
/**
 * Live test for discovery/finmind-tw.js
 * Hits the real FinMind endpoint. Asserts rowCount>0, correct suffix form,
 * contract shape, and that no ETF/warrant (non-4-digit) leaks through.
 */
'use strict';
const assert = require('assert');
const { fetchTaiwanUniverse } = require('../../discovery/finmind-tw');

(async () => {
  const map = await fetchTaiwanUniverse();
  assert(map instanceof Map, 'must return a Map');
  assert(map.size > 0, 'rowCount must be > 0 (got ' + map.size + ')');

  for (const [sym, info] of map) {
    // Suffix form: 4-digit id + .TW or .TWO
    assert(/^[0-9]{4}\.(TW|TWO)$/.test(sym), 'bad yahooTicker form: ' + sym);
    assert.strictEqual(info.ticker, sym, 'info.ticker must equal key');
    assert(typeof info.name === 'string', 'name must be string: ' + sym);
    assert(info.exchange === 'TWSE' || info.exchange === 'TPEx', 'bad exchange: ' + info.exchange);
    assert.strictEqual(info.source, 'finmind-tw', 'bad source: ' + info.source);
    assert.strictEqual(info.country, 'Taiwan', 'bad country: ' + info.country);
    // .TW must map to TWSE, .TWO to TPEx (suffix/exchange consistency)
    if (sym.endsWith('.TWO')) assert.strictEqual(info.exchange, 'TPEx', 'suffix/exchange mismatch: ' + sym);
    else assert.strictEqual(info.exchange, 'TWSE', 'suffix/exchange mismatch: ' + sym);
    assert.strictEqual(info.marketCap, undefined, 'marketCap must not be set: ' + sym);
  }

  // Sanity: TSMC (2330) must be present and .TW
  assert(map.has('2330.TW'), '2330.TW (TSMC) should be present');

  console.log('PASS finmind-tw:', map.size, 'tickers');
})().catch(e => { console.error('FAIL', e && e.message); process.exit(1); });
