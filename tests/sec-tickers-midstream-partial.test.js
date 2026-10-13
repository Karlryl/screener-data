'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const test = require('node:test');

const { fetchSecTickers } = require('../discovery/sec-tickers.js');

function row(ticker, title, cik) {
  return { ticker, title, cik_str: cik };
}

async function fetchFrom(entries) {
  const originalGet = https.get;
  const body = JSON.stringify(entries);

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

  try {
    return await fetchSecTickers();
  } finally {
    https.get = originalGet;
  }
}

test('SEC marks only a nonempty mid-stream failure as partial', async () => {
  const partial = await fetchFrom({
    0: row('AAPL', 'Apple Inc.', 320193),
    1: null,
    2: row('MSFT', 'Microsoft Corp.', 789019),
  });
  assert.deepEqual([...partial.keys()], ['AAPL']);
  assert.equal(partial.has('MSFT'), false);
  assert.equal(partial.partial, true);

  const totalFailure = await fetchFrom({
    0: null,
    1: row('MSFT', 'Microsoft Corp.', 789019),
  });
  assert.equal(totalFailure.size, 0);
  assert.equal(totalFailure.partial, undefined);

  const healthy = await fetchFrom({
    0: row('AAPL', 'Apple Inc.', 320193),
    1: row('MSFT', 'Microsoft Corp.', 789019),
  });
  assert.deepEqual([...healthy.keys()], ['AAPL', 'MSFT']);
  assert.equal(healthy.partial, undefined);
});
