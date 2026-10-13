'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { detectShape, extractStocksArray } = require('../lib/watchlist-fs.js');

test('a valid ticker key remains a supported legacy map', () => {
  const raw = { AAPL: { name: 'Apple' } };

  assert.equal(detectShape(raw), 'object');
  assert.deepEqual(extractStocksArray(raw), [
    { ticker: 'AAPL', name: 'Apple' },
  ]);
});

test('an object-valued metadata key is not a ticker map', () => {
  const raw = { _meta: { generatedAt: 'fixture' } };

  assert.equal(detectShape(raw), 'invalid');
  assert.equal(extractStocksArray(raw), null);
});
