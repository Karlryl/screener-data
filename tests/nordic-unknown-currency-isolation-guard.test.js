'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { Readable } = require('node:stream');

require('./helpers/offline-network-guard');
const { fetchNordicUniverse } = require('../discovery/nordic.js');

const CORE_ROWS = {
  MAIN_MARKET: [
    { symbol: 'MAIN', fullName: 'Main Company', currency: 'SEK' },
  ],
  FIRST_NORTH: [
    { symbol: 'FIRST', fullName: 'First Company', currency: 'DKK' },
  ],
};

async function runFixture(others) {
  const rowsByCategory = { ...CORE_ROWS, OTHERS: others };
  const blockedGet = https.get;
  https.get = (url, options, callback) => {
    const category = new URL(url).searchParams.get('category');
    const body = JSON.stringify({
      data: { instrumentListing: { rows: rowsByCategory[category] } },
    });
    const response = Readable.from([Buffer.from(body)]);
    response.statusCode = 200;
    response.headers = {};
    setImmediate(() => callback(response));
    const request = {
      on() { return request; },
      once() { return request; },
      setTimeout() { return request; },
      destroy() {},
      end() {},
    };
    return request;
  };

  try {
    return await fetchNordicUniverse();
  } finally {
    https.get = blockedGet;
  }
}

function assertHealthyCore(result) {
  assert.deepEqual([...result.keys()], ['MAIN.ST', 'FIRST.CO']);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'partial'), false);
}

test('a temp-style Nordic row with no currency is isolated locally', async () => {
  const result = await runFixture([
    { symbol: 'TEMP BTA', fullName: 'Temporary Instrument', currency: '' },
  ]);

  assertHealthyCore(result);
});

test('an empty optional Nordic slice remains a healthy control', async () => {
  assertHealthyCore(await runFixture([]));
});
