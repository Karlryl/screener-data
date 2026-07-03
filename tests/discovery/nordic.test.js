#!/usr/bin/env node
/**
 * Live smoke test for discovery/nordic.js (Nasdaq Nordic share register).
 *
 * Hits the real api.nasdaq.com screener (keyless, needs Referer/Origin). Asserts:
 *   - the module exports fetchNordicUniverse and returns a Map
 *   - rowCount > 0 (register loaded)
 *   - every key is a well-formed Yahoo Nordic ticker: [A-Z0-9-]+ + .ST/.CO/.HE/.IC
 *   - each value carries source='nordic', a known exchange/country, ticker==key
 *   - all four venues (.ST Stockholm, .CO Copenhagen, .HE Helsinki, .IC Reykjavik)
 *     are present — proves the whole Nordic universe loaded, not one venue
 *   - contract discipline: marketCap is NOT set (comes from Yahoo later)
 *
 * Network-dependent by design (the point is proving the live endpoint).
 * Exits non-zero on any violation (CI-friendly).
 *
 * Run:  node tests/discovery/nordic.test.js
 */
'use strict';
const assert = require('assert');
const { fetchNordicUniverse } = require('../../discovery/nordic');

const TICKER_RE = /^[A-Z0-9][A-Z0-9-]*\.(ST|CO|HE|IC)$/;
const VENUES = {
  '.ST': { exchange: 'Nasdaq Stockholm', country: 'Sweden' },
  '.CO': { exchange: 'Nasdaq Copenhagen', country: 'Denmark' },
  '.HE': { exchange: 'Nasdaq Helsinki', country: 'Finland' },
  '.IC': { exchange: 'Nasdaq Iceland', country: 'Iceland' },
};

(async () => {
  const map = await fetchNordicUniverse();

  assert.ok(map instanceof Map, 'fetchNordicUniverse must return a Map');
  assert.ok(map.size > 0, 'expected rowCount > 0 (register empty — endpoint/Referer broken?)');

  const seenSuffix = {};
  for (const [key, info] of map) {
    assert.ok(TICKER_RE.test(key), 'bad yahooTicker key: ' + key);
    assert.strictEqual(info.ticker, key, 'info.ticker must equal the map key: ' + key);
    assert.strictEqual(info.source, 'nordic', 'source must be nordic: ' + key);
    assert.ok(!('marketCap' in info), 'marketCap must NOT be set by discovery: ' + key);

    const suffix = key.slice(key.lastIndexOf('.'));
    const venue = VENUES[suffix];
    assert.ok(venue, 'unknown suffix: ' + key);
    assert.strictEqual(info.exchange, venue.exchange, 'exchange mismatch for ' + key);
    assert.strictEqual(info.country, venue.country, 'country mismatch for ' + key);
    seenSuffix[suffix] = (seenSuffix[suffix] || 0) + 1;
  }

  for (const suffix of Object.keys(VENUES)) {
    assert.ok(seenSuffix[suffix] > 0, 'expected at least one ' + suffix + ' ticker (venue missing)');
  }

  console.log('PASSED: nordic live smoke — ' + map.size + ' shares  ' +
    Object.entries(seenSuffix).map(([s, n]) => s + ':' + n).join(' '));
})().catch(e => {
  console.error('FAILED: ' + e.message);
  process.exit(1);
});
