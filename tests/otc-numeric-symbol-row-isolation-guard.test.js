'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { fetchOTCMarkets } = require('../discovery/otc-markets.js');

const BUDGET = {
  name: 'OTC numeric-symbol fixture',
  budgetMs: 1000,
  erschoepft: () => false,
  restMs: () => 1000,
  verbrauchtMs: () => 0,
};

function row(symbol) {
  return {
    symbol,
    companyName: `${symbol} Company`,
    marketTier: 'Expert',
  };
}

function payload(rows, totalRecords) {
  return JSON.stringify({ stocks: { rows, totalRecords } });
}

async function exercise(rows, totalRecords) {
  const pages = [];
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};

  try {
    const result = await fetchOTCMarkets({
      budget: BUDGET,
      schlafen: async () => {},
      holen: async (url) => {
        const page = Number(new URL(url).searchParams.get('page'));
        pages.push(page);
        return page === 1 ? payload(rows, totalRecords) : payload([], totalRecords);
      },
    });
    return { result, pages };
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  }
}

test('a numeric OTC symbol cannot discard valid later rows from its page', async () => {
  const { result, pages } = await exercise([row(12345), row('GOOD')], 2);

  assert.deepEqual(pages, [1]);
  assert.deepEqual([...result.keys()], ['GOOD']);
  assert.equal(Object.hasOwn(result, 'partial'), false);
});

test('an ordinary string OTC symbol remains a complete one-page result', async () => {
  const { result, pages } = await exercise([row('GOOD')], 1);

  assert.deepEqual(pages, [1]);
  assert.deepEqual([...result.keys()], ['GOOD']);
  assert.equal(Object.hasOwn(result, 'partial'), false);
});
