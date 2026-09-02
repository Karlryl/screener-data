'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { fetchNasdaqApiList } = require('../discovery/nasdaq-api.js');

const ROWS_BY_EXCHANGE = {
  nasdaq: [
    { Symbol: 'nup', name: 'North Upper Co', sector: 'Technology', marketCap: '$1B' },
    { symbol: 'nlo', name: 'North Lower Co', sector: 'Technology', marketCap: '$2B' },
  ],
  nyse: [
    { Symbol: 'yup', name: 'York Upper Co', sector: 'Industrials', marketCap: '$3B' },
    { symbol: 'ylo', name: 'York Lower Co', sector: 'Industrials', marketCap: '$4B' },
  ],
  amex: [
    { Symbol: 'aup', name: 'America Upper Co', sector: 'Financials', marketCap: '$5B' },
    { symbol: 'alo', name: 'America Lower Co', sector: 'Financials', marketCap: '$6B' },
  ],
};

function budgetStub() {
  return {
    name: 'NASDAQ-API alias guard',
    budgetMs: 60000,
    verbrauchtMs: () => 0,
    restMs: () => 60000,
    erschoepft: () => false,
  };
}

async function exerciseAdapter() {
  const requests = [];
  let networkTripwireHits = 0;
  const originalHttpsGet = https.get;
  const originalLog = console.log;
  const originalError = console.error;

  https.get = () => {
    networkTripwireHits++;
    throw new Error('unexpected live HTTPS request');
  };
  console.log = () => {};
  console.error = () => {};

  try {
    const result = await fetchNasdaqApiList({
      budget: budgetStub(),
      holen: async (url) => {
        requests.push(new URL(url));
        const exchange = new URL(url).searchParams.get('exchange');
        return JSON.stringify(ROWS_BY_EXCHANGE[exchange]);
      },
    });
    return { result, requests, networkTripwireHits };
  } finally {
    https.get = originalHttpsGet;
    console.log = originalLog;
    console.error = originalError;
  }
}

let fixture;

test.before(async () => {
  fixture = await exerciseAdapter();

  assert.equal(fixture.networkTripwireHits, 0);
  assert.deepEqual(
    fixture.requests.map((url) => url.searchParams.get('exchange')),
    ['nasdaq', 'nyse', 'amex']
  );
});

test('capitalized Symbol aliases remain accepted for every exchange', () => {
  assert.deepEqual(
    ['NUP', 'YUP', 'AUP'].map((ticker) => [ticker, fixture.result.get(ticker)?.exchange]),
    [['NUP', 'NASDAQ'], ['YUP', 'NYSE'], ['AUP', 'AMEX']]
  );
});

test('lowercase symbol rows remain the healthy producer control', () => {
  assert.deepEqual(
    ['NLO', 'YLO', 'ALO'].map((ticker) => [ticker, fixture.result.get(ticker)?.exchange]),
    [['NLO', 'NASDAQ'], ['YLO', 'NYSE'], ['ALO', 'AMEX']]
  );
  assert.equal(fixture.result.partial, undefined);
});
