'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const { fetchSecTickers } = require('../discovery/sec-tickers.js');

async function fetchFrom(entry) {
  const originalGet = https.get;
  const originalLog = console.log;
  const originalError = console.error;
  const body = JSON.stringify({ 0: entry });

  https.get = (_url, _options, onResponse) => {
    const request = new EventEmitter();
    request.setTimeout = () => request;
    request.destroy = () => {};

    const response = new EventEmitter();
    response.statusCode = 200;
    response.headers = {};
    response.resume = () => {};
    onResponse(response);
    process.nextTick(() => {
      response.emit('data', Buffer.from(body));
      response.emit('end');
    });
    return request;
  };
  console.log = () => {};
  console.error = () => {};

  try {
    return await fetchSecTickers();
  } finally {
    https.get = originalGet;
    console.log = originalLog;
    console.error = originalError;
  }
}

test('an SEC row with no CIK retains explicit missing metadata', async () => {
  const result = await fetchFrom({ ticker: 'NEWCO', title: 'New Co' });

  assert.deepEqual([...result.keys()], ['NEWCO']);
  assert.equal(Object.hasOwn(result.get('NEWCO'), 'cik'), true);
  assert.equal(result.get('NEWCO').cik, null);
});

test('a present numeric SEC CIK remains zero-padded normally', async () => {
  const result = await fetchFrom({ ticker: 'AAPL', title: 'Apple Inc.', cik_str: 320193 });

  assert.equal(result.get('AAPL').cik, '0000320193');
});
