#!/usr/bin/env node
/**
 * Hermetic contract tests for discovery/xetra.js.
 *
 * Xetra publishes one complete venue register. Transport, venue-identity, or
 * structural failures must therefore be visible through the discovery
 * consumer's `partial` marker, while a structurally valid zero stays healthy.
 */
'use strict';

const assert = require('assert/strict');
const https = require('https');
const { EventEmitter } = require('events');

const XETRA_URL =
  'https://www.cashmarket.deutsche-boerse.com/resource/blob/1528/' +
  'b2b41f36cd1ccdc2a05d180d6966b9fb/data/t7-xetr-allTradableInstruments.csv';
const REFERER = 'https://www.cashmarket.deutsche-boerse.com/';
const HEADER = 'Instrument;Mnemonic;Instrument Type;First Trading Date;ISIN';
const PREFIX = ['Market:;XETR', 'Date Last Update:;01.09.2026', HEADER];
const originalHttpsGet = https.get;
const originalHttpsRequest = https.request;
const originalFetch = global.fetch;
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
let unexpectedNetworkCalls = 0;

function networkBomb() {
  unexpectedNetworkCalls += 1;
  throw new Error('unexpected live HTTPS request');
}

function installNetworkBombs() {
  https.get = networkBomb;
  https.request = networkBomb;
  global.fetch = networkBomb;
}

function restoreNetwork() {
  https.get = originalHttpsGet;
  https.request = originalHttpsRequest;
  global.fetch = originalFetch;
}

// Import must remain side-effect free.
let fetchXetraUniverse;
try {
  installNetworkBombs();
  ({ fetchXetraUniverse } = require('../../discovery/xetra'));
  assert.equal(unexpectedNetworkCalls, 0, 'module import must not start a request');
} catch (error) {
  restoreNetwork();
  throw error;
}

function ownsPartial(map) {
  return Object.prototype.hasOwnProperty.call(map, 'partial');
}

function assertHealthy(map, expectedSize) {
  assert(map instanceof Map, 'healthy result must be a Map');
  assert.equal(map.size, expectedSize, 'unexpected healthy row count');
  assert.equal(ownsPartial(map), false, 'healthy result must not own partial');
}

function assertPartialEmpty(map) {
  assert(map instanceof Map, 'failure must still return a Map');
  assert.equal(map.size, 0, 'failed full-register fetch must not publish rows');
  assert.equal(ownsPartial(map), true, 'failure must own partial');
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

async function settleBeforeImmediate(promise, message) {
  let immediate;
  const deadline = new Promise((resolve, reject) => {
    immediate = setImmediate(() => reject(new Error(message)));
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearImmediate(immediate);
  }
}

async function fetchText(text) {
  let calls = 0;
  const captured = await captureConsole(() => fetchXetraUniverse({
    getFn: async url => {
      calls += 1;
      assert.equal(url, XETRA_URL, 'adapter must request the documented endpoint');
      return text;
    },
  }));
  assert.equal(calls, 1, 'injected transport must be called exactly once');
  return captured;
}

async function fetchRejected(message) {
  let calls = 0;
  const captured = await captureConsole(() => fetchXetraUniverse({
    getFn: async url => {
      calls += 1;
      assert.equal(url, XETRA_URL, 'adapter must request the documented endpoint');
      throw new Error(message);
    },
  }));
  assert.equal(calls, 1, 'rejected transport must be called exactly once');
  return captured;
}

function response(statusCode, headers, body, callback) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  res.headers = headers || {};
  res.resumeCalls = 0;
  res.resume = () => { res.resumeCalls += 1; };
  callback(res);
  if (body !== undefined) {
    res.emit('data', Buffer.from(body, 'utf8'));
    res.emit('end');
  }
  return res;
}

function requestStub() {
  const req = new EventEmitter();
  req.timeout = null;
  req.destroyCalls = 0;
  req.setTimeout = (ms, fn) => { req.timeout = { ms, fn }; return req; };
  req.destroy = () => { req.destroyCalls += 1; };
  return req;
}

function installHangingStub() {
  const calls = [];
  https.get = (url, options, callback) => {
    const req = requestStub();
    calls.push({ url, options, callback, req });
    return req;
  };
  return calls;
}

function installStatusStub(statusCode) {
  const calls = [];
  https.get = (url, options, callback) => {
    const req = requestStub();
    calls.push({ url, options, req });
    process.nextTick(() => {
      const res = response(statusCode, {}, undefined, callback);
      calls[calls.length - 1].res = res;
    });
    return req;
  };
  return calls;
}

function installRequestErrorStub(message) {
  const calls = [];
  https.get = (url, options, callback) => {
    const req = requestStub();
    calls.push({ url, options, callback, req });
    process.nextTick(() => req.emit('error', new Error(message)));
    return req;
  };
  return calls;
}

function installResponseErrorStub(message) {
  const calls = [];
  https.get = (url, options, callback) => {
    const req = requestStub();
    calls.push({ url, options, req });
    process.nextTick(() => {
      const res = response(200, {}, undefined, callback);
      calls[calls.length - 1].res = res;
      res.emit('error', new Error(message));
    });
    return req;
  };
  return calls;
}

function installRedirectStub(body, statusCode = 302) {
  const calls = [];
  https.get = (url, options, callback) => {
    const index = calls.length;
    const req = requestStub();
    calls.push({ url, options, req });
    process.nextTick(() => {
      if (index === 0) {
        const res = response(statusCode, { location: '/resource/blob/1528/current/data/current.csv' }, undefined, callback);
        calls[index].res = res;
      } else {
        calls[index].res = response(200, {}, body, callback);
      }
    });
    return req;
  };
  return calls;
}

function installRedirectFailureStub(location) {
  const calls = [];
  https.get = (url, options, callback) => {
    const index = calls.length;
    const req = requestStub();
    calls.push({ url, options, req });
    process.nextTick(() => {
      const headers = location === undefined ? {} : { location };
      const res = response(302, headers, undefined, callback);
      calls[index].res = res;
    });
    return req;
  };
  return calls;
}

let passed = 0;
let failed = 0;

async function test(name, fn) {
  let immediate;
  let failure;
  let didFail = false;
  const deadline = new Promise((resolve, reject) => {
    immediate = setImmediate(() => reject(new Error('test did not settle: ' + name)));
  });
  try {
    await Promise.race([Promise.resolve().then(fn), deadline]);
  } catch (error) {
    didFail = true;
    failure = error;
  } finally {
    clearImmediate(immediate);
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    installNetworkBombs();
  }
  if (didFail) {
    failed += 1;
    console.error('FAIL', name + ':', failure && failure.message);
  } else {
    passed += 1;
    console.log('PASS', name);
  }
}

(async () => {
  try {
    await test('valid XETR CSV maps, filters, and deduplicates without a live request', async () => {
      const csv = PREFIX.concat([
        'SAP SE;SAP;CS;1995-01-01;DE0007164600',
        '"ACME; Holdings";ACME;CS;2024-02-29;DE0000000002',
        'Index ETF;EXS1;ETF;;DE0005933931',
        'Duplicate must lose;SAP;CS;2020-01-01;DE0000000000',
        'Malformed mnemonic;BAD.SYM;CS;2020-01-01;DE0000000001',
      ]).join('\n');
      const { value: map } = await fetchText(csv);

      assertHealthy(map, 2);
      assert.deepEqual([...map.keys()], ['SAP.DE', 'ACME.DE']);
      assert.deepEqual(map.get('SAP.DE'), {
        ticker: 'SAP.DE',
        name: 'SAP SE',
        exchange: 'XETRA',
        source: 'xetra',
        country: 'Germany',
        ipoDate: '1995-01-01',
      });
      assert.equal(map.get('ACME.DE').name, 'ACME; Holdings');
      assert.equal('marketCap' in map.get('SAP.DE'), false);
    });

    await test('BOM, CRLF, and reordered headers preserve name-based parsing', async () => {
      const csv = [
        '\uFEFFMarket:;XETR',
        'Date Last Update:;01.09.2026',
        'Mnemonic;Instrument Type;ISIN;Instrument;First Trading Date',
        'SIE;CS;DE0007236101;Siemens AG;1847-10-01',
      ].join('\r\n');
      const { value: map } = await fetchText(csv);

      assertHealthy(map, 1);
      assert.equal(map.get('SIE.DE').name, 'Siemens AG');
      assert.equal(map.get('SIE.DE').ipoDate, '1847-10-01');
    });

    await test('optional IPO dates require a real calendar date without degrading the row', async () => {
      const csv = PREFIX.concat([
        'Leap Day AG;LEAP;CS;2024-02-29;DE0000000010',
        'Impossible Date AG;BADDT;CS;2026-02-31;DE0000000011',
        'No Date AG;NODT;CS;;DE0000000012',
      ]).join('\n');
      const { value: map } = await fetchText(csv);

      assertHealthy(map, 3);
      assert.equal(map.get('LEAP.DE').ipoDate, '2024-02-29');
      assert.equal('ipoDate' in map.get('BADDT.DE'), false);
      assert.equal('ipoDate' in map.get('NODT.DE'), false);
    });

    await test('wrong or missing venue identity becomes an owned empty partial result', async () => {
      const cases = [
        ['Market:;XFRA', 'Date Last Update:;01.09.2026', HEADER, 'SAP SE;SAP;CS;1995-01-01;X'].join('\n'),
        ['Date Last Update:;01.09.2026', HEADER, 'SAP SE;SAP;CS;1995-01-01;X'].join('\n'),
        '<html>access denied</html>',
      ];
      for (const text of cases) {
        const { value: map, logs } = await fetchText(text);
        assertPartialEmpty(map);
        assert.equal(logs.some(line => line.includes('Total listed Xetra shares')), false,
          'identity failure must not emit a healthy completion log');
      }
    });

    await test('required-header loss becomes an owned empty partial result', async () => {
      const cases = [
        ['Market:;XETR', 'Date Last Update:;01.09.2026', 'Instrument;Instrument Type;ISIN'].join('\n'),
        ['Market:;XETR', 'Date Last Update:;01.09.2026', 'Mnemonic;Instrument Type;ISIN'].join('\n'),
        ['Market:;XETR', 'Date Last Update:;01.09.2026', 'Instrument;Mnemonic;ISIN'].join('\n'),
      ];
      for (const text of cases) {
        const { value: map } = await fetchText(text);
        assertPartialEmpty(map);
      }
    });

    await test('missing or malformed update metadata becomes an owned empty partial result', async () => {
      const cases = [
        ['Market:;XETR', 'Updated:;01.09.2026', HEADER, 'SAP SE;SAP;CS;1995-01-01;X'].join('\n'),
        ['Market:;XETR', 'Date Last Update:;31.02.2026', HEADER, 'SAP SE;SAP;CS;1995-01-01;X'].join('\n'),
        ['Market:;XETR', 'Date Last Update:;', HEADER, 'SAP SE;SAP;CS;1995-01-01;X'].join('\n'),
      ];
      for (const text of cases) {
        const { value: map } = await fetchText(text);
        assertPartialEmpty(map);
      }
    });

    await test('a wrong-width row fails before filtering and never leaks a valid prefix', async () => {
      for (const tail of [
        'Siemens AG;SIE;CS',
        'Index ETF;EXS1;ETF',
        'Siemens AG;SIE;CS;1995-01-01;DE0007236101;unexpected',
      ]) {
        const csv = PREFIX.concat([
          'SAP SE;SAP;CS;1995-01-01;DE0007164600',
          tail,
        ]).join('\r\n');
        const { value: map } = await fetchText(csv);

        assertPartialEmpty(map);
        assert.equal(map.has('SAP.DE'), false, 'a valid prefix must not escape after a later bad row');
      }
    });

    await test('transport rejection becomes an owned empty partial result', async () => {
      const { value: map, errors } = await fetchRejected('socket closed');
      assertPartialEmpty(map);
      assert.match(errors.join('\n'), /socket closed/);
    });

    await test('a structurally valid header-only register is healthy and count-free', async () => {
      const { value: map } = await fetchText(PREFIX.join('\n'));
      assertHealthy(map, 0);
    });

    await test('valid rows that are all filtered remain healthy and count-free', async () => {
      const csv = PREFIX.concat([
        'Index ETF;EXS1;ETF;;DE0005933931',
        'Malformed mnemonic;BAD.SYM;CS;;DE0000000001',
      ]).join('\n');
      const { value: map } = await fetchText(csv);
      assertHealthy(map, 0);
    });

    await test('injected scenarios never touch the default HTTPS transport', () => {
      assert.equal(unexpectedNetworkCalls, 0, 'injected transport was bypassed');
    });

    await test('the no-argument path reports HTTP failure through partial', async () => {
      const calls = installStatusStub(503);
      try {
        const { value: map } = await captureConsole(() => fetchXetraUniverse());
        assertPartialEmpty(map);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, XETRA_URL);
        assert.equal(calls[0].options.headers.Referer, REFERER);
        assert.match(calls[0].options.headers.Accept, /text\/csv/);
        assert.match(calls[0].options.headers['User-Agent'], /Mozilla\/5\.0/);
        assert.equal(calls[0].req.timeout.ms, 30000);
        assert.equal(calls[0].res.resumeCalls, 1, 'non-200 response body must be drained');
      } finally {
        https.get = networkBomb;
      }
    });

    await test('the no-argument timeout destroys the request and reports partial', async () => {
      const calls = installHangingStub();
      const oldError = console.error;
      const errors = [];
      console.error = (...args) => errors.push(args.join(' '));
      try {
        const pending = fetchXetraUniverse();
        assert.equal(calls.length, 1);
        assert.equal(calls[0].req.timeout.ms, 30000);
        calls[0].req.timeout.fn();
        assert.equal(calls[0].req.destroyCalls, 1, 'timeout must destroy the stalled request once');
        const map = await settleBeforeImmediate(
          pending,
          'timeout callback did not settle the Xetra request',
        );
        assertPartialEmpty(map);
        assert.match(errors.join('\n'), /timeout/i);
      } finally {
        console.error = oldError;
        https.get = networkBomb;
      }
    });

    await test('native request and response errors settle as owned empty partial results', async () => {
      for (const [install, message] of [
        [installRequestErrorStub, 'request socket closed'],
        [installResponseErrorStub, 'response socket closed'],
      ]) {
        const calls = install(message);
        try {
          const captured = await settleBeforeImmediate(
            captureConsole(() => fetchXetraUniverse()),
            message + ' did not settle the Xetra request',
          );
          assertPartialEmpty(captured.value);
          assert.match(captured.errors.join('\n'), /socket closed/);
          assert.equal(calls.length, 1);
          assert.equal(calls[0].req.timeout.ms, 30000);
        } finally {
          https.get = networkBomb;
        }
      }
    });

    await test('all documented redirect statuses reach healthy XETR CSV', async () => {
      const body = PREFIX.concat(['SAP SE;SAP;CS;1995-01-01;DE0007164600']).join('\n');
      for (const statusCode of [301, 302, 307, 308]) {
        const calls = installRedirectStub(body, statusCode);
        try {
          const { value: map } = await captureConsole(() => fetchXetraUniverse());
          assertHealthy(map, 1);
          assert(map.has('SAP.DE'));
          assert.deepEqual(calls.map(call => call.url), [
            XETRA_URL,
            'https://www.cashmarket.deutsche-boerse.com/resource/blob/1528/current/data/current.csv',
          ]);
          assert(calls.every(call => call.options.headers.Referer === REFERER));
          assert(calls.every(call => call.req.timeout.ms === 30000));
          assert.equal(calls[0].res.resumeCalls, 1, 'redirect response body must be drained');
        } finally {
          https.get = networkBomb;
        }
      }
    });

    await test('missing, invalid, or excessive redirects fail closed through partial', async () => {
      for (const location of [undefined, 'http://[invalid']) {
        const calls = installRedirectFailureStub(location);
        try {
          const { value: map } = await captureConsole(() => fetchXetraUniverse());
          assertPartialEmpty(map);
          assert.equal(calls.length, 1);
          assert.equal(calls[0].res.resumeCalls, 1);
        } finally {
          https.get = networkBomb;
        }
      }

      const loopCalls = installRedirectFailureStub('/loop');
      try {
        const { value: map } = await captureConsole(() => fetchXetraUniverse());
        assertPartialEmpty(map);
        assert.equal(loopCalls.length, 6, 'MAX_REDIRECTS must stop the sixth redirect response');
        assert(loopCalls.every(call => call.req.timeout.ms === 30000));
        assert(loopCalls.every(call => call.res.resumeCalls === 1));
      } finally {
        https.get = networkBomb;
      }
    });

  } finally {
    restoreNetwork();
  }

  console.log(`xetra hermetic tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
})().catch(error => {
  restoreNetwork();
  console.error('FAIL xetra harness:', error && error.stack || error);
  process.exitCode = 1;
});
