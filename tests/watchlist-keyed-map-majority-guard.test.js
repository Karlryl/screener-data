'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { detectShape, extractStocksArray } = require('../lib/watchlist-fs.js');

test('accepts a keyed map when ticker entries are a strict majority', () => {
  const raw = {
    AAPL: { name: 'Apple' },
    updatedAt: '2026-09-02T00:00:00Z',
    MSFT: { name: 'Microsoft' },
  };

  assert.equal(detectShape(raw), 'object');
  assert.deepEqual(
    extractStocksArray(raw).map((stock) => stock.ticker).sort(),
    ['AAPL', 'MSFT'],
  );
});

test('rejects a keyed-map candidate when ticker entries only tie metadata', () => {
  const raw = {
    AAPL: { name: 'Apple' },
    updatedAt: '2026-09-02T00:00:00Z',
  };

  assert.equal(detectShape(raw), 'invalid');
  assert.equal(extractStocksArray(raw), null);
});
