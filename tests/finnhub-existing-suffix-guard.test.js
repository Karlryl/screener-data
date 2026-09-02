'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const test = require('node:test');
const { fetchFinnhubUniverse } = require('../discovery/finnhub.js');

async function runFixture() {
  const originalGet = https.get;
  const originalSetTimeout = global.setTimeout;
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const hadToken = Object.prototype.hasOwnProperty.call(process.env, 'FINNHUB_API_KEY');
  const originalToken = process.env.FINNHUB_API_KEY;

  try {
    process.env.FINNHUB_API_KEY = 'fixture-token';
    console.log = () => {};
    console.warn = () => {};
    console.error = () => {};
    global.setTimeout = (fn) => {
      queueMicrotask(fn);
      return 0;
    };

    https.get = (url, _options, onResponse) => {
      const exchange = new URL(url).searchParams.get('exchange');

      const req = new EventEmitter();
      req.setTimeout = () => req;
      req.destroy = () => req;

      queueMicrotask(() => {
        const res = new EventEmitter();
        res.statusCode = 200;
        res.headers = {};
        res.resume = () => {};
        onResponse(res);

        const rows = exchange === 'L' ? [
          {
            symbol: 'BP',
            displaySymbol: 'BP.L',
            type: 'Common Stock',
            description: 'BP PLC',
          },
          {
            symbol: 'VOD',
            displaySymbol: 'VOD',
            type: 'Common Stock',
            description: 'Vodafone Group',
          },
        ] : [];
        res.emit('data', Buffer.from(JSON.stringify(rows)));
        res.emit('end');
      });
      return req;
    };

    const map = await fetchFinnhubUniverse();
    return map;
  } finally {
    https.get = originalGet;
    global.setTimeout = originalSetTimeout;
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    if (hadToken) process.env.FINNHUB_API_KEY = originalToken;
    else delete process.env.FINNHUB_API_KEY;
  }
}

let fixture;
test.before(async () => {
  fixture = await runFixture();
});

test('already qualified Finnhub symbol is not suffixed twice', () => {
  assert.equal(fixture.has('BP.L'), true);
  assert.equal(fixture.has('BP.L.L'), false);
  assert.equal(fixture.get('BP.L').exchange, 'L');
});

test('ordinary suffixing remains healthy alongside empty exchanges', () => {
  assert.equal(fixture.has('VOD.L'), true);
  assert.equal(fixture.size, 2);
  assert.equal(fixture.partial, undefined);
});
