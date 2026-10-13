'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { fetchSzseUniverse } = require('../discovery/szse-cn.js');

function responseBody() {
  return [{
    metadata: { pagecount: 1, recordcount: 2 },
    data: [
      { agdm: '000001', agjc: '<a href="#"><u>Ping An Bank</u></a>' },
      { agdm: '000002', agjc: 'Plain Company' },
    ],
  }];
}

async function exerciseAdapter() {
  const calls = [];
  const originalGet = https.get;
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };

  https.get = (url, options, callback) => {
    calls.push({ url: String(url), options });

    const request = new EventEmitter();
    request.setTimeout = () => request;
    request.destroy = () => {};

    process.nextTick(() => {
      const response = new EventEmitter();
      response.statusCode = 200;
      response.headers = {};
      response.resume = () => {};
      callback(response);

      process.nextTick(() => {
        response.emit('data', Buffer.from(JSON.stringify(responseBody())));
        response.emit('end');
      });
    });

    return request;
  };
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};

  try {
    const result = await fetchSzseUniverse();
    return { result, calls };
  } finally {
    https.get = originalGet;
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  }
}

let fixture;

test.before(async () => {
  fixture = await exerciseAdapter();

  assert.equal(fixture.calls.length, 1);
  assert.match(fixture.calls[0].url, /[?&]PAGENO=1$/);
  assert.equal(fixture.calls[0].options.headers.Referer, 'https://www.szse.cn/');
});

test('SZSE wrapper markup is removed from issuer names', () => {
  assert.equal(fixture.result.get('000001.SZ')?.name, 'Ping An Bank');
});

test('plain SZSE names remain a healthy control', () => {
  assert.equal(fixture.result.get('000002.SZ')?.name, 'Plain Company');
  assert.equal(fixture.result.partial, undefined);
});
