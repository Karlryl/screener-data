'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const test = require('node:test');
const { fetchSecTickers } = require('../discovery/sec-tickers.js');

const SEC_URL = 'https://www.sec.gov/files/company_tickers.json';
const TARGET_URL = 'https://www.sec.gov/files/company_tickers-current.json';
const BODY = JSON.stringify({
  0: { ticker: 'AAPL', title: 'Apple Inc.', cik_str: 320193 },
});

async function runRedirect(location) {
  const originalGet = https.get;
  const calls = [];

  try {
    https.get = (url, _options, onResponse) => {
      calls.push(url);
      const kind = url === SEC_URL ? 'redirect' : url === TARGET_URL ? 'body' : null;
      if (!kind) throw new Error('unexpected SEC URL: ' + url);

      const request = new EventEmitter();
      request.setTimeout = () => request;
      request.destroy = () => {};

      queueMicrotask(() => {
        const response = new EventEmitter();
        response.statusCode = kind === 'redirect' ? 302 : 200;
        response.headers = kind === 'redirect' ? { location } : {};
        response.resume = () => {};
        onResponse(response);

        if (kind === 'body') {
          response.emit('data', Buffer.from(BODY));
          response.emit('end');
        }
      });
      return request;
    };

    const map = await fetchSecTickers();
    return { map, calls };
  } finally {
    https.get = originalGet;
  }
}

function assertSuccessfulRedirect(fixture) {
  assert.deepEqual(fixture.calls, [SEC_URL, TARGET_URL]);
  assert.deepEqual([...fixture.map.keys()], ['AAPL']);
}

let relative;
let absolute;
test.before(async () => {
  relative = await runRedirect('/files/company_tickers-current.json');
  absolute = await runRedirect(TARGET_URL);
});

test('relative SEC redirect is resolved against the requested URL', () => {
  assertSuccessfulRedirect(relative);
});

test('already absolute SEC redirect remains supported', () => {
  assertSuccessfulRedirect(absolute);
});
