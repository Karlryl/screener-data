'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('./helpers/offline-network-guard');
const { fetchNasdaqApiList } = require('../discovery/nasdaq-api.js');

const ROWS_BY_EXCHANGE = {
  nasdaq: [
    { symbol: 'FILL', name: 'Fill Corp', marketCap: '' },
    { symbol: 'KEEP', name: 'Keep Corp', marketCap: '$1B' },
  ],
  nyse: [
    { symbol: 'FILL', name: 'Fill Corp', marketCap: '$2B' },
    { symbol: 'KEEP', name: 'Keep Corp', marketCap: '$9B' },
  ],
  amex: [
    { symbol: 'CTRL', name: 'Control Corp', marketCap: '$3B' },
  ],
};

function budgetStub() {
  return {
    name: 'NASDAQ-API backfill guard',
    budgetMs: 60000,
    verbrauchtMs: () => 0,
    restMs: () => 60000,
    erschoepft: () => false,
  };
}

let result;

test.before(async () => {
  result = await fetchNasdaqApiList({
    budget: budgetStub(),
    holen: async (url) => {
      const exchange = new URL(url).searchParams.get('exchange');
      return JSON.stringify(ROWS_BY_EXCHANGE[exchange]);
    },
  });
});

test('a later duplicate backfills a missing market-cap hint', () => {
  assert.equal(result.get('FILL').marketCap, 2e9);
});

test('a later duplicate does not overwrite an existing market-cap hint', () => {
  assert.equal(result.get('KEEP').marketCap, 1e9);
});
