'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');

require('./helpers/offline-network-guard');
const { fetchSseUniverse } = require('../discovery/sse-cn.js');

const ROWS = [
  {
    A_STOCK_CODE: '600001',
    FULL_NAME_IN_ENGLISH: 'Dated Company',
    LIST_DATE: '20240102',
    DELIST_DATE: '-',
  },
  {
    A_STOCK_CODE: '600002',
    FULL_NAME_IN_ENGLISH: 'Undated Company',
    DELIST_DATE: '-',
  },
];

function fixtureGet(url, options, callback) {
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
      response.emit('data', Buffer.from(JSON.stringify({
        result: ROWS,
        pageHelp: { data: ROWS, total: ROWS.length },
      })));
      response.emit('end');
    });
  });

  return request;
}

let result;

test.before(async () => {
  const blockedGet = https.get;
  https.get = fixtureGet;
  try {
    result = await fetchSseUniverse();
  } finally {
    https.get = blockedGet;
  }
});

test('an eight-digit SSE listing date is normalized', () => {
  assert.equal(result.get('600001.SS').ipoDate, '2024-01-02');
});

test('a missing SSE listing date remains absent without dropping the ticker', () => {
  const info = result.get('600002.SS');

  assert.ok(info);
  assert.equal(Object.prototype.hasOwnProperty.call(info, 'ipoDate'), false);
});
