'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchNasdaqApiList } = require('../discovery/nasdaq-api.js');

const ROW_BY_EXCHANGE = {
  nasdaq: { symbol: 'NDAQ', name: 'Nasdaq Inc', sector: 'Financials', marketCap: '$1B' },
  nyse: { symbol: 'IBM', name: 'International Business Machines', sector: 'Technology', marketCap: '$2B' },
  amex: { symbol: 'CET', name: 'Central Securities Corp', sector: 'Financials', marketCap: '$3B' },
};

function budgetStub() {
  return {
    name: 'NASDAQ-API test',
    budgetMs: 60000,
    verbrauchtMs: () => 0,
    restMs: () => 60000,
    erschoepft: () => false,
  };
}

async function runAdapter(emptyExchange) {
  const errors = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => {};
  console.error = (...parts) => errors.push(parts.join(' '));
  try {
    const result = await fetchNasdaqApiList({
      budget: budgetStub(),
      holen: async (url) => {
        const exchange = new URL(url).searchParams.get('exchange');
        const rows = exchange === emptyExchange ? [] : [ROW_BY_EXCHANGE[exchange]];
        return JSON.stringify(rows);
      },
    });
    return { result, errors };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

test('three non-empty required exchanges remain a complete source', async () => {
  const { result, errors } = await runAdapter(null);

  assert.deepEqual([...result.keys()], ['NDAQ', 'IBM', 'CET']);
  assert.equal(result.partial, undefined);
  assert.deepEqual(errors, []);
});

test('an empty required exchange preserves survivors but marks the source partial', async () => {
  const { result, errors } = await runAdapter('nyse');

  assert.deepEqual([...result.keys()], ['NDAQ', 'CET']);
  assert.deepEqual(
    {
      partial: result.partial === true,
      diagnosed: errors.some((line) => /NYSE \(nyse\) failed:.*zero rows/i.test(line)),
    },
    { partial: true, diagnosed: true }
  );
});
