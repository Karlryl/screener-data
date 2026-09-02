'use strict';
/**
 * Finnhub slice integrity: a nonempty Map is not proof that all requested
 * exchanges were delivered. The adapter must retain healthy slices and stamp
 * Map.partial when one slice is unusable after its normal retry policy.
 *
 * Standalone: node tests/finnhub-partial.test.js
 */
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const { fetchFinnhubUniverse } = require('../discovery/finnhub.js');

const checks = [];
function check(name, fn) { checks.push([name, fn]); }

function validSlice(exchange) {
  return [{
    symbol: 'X' + exchange,
    displaySymbol: 'X' + exchange,
    type: 'Common Stock',
    description: 'Company ' + exchange,
  }];
}

async function runWithFakeFinnhub(responder, opts = {}) {
  const originalGet = https.get;
  const originalSetTimeout = global.setTimeout;
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const hadToken = Object.prototype.hasOwnProperty.call(process.env, 'FINNHUB_API_KEY');
  const originalToken = process.env.FINNHUB_API_KEY;
  const calls = [];
  const attempts = new Map();
  const delays = [];
  const messages = [];

  try {
    if (opts.withToken === false) delete process.env.FINNHUB_API_KEY;
    else process.env.FINNHUB_API_KEY = 'fixture-token';

    console.log = (...args) => messages.push(args.join(' '));
    console.warn = (...args) => messages.push(args.join(' '));
    console.error = (...args) => messages.push(args.join(' '));
    global.setTimeout = (fn, delay) => {
      delays.push(delay);
      queueMicrotask(fn);
      return 0;
    };

    https.get = (url, requestOpts, onResponse) => {
      assert.equal(requestOpts.headers.Accept, 'application/json');
      const exchange = new URL(url).searchParams.get('exchange');
      const attempt = (attempts.get(exchange) || 0) + 1;
      attempts.set(exchange, attempt);
      calls.push(exchange);

      const req = new EventEmitter();
      req.setTimeout = () => req;
      req.destroy = () => req;

      queueMicrotask(() => {
        try {
          const spec = responder(exchange, attempt);
          if (spec && spec.error) {
            req.emit('error', spec.error);
            return;
          }
          const status = spec && spec.status != null ? spec.status : 200;
          const res = new EventEmitter();
          res.statusCode = status;
          res.headers = (spec && spec.headers) || {};
          res.resume = () => {};
          onResponse(res);
          if (status === 200) {
            const body = spec && Object.prototype.hasOwnProperty.call(spec, 'body') ? spec.body : spec;
            const text = typeof body === 'string' ? body : JSON.stringify(body);
            res.emit('data', Buffer.from(text));
            res.emit('end');
          }
        } catch (error) {
          req.emit('error', error);
        }
      });
      return req;
    };

    const map = await fetchFinnhubUniverse();
    return { map, calls, attempts, delays, messages };
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

check('missing token remains an intentional empty unmarked skip', async () => {
  const r = await runWithFakeFinnhub(() => { throw new Error('network must not run'); }, { withToken: false });
  assert.equal(r.calls.length, 0);
  assert.equal(r.map.size, 0);
  assert.notEqual(r.map.partial, true);
});

check('all 17 valid slices return a complete Map', async () => {
  const r = await runWithFakeFinnhub((exchange) => validSlice(exchange));
  assert.equal(r.calls.length, 17);
  assert.equal(r.map.size, 17);
  assert.notEqual(r.map.partial, true);
});

check('17 valid empty arrays remain complete rather than inventing a count floor', async () => {
  const r = await runWithFakeFinnhub(() => []);
  assert.equal(r.calls.length, 17);
  assert.equal(r.map.size, 0);
  assert.notEqual(r.map.partial, true);
});

check('non-array slice marks partial, retains earlier rows, and continues later exchanges', async () => {
  const r = await runWithFakeFinnhub((exchange) => exchange === 'L' ? { body: {} } : validSlice(exchange));
  assert.equal(r.calls.length, 17);
  assert.equal(r.map.size, 16);
  assert.equal(r.map.partial, true);
  assert.ok(r.map.has('XUS'), 'earlier US slice must survive');
  assert.ok(r.map.has('XT.T'), 'later Tokyo slice must still be requested and retained');
  assert.match(r.messages.join('\n'), /\[Finnhub\] L: unexpected response/);
});

check('terminal HTTP failure marks partial and continues later exchanges', async () => {
  const r = await runWithFakeFinnhub((exchange) => exchange === 'L'
    ? { status: 500 }
    : validSlice(exchange));
  assert.equal(r.calls.length, 17);
  assert.equal(r.map.size, 16);
  assert.equal(r.map.partial, true);
  assert.ok(r.map.has('XT.T'));
  assert.match(r.messages.join('\n'), /\[Finnhub\] L failed: HTTP 500/);
});

check('JSON parse failure marks partial without discarding healthy slices', async () => {
  const r = await runWithFakeFinnhub((exchange) => exchange === 'L'
    ? { body: '{ broken' }
    : validSlice(exchange));
  assert.equal(r.calls.length, 17);
  assert.equal(r.map.size, 16);
  assert.equal(r.map.partial, true);
  assert.ok(r.map.has('XT.T'));
  assert.match(r.messages.join('\n'), /\[Finnhub\] L failed:/);
});

check('transient timeout recovered by retry stays complete', async () => {
  const r = await runWithFakeFinnhub((exchange, attempt) => exchange === 'L' && attempt === 1
    ? { error: new Error('timeout') }
    : validSlice(exchange));
  assert.equal(r.calls.length, 18);
  assert.equal(r.attempts.get('L'), 2);
  assert.equal(r.map.size, 17);
  assert.notEqual(r.map.partial, true);
  assert.match(r.messages.join('\n'), /\[Finnhub\] L timeout .*retrying/);
});

check('transient HTTP 429 recovered by retry stays complete', async () => {
  const r = await runWithFakeFinnhub((exchange, attempt) => exchange === 'L' && attempt === 1
    ? { status: 429 }
    : validSlice(exchange));
  assert.equal(r.calls.length, 18);
  assert.equal(r.attempts.get('L'), 2);
  assert.equal(r.map.size, 17);
  assert.notEqual(r.map.partial, true);
  assert.deepEqual(r.delays.filter(delay => delay !== 1100), [5000]);
  assert.match(r.messages.join('\n'), /\[Finnhub\] L HTTP 429 .*retrying/);
});

check('persistent first-exchange HTTP 429 exhausts retry budget then bails partial', async () => {
  const r = await runWithFakeFinnhub((exchange) => {
    assert.equal(exchange, 'US');
    return { status: 429 };
  });
  assert.deepEqual(r.calls, ['US', 'US', 'US']);
  assert.equal(r.map.size, 0);
  assert.equal(r.map.partial, true);
  assert.deepEqual(r.delays, [5000, 20000]);
  assert.match(r.messages.join('\n'), /HTTP 429 on first exchange .* skipping remaining 16 exchanges/);
});

check('first-exchange auth bail is visibly partial and still stops after one call', async () => {
  const r = await runWithFakeFinnhub((exchange) => {
    assert.equal(exchange, 'US');
    return { status: 401 };
  });
  assert.deepEqual(r.calls, ['US']);
  assert.equal(r.map.size, 0);
  assert.equal(r.map.partial, true);
  assert.match(r.messages.join('\n'), /HTTP 401 on first exchange .* skipping remaining 16 exchanges/);
});

(async () => {
  let pass = 0;
  let fail = 0;
  for (const [name, fn] of checks) {
    try {
      await fn();
      pass++;
      console.log('  ok   ' + name);
    } catch (error) {
      fail++;
      console.error('FAIL   ' + name + '\n       ' + (error && error.stack || error));
    }
  }
  console.log('\nfinnhub-partial: ' + pass + ' ok, ' + fail + ' fail');
  process.exitCode = fail ? 1 : 0;
})();
