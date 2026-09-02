#!/usr/bin/env node
/**
 * Hermetic contract tests for discovery/nse-in.js.
 *
 * NSE publishes one complete equity register. A transport or schema failure
 * must therefore be visible through the discovery consumer's `partial` marker,
 * while a structurally valid header with zero accepted rows stays healthy.
 */
'use strict';

const assert = require('assert/strict');
const https = require('https');
const { EventEmitter } = require('events');

const EQUITY_URL = 'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv';
const REFERER = 'https://www.nseindia.com/';
const HEADER = 'SYMBOL,NAME OF COMPANY,SERIES,DATE OF LISTING,PAID UP VALUE,MARKET LOT,ISIN NUMBER,FACE VALUE';
const originalHttpsGet = https.get;
let unexpectedNetworkCalls = 0;

function networkBomb() {
  unexpectedNetworkCalls += 1;
  throw new Error('unexpected live HTTPS request');
}

// Import must remain side-effect free.
https.get = networkBomb;
const { fetchNseIndia, parseEquityCsv } = require('../../discovery/nse-in');
assert.equal(unexpectedNetworkCalls, 0, 'module import must not start a request');

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
  const captured = await captureConsole(() => fetchNseIndia({
    getFn: async url => {
      calls += 1;
      assert.equal(url, EQUITY_URL, 'adapter must request the documented endpoint');
      return text;
    },
  }));
  assert.equal(calls, 1, 'injected transport must be called exactly once');
  return captured;
}

async function fetchRejected(message) {
  let calls = 0;
  const captured = await captureConsole(() => fetchNseIndia({
    getFn: async url => {
      calls += 1;
      assert.equal(url, EQUITY_URL, 'adapter must request the documented endpoint');
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

function installRedirectStub(body) {
  const calls = [];
  https.get = (url, options, callback) => {
    const index = calls.length;
    const req = requestStub();
    calls.push({ url, options, req });
    process.nextTick(() => {
      if (index === 0) {
        const res = response(302, { location: '/content/equities/current.csv' }, undefined, callback);
        calls[index].res = res;
      } else {
        calls[index].res = response(200, {}, body, callback);
      }
    });
    return req;
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
    await test('valid CSV maps, filters, quotes, and deduplicates without a live request', async () => {
      const csv = [
        HEADER,
        'RELIANCE,Reliance Industries,EQ,1995-01-01,10,1,INE002A01018,10',
        'M&M,"Mahindra & Mahindra, Limited",EQ,1996-01-01,5,1,INE101A01026,5',
        'RELIANCE,Duplicate must lose,EQ,1995-01-01,10,1,INE002A01018,10',
        'BAD.SYM,Malformed symbol,EQ,2026-01-01,1,1,INE000000000,1',
      ].join('\n');
      const { value: map } = await fetchText(csv);

      assertHealthy(map, 2);
      assert.deepEqual([...map.keys()], ['RELIANCE.NS', 'M&M.NS']);
      assert.deepEqual(map.get('RELIANCE.NS'), {
        ticker: 'RELIANCE.NS',
        name: 'Reliance Industries',
        exchange: 'NSE',
        source: 'nse-in',
        country: 'India',
      });
      assert.equal(map.get('M&M.NS').name, 'Mahindra & Mahindra, Limited');
    });

    await test('BOM, CRLF, reordered headers, and escaped quotes preserve name-based parsing', async () => {
      const csv = [
        '\uFEFFNAME OF COMPANY,SYMBOL,FACE VALUE,SERIES',
        '"Mahindra ""Auto"" & Mahindra",M&M,5,EQ',
      ].join('\r\n');
      const { value: map } = await fetchText(csv);

      assertHealthy(map, 1);
      assert.equal(map.get('M&M.NS').name, 'Mahindra "Auto" & Mahindra');
    });

    await test('parser rejects payloads without both required headers', () => {
      const cases = [
        '',
        '<html>access denied</html>',
        'SYMBOL,SERIES\nRELIANCE,EQ',
        'NAME OF COMPANY,SERIES\nReliance Industries,EQ',
      ];
      for (const text of cases) {
        assert.throws(() => parseEquityCsv(text), /required NSE headers/i);
      }
    });

    await test('HTTP-200 schema drift becomes an owned empty partial result', async () => {
      const cases = [
        '<html>access denied</html>',
        'SYMBOL,SERIES\nRELIANCE,EQ',
        '',
      ];
      for (const text of cases) {
        const { value: map, logs } = await fetchText(text);
        assertPartialEmpty(map);
        assert.equal(logs.some(line => line.includes('Total listed NSE stocks')), false,
          'schema failure must not emit a healthy completion log');
      }
    });

    await test('truncated or unterminated rows fail all-or-nothing without leaking a prefix', async () => {
      const cases = [
        [
          HEADER,
          'TCS,Tata Consultancy Services,EQ,2004-01-01,1,1,X,1',
          'RELIANCE',
          'M&M,Mahindra & Mahindra,EQ,1996-01-01,5,1,Y,5',
        ].join('\r\n'),
        HEADER + '\r\nRELIANCE,"unterminated company name,EQ,1995-01-01,10,1,X,10',
      ];
      for (const text of cases) {
        const { value: map } = await fetchText(text);
        assertPartialEmpty(map);
        assert.equal(map.has('TCS.NS'), false, 'a valid prefix must not escape after a later bad row');
      }
    });

    await test('transport rejection becomes an owned empty partial result', async () => {
      const { value: map, errors } = await fetchRejected('socket closed');
      assertPartialEmpty(map);
      assert.match(errors.join('\n'), /socket closed/);
    });

    await test('a valid header with zero rows is healthy and count-free', async () => {
      const { value: map } = await fetchText(HEADER + '\n');
      assertHealthy(map, 0);
    });

    await test('valid rows that are all filtered remain healthy and count-free', async () => {
      const { value: map } = await fetchText(HEADER + '\nBAD.SYM,Malformed,EQ,2026-01-01,1,1,X,1\n');
      assertHealthy(map, 0);
    });

    await test('injected scenarios never touch the default HTTPS transport', () => {
      assert.equal(unexpectedNetworkCalls, 0, 'injected transport was bypassed');
    });

    await test('the no-argument path reports HTTP failure through partial', async () => {
      const calls = installStatusStub(503);
      try {
        const { value: map } = await captureConsole(() => fetchNseIndia());
        assertPartialEmpty(map);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, EQUITY_URL);
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
        const pending = fetchNseIndia();
        assert.equal(calls.length, 1);
        assert.equal(calls[0].req.timeout.ms, 30000);
        calls[0].req.timeout.fn();
        assert.equal(calls[0].req.destroyCalls, 1, 'timeout must destroy the stalled request once');
        const map = await settleBeforeImmediate(
          pending,
          'timeout callback did not settle the NSE request',
        );
        assertPartialEmpty(map);
        assert.match(errors.join('\n'), /timeout/i);
      } finally {
        console.error = oldError;
        https.get = networkBomb;
      }
    });

    await test('the no-argument path follows a relative redirect to healthy CSV', async () => {
      const calls = installRedirectStub(HEADER + '\nRELIANCE,Reliance Industries,EQ,1995-01-01,10,1,X,10\n');
      try {
        const { value: map } = await captureConsole(() => fetchNseIndia());
        assertHealthy(map, 1);
        assert(map.has('RELIANCE.NS'));
        assert.deepEqual(calls.map(call => call.url), [
          EQUITY_URL,
          'https://nsearchives.nseindia.com/content/equities/current.csv',
        ]);
        assert(calls.every(call => call.options.headers.Referer === REFERER));
        assert.equal(calls[0].res.resumeCalls, 1, 'redirect response body must be drained');
      } finally {
        https.get = networkBomb;
      }
    });

    if (process.env.NSE_LIVE_TEST === '1') {
      await test('optional live smoke', async () => {
        https.get = originalHttpsGet;
        try {
          const { value: map } = await captureConsole(() => fetchNseIndia());
          assertHealthy(map, map.size);
          assert(map.size > 0, 'live register must contain at least one row');
        } finally {
          https.get = networkBomb;
        }
      });
    }
  } finally {
    https.get = originalHttpsGet;
  }

  console.log(`nse-in hermetic tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
})().catch(error => {
  https.get = originalHttpsGet;
  console.error('FAIL nse-in harness:', error && error.stack || error);
  process.exitCode = 1;
});
