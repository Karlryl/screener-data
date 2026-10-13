#!/usr/bin/env node
/**
 * Live test for discovery/edinet-jp.js
 * Hits the real EDINET code-list ZIP endpoint. Asserts rowCount>0, correct
 * yahooTicker suffix form, contract shape, and that the 2024+ alphanumeric
 * IPO codes (e.g. 285A.T = Kioxia) survive the parse.
 */
'use strict';
const assert = require('assert');
const { fetchEdinetJapan } = require('../../discovery/edinet-jp');

(async () => {
  const map = await fetchEdinetJapan();
  assert(map instanceof Map, 'must return a Map');
  assert(map.size > 0, 'rowCount must be > 0 (got ' + map.size + ')');

  for (const [sym, info] of map) {
    // Suffix form: 4-char JPX code (digits, or 3-digit+letter for 2024+ IPOs) + .T
    assert(/^[0-9]{4}\.T$/.test(sym) || /^[0-9]{3}[A-Z]\.T$/.test(sym),
      'bad yahooTicker form: ' + sym);
    assert.strictEqual(info.ticker, sym, 'info.ticker must equal key');
    assert(typeof info.name === 'string', 'name must be string: ' + sym);
    assert.strictEqual(info.exchange, 'TSE', 'bad exchange: ' + info.exchange);
    assert.strictEqual(info.source, 'edinet-jp', 'bad source: ' + info.source);
    assert.strictEqual(info.country, 'Japan', 'bad country: ' + info.country);
    assert.strictEqual(info.marketCap, undefined, 'marketCap must not be set: ' + sym);
  }

  // Sanity: Sakata Seed (1377) — a stable long-listed name — must be present.
  assert(map.has('1377.T'), '1377.T (Sakata Seed) should be present');
  // Sanity: at least one 2024+ alphanumeric IPO code must survive (e.g. 285A Kioxia).
  const hasAlnum = [...map.keys()].some(k => /^[0-9]{3}[A-Z]\.T$/.test(k));
  assert(hasAlnum, 'expected at least one alphanumeric 2024+ IPO code (e.g. 285A.T)');

  console.log('PASS edinet-jp:', map.size, 'tickers');
})().catch(e => { console.error('FAIL', e && e.message); process.exit(1); });
