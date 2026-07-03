#!/usr/bin/env node
/**
 * Live test for discovery/tsx-ca.js
 * Hits the real TMX listed-companies XLSX register. Asserts rowCount>0, correct
 * .TO/.V yahooTicker forms, contract shape, that both venues are represented,
 * and that dual-class dot->hyphen rewriting produced at least one hyphen ticker.
 */
'use strict';
const assert = require('assert');
const { fetchTsxCanada } = require('../../discovery/tsx-ca');

(async () => {
  const map = await fetchTsxCanada();
  assert(map instanceof Map, 'must return a Map');
  assert(map.size > 1000, 'rowCount must be > 1000 (got ' + map.size + ')');

  let tsx = 0, tsxv = 0, hyphen = 0;
  for (const [sym, info] of map) {
    // Yahoo form: root (letters/digits, optional -class) + .TO or .V
    assert(/^[A-Z0-9]+(-[A-Z0-9]+)*\.(TO|V)$/.test(sym), 'bad yahooTicker form: ' + sym);
    assert.strictEqual(info.ticker, sym, 'info.ticker must equal key');
    assert(typeof info.name === 'string' && info.name.length > 0, 'name must be non-empty: ' + sym);
    assert(info.exchange === 'TSX' || info.exchange === 'TSXV', 'bad exchange: ' + info.exchange);
    assert.strictEqual(info.source, 'tsx', 'bad source: ' + info.source);
    assert.strictEqual(info.country, 'Canada', 'bad country: ' + info.country);
    assert.strictEqual(info.marketCap, undefined, 'marketCap must not be set: ' + sym);
    if (info.ipoDate !== undefined) {
      assert(/^\d{4}-\d{2}-\d{2}$/.test(info.ipoDate), 'bad ipoDate: ' + info.ipoDate);
    }
    if (sym.endsWith('.TO')) tsx++;
    else if (sym.endsWith('.V')) tsxv++;
    if (sym.includes('-')) hyphen++;
  }

  // Both venues must be present (this is the union register, not one exchange).
  assert(tsx > 500, 'expected many TSX (.TO) tickers, got ' + tsx);
  assert(tsxv > 300, 'expected many TSXV (.V) tickers, got ' + tsxv);
  // Dual-class/preferred rewriting (BBD.B -> BBD-B.TO) must have fired at least once.
  assert(hyphen > 0, 'expected at least one dot->hyphen class ticker');

  console.log('PASS tsx-ca:', map.size, 'issuers (', tsx, 'TSX /', tsxv, 'TSXV )');
})().catch(e => { console.error('FAIL', e && e.message); process.exit(1); });
