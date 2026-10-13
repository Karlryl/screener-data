'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { detectShape, extractStocksArray } = require('../lib/watchlist-fs.js');

test('a wrapped watchlist remains a supported object root', () => {
  const raw = { stocks: [{ ticker: 'AAPL' }] };

  assert.equal(detectShape(raw), 'wrapped');
  assert.deepEqual(extractStocksArray(raw), [{ ticker: 'AAPL' }]);
});

test('a null JSON root remains invalid instead of entering object access', () => {
  assert.equal(detectShape(null), 'invalid');
  assert.equal(extractStocksArray(null), null);
});
