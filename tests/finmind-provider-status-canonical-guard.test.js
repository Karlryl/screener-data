'use strict';

const assert = require('node:assert/strict');
const https = require('node:https');
const test = require('node:test');

const ENDPOINT = 'https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInfo';
const originalHttpsGet = https.get;
let networkTripwireHits = 0;

https.get = () => {
  networkTripwireHits += 1;
  throw new Error('FINMIND_STATUS_NETWORK_TRIPWIRE');
};

const { fetchTaiwanUniverse } = require('../discovery/finmind-tw.js');

test.after(() => {
  https.get = originalHttpsGet;
  assert.equal(networkTripwireHits, 0, 'fixture attempted a live FinMind request');
});

async function run(payload) {
  const originalLog = console.log;
  const originalError = console.error;
  let calls = 0;
  console.log = () => {};
  console.error = () => {};

  try {
    const result = await fetchTaiwanUniverse({
      getFn: async (url) => {
        calls += 1;
        assert.equal(url, ENDPOINT);
        return JSON.stringify(payload);
      },
    });
    assert.equal(calls, 1);
    return result;
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

function assertHealthyEmpty(result) {
  assert.equal(result.size, 0);
  assert.equal(Object.hasOwn(result, 'partial'), false);
}

function assertPartialEmpty(result) {
  assert.equal(result.size, 0);
  assert.equal(Object.hasOwn(result, 'partial'), true);
  assert.equal(result.partial, true);
}

test('canonical numeric and string statuses keep an empty response healthy', async () => {
  for (const status of [200, '200']) {
    assertHealthyEmpty(await run({ status, data: [] }));
  }
});

test('coercible and absent provider statuses remain visibly partial', async () => {
  const cases = [
    { status: ' 200 ', data: [] },
    { status: '0200', data: [] },
    { status: null, data: [] },
    { data: [] },
  ];

  for (const payload of cases) {
    assertPartialEmpty(await run(payload));
  }
});
