'use strict';
/**
 * Bug 26 regression: keyed-map (bare-object) shape must synthesize a stocks
 * array from ONLY the ticker-like keys, not from metadata keys like updatedAt.
 * Run standalone: node --test lib/watchlist-fs.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractStocksArray, detectShape } = require('./watchlist-fs.js');

test('bare-object shape ignores metadata keys', () => {
  const raw = {
    AAPL: { note: 'x' },
    MSFT: { note: 'y' },
    NVDA: { note: 'z' },
    updatedAt: '2026-07-03',
    note: 'universe snapshot',
  };
  assert.equal(detectShape(raw), 'object');
  const stocks = extractStocksArray(raw);
  // 3 ticker keys -> 3 synthetic stocks (was 5, incl. {ticker:'updatedAt'})
  assert.equal(stocks.length, 3);
  const tickers = stocks.map(s => s.ticker).sort();
  assert.deepEqual(tickers, ['AAPL', 'MSFT', 'NVDA']);
  // metadata string values must NOT be spread into char-indexed props
  assert.ok(!stocks.some(s => s.ticker === 'updatedAt'));
});
