#!/usr/bin/env node
/**
 * Hermetic contract tests for discovery/finmind-tw.js.
 *
 * The FinMind TaiwanStockInfo endpoint reports provider failures in the JSON
 * body even when HTTP itself succeeds. These tests therefore cover the body
 * status and the partial-result marker without making a live network request.
 */
'use strict';

const assert = require('assert/strict');
const https = require('https');
const { EventEmitter } = require('events');

const API_URL = 'https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInfo';
const originalHttpsGet = https.get;
let unexpectedNetworkCalls = 0;

function networkBomb() {
  unexpectedNetworkCalls += 1;
  throw new Error('unexpected live HTTPS request');
}

// Prove that importing the adapter remains side-effect free.
https.get = networkBomb;
const { fetchTaiwanUniverse } = require('../../discovery/finmind-tw');
assert.equal(unexpectedNetworkCalls, 0, 'module import must not start a request');

function ownsPartial(map) {
  return Object.prototype.hasOwnProperty.call(map, 'partial');
}

function assertHealthy(map, expectedSize) {
  assert(map instanceof Map, 'must return a Map');
  assert.equal(map.size, expectedSize, 'unexpected healthy row count');
  assert.equal(ownsPartial(map), false, 'healthy result must not own partial');
}

function assertPartialEmpty(map) {
  assert(map instanceof Map, 'failure must still return a Map');
  assert.equal(map.size, 0, 'partial result must not publish rows');
  assert.equal(ownsPartial(map), true, 'failure must own a partial marker');
  assert.equal(map.partial, true, 'partial marker must be true');
}

async function captureConsole(fn) {
  const oldLog = console.log;
  const oldError = console.error;
  const logs = [];
  const errors = [];
  console.log = (...args) => logs.push(args.join(' '));
  console.error = (...args) => errors.push(args.join(' '));
  try {
    return { value: await fn(), logs, errors };
  } finally {
    console.log = oldLog;
    console.error = oldError;
  }
}

async function fetchBody(body) {
  let calls = 0;
  const captured = await captureConsole(() => fetchTaiwanUniverse({
    getFn: async url => {
      calls += 1;
      assert.equal(url, API_URL, 'adapter must request the documented endpoint');
      return body;
    },
  }));
  assert.equal(calls, 1, 'injected transport must be called exactly once');
  return captured;
}

function fetchJson(payload) {
  return fetchBody(JSON.stringify(payload));
}

async function fetchRejected(message) {
  let calls = 0;
  const captured = await captureConsole(() => fetchTaiwanUniverse({
    getFn: async url => {
      calls += 1;
      assert.equal(url, API_URL, 'adapter must request the documented endpoint');
      throw new Error(message);
    },
  }));
  assert.equal(calls, 1, 'rejected transport must be called exactly once');
  return captured;
}

function installDefaultTransportStub(payload) {
  const calls = [];
  https.get = (url, options, callback) => {
    calls.push({ url, options });
    const request = new EventEmitter();
    request.setTimeout = () => request;
    request.destroy = () => {};

    process.nextTick(() => {
      const response = new EventEmitter();
      response.statusCode = 200;
      response.headers = {};
      response.resume = () => {};
      callback(response);
      response.emit('data', Buffer.from(JSON.stringify(payload), 'utf8'));
      response.emit('end');
    });
    return request;
  };
  return calls;
}

function installRedirectTransportStub(payload) {
  const calls = [];
  https.get = (url, options, callback) => {
    const callIndex = calls.length;
    calls.push({ url, options });
    const request = new EventEmitter();
    request.setTimeout = () => request;
    request.destroy = () => {};

    process.nextTick(() => {
      const response = new EventEmitter();
      response.statusCode = callIndex === 0 ? 302 : 200;
      response.headers = callIndex === 0 ? { location: '/api/v4/redirected' } : {};
      response.resume = () => {};
      callback(response);
      if (callIndex === 1) {
        response.emit('data', Buffer.from(JSON.stringify(payload), 'utf8'));
        response.emit('end');
      }
    });
    return request;
  };
  return calls;
}

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log('PASS', name);
  } catch (error) {
    failed += 1;
    console.error('FAIL', name + ':', error && error.message);
  }
}

(async () => {
  try {
    await test('numeric status 200 filters and maps the full register', async () => {
      const { value: map } = await fetchJson({
        status: 200,
        msg: 'success',
        data: [
          { stock_id: '2330', stock_name: ' TSMC ', type: 'twse', industry_category: 'Semiconductor' },
          { stock_id: '6488', stock_name: 'GlobalWafers', type: 'tpex', industry_category: 'Semiconductor' },
          { stock_id: '2330', stock_name: 'duplicate', type: 'twse', industry_category: 'Semiconductor' },
          { stock_id: '0050', stock_name: 'ETF', type: 'twse', industry_category: 'ETF' },
          { stock_id: '12345', stock_name: 'five digits', type: 'twse', industry_category: 'Other' },
          { stock_id: '7777', stock_name: 'emerging', type: 'emerging', industry_category: 'Other' },
          { stock_id: '8888', stock_name: 'unknown', type: 'unknown', industry_category: 'Other' },
        ],
      });

      assertHealthy(map, 2);
      assert.deepEqual([...map.keys()], ['2330.TW', '6488.TWO']);
      assert.deepEqual(map.get('2330.TW'), {
        ticker: '2330.TW',
        name: 'TSMC',
        exchange: 'TWSE',
        source: 'finmind-tw',
        country: 'Taiwan',
      });
      assert.equal(map.get('6488.TWO').exchange, 'TPEx');
    });

    await test('canonical string status 200 is accepted', async () => {
      const { value: map } = await fetchJson({
        status: '200',
        data: [{ stock_id: '2330', stock_name: 'TSMC', type: 'twse', industry_category: 'Semiconductor' }],
      });
      assertHealthy(map, 1);
      assert(map.has('2330.TW'));
    });

    await test('exactly one accepted stock is a healthy result', async () => {
      const { value: map } = await fetchJson({
        status: 200,
        data: [{ stock_id: '6488', stock_name: 'GlobalWafers', type: 'tpex', industry_category: 'Semiconductor' }],
      });
      assertHealthy(map, 1);
      assert(map.has('6488.TWO'));
    });

    await test('empty successful register remains a healthy empty result', async () => {
      const { value: map } = await fetchJson({ status: 200, data: [] });
      assertHealthy(map, 0);
    });

    await test('fully filtered successful register remains healthy', async () => {
      const { value: map } = await fetchJson({
        status: 200,
        data: [
          { stock_id: '0050', stock_name: 'ETF', type: 'twse', industry_category: 'ETF' },
          { stock_id: '7777', stock_name: 'Emerging', type: 'emerging', industry_category: 'Other' },
        ],
      });
      assertHealthy(map, 0);
    });

    await test('provider failure statuses are partial and never publish data', async () => {
      const cases = [
        { label: 'quota', payload: { status: 402, msg: 'quota exceeded', data: [] } },
        {
          label: 'quota-with-plausible-data',
          payload: {
            status: 402,
            msg: 'quota exceeded',
            data: [{ stock_id: '2330', stock_name: 'must not leak', type: 'twse', industry_category: 'Semiconductor' }],
          },
        },
        { label: 'other numeric', payload: { status: 201, msg: 'not ready', data: [] } },
        { label: 'missing', payload: { msg: 'missing status', data: [] } },
        { label: 'null', payload: { status: null, data: [] } },
        { label: 'whitespace string', payload: { status: ' 200 ', data: [] } },
        { label: 'padded string', payload: { status: '0200', data: [] } },
      ];

      for (const { label, payload } of cases) {
        const { value: map, logs } = await fetchJson(payload);
        assertPartialEmpty(map);
        assert.equal(logs.some(line => line.includes('common stocks')), false,
          label + ' must not emit a healthy completion log');
      }
    });

    await test('provider status and message are visible in diagnostics', async () => {
      const { value: map, errors } = await fetchJson({ status: 402, msg: 'quota exceeded', data: [] });
      assertPartialEmpty(map);
      const diagnostic = errors.join('\n');
      assert.match(diagnostic, /status 402/i);
      assert.match(diagnostic, /quota exceeded/i);
    });

    await test('wrong data shapes are partial', async () => {
      const cases = [
        { status: 200 },
        { status: 200, data: null },
        { status: 200, data: {} },
        { status: 200, data: 'not-an-array' },
      ];
      for (const payload of cases) {
        const { value: map } = await fetchJson(payload);
        assertPartialEmpty(map);
      }
    });

    await test('malformed JSON is partial', async () => {
      const { value: map } = await fetchBody('{not-json');
      assertPartialEmpty(map);
    });

    await test('transport rejection is partial', async () => {
      const { value: map, errors } = await fetchRejected('socket closed');
      assertPartialEmpty(map);
      assert.match(errors.join('\n'), /socket closed/);
    });

    await test('row-processing failure discards the parsed prefix', async () => {
      const { value: map } = await fetchJson({
        status: 200,
        data: [
          { stock_id: '2330', stock_name: 'TSMC', type: 'twse', industry_category: 'Semiconductor' },
          { stock_id: '1111', stock_name: 42, type: 'twse', industry_category: 'Other' },
        ],
      });
      assertPartialEmpty(map);
      assert.equal(map.has('2330.TW'), false, 'a parsed prefix must not escape after a row failure');
    });

    await test('all injected scenarios remain offline', async () => {
      assert.equal(unexpectedNetworkCalls, 0, 'injected transport was bypassed');
    });

    await test('default transport path still uses https.get', async () => {
      const calls = installDefaultTransportStub({
        status: 200,
        data: [{ stock_id: '2330', stock_name: 'TSMC', type: 'twse', industry_category: 'Semiconductor' }],
      });
      try {
        const { value: map } = await captureConsole(() => fetchTaiwanUniverse());
        assertHealthy(map, 1);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, API_URL);
        assert.equal(calls[0].options.headers.Accept, 'application/json');
      } finally {
        https.get = networkBomb;
      }
    });

    await test('default transport follows a relative HTTP redirect', async () => {
      const calls = installRedirectTransportStub({
        status: 200,
        data: [{ stock_id: '6488', stock_name: 'GlobalWafers', type: 'tpex', industry_category: 'Semiconductor' }],
      });
      try {
        const { value: map } = await captureConsole(() => fetchTaiwanUniverse());
        assertHealthy(map, 1);
        assert(map.has('6488.TWO'));
        assert.deepEqual(calls.map(call => call.url), [
          API_URL,
          'https://api.finmindtrade.com/api/v4/redirected',
        ]);
        assert(calls.every(call => call.options.headers.Accept === 'application/json'));
      } finally {
        https.get = networkBomb;
      }
    });
  } finally {
    https.get = originalHttpsGet;
  }

  console.log(`finmind-tw hermetic tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
})().catch(error => {
  https.get = originalHttpsGet;
  console.error('FAIL finmind-tw harness:', error && error.stack || error);
  process.exitCode = 1;
});
