'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { detectShape, extractStocksArray } = require('../lib/watchlist-fs.js');

test('wrapped payload keeps its stocks array', () => {
  const stocks = [{ ticker: 'AAPL' }];
  const raw = { _meta: { generatedAt: 'fixture' }, stocks };

  assert.equal(detectShape(raw), 'wrapped');
  assert.strictEqual(extractStocksArray(raw), stocks);
});

test('bare array remains a supported legacy shape', () => {
  const raw = [{ ticker: 'MSFT' }];

  assert.equal(detectShape(raw), 'array');
  assert.strictEqual(extractStocksArray(raw), raw);
});

test('valid ticker-keyed map ignores non-object metadata', () => {
  const raw = {
    AAPL: { name: 'Apple' },
    MSFT: { name: 'Microsoft' },
    updatedAt: 'fixture',
  };

  assert.equal(detectShape(raw), 'object');
  assert.deepEqual(extractStocksArray(raw), [
    { ticker: 'AAPL', name: 'Apple' },
    { ticker: 'MSFT', name: 'Microsoft' },
  ]);
});

for (const [label, corruptStocks] of [
  ['object', { rows: [] }],
  ['string', 'broken'],
  ['null', null],
]) {
  test(`reserved stocks key with ${label} value is invalid`, () => {
    const raw = {
      stocks: corruptStocks,
      AAPL: { name: 'Apple' },
      MSFT: { name: 'Microsoft' },
    };

    assert.equal(detectShape(raw), 'invalid');
    assert.equal(extractStocksArray(raw), null);
  });
}
