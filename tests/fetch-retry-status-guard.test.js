'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');

const {
  fetchBuffer,
  _internals,
} = require('../lib/fetch-retry');

const originalHttpsGet = https.get;
let networkCalls = 0;

beforeEach(() => {
  _internals.letzterAbruf.clear();
  networkCalls = 0;
  https.get = () => {
    networkCalls += 1;
    throw new Error('unexpected live network access');
  };
});

afterEach(() => {
  https.get = originalHttpsGet;
  assert.equal(networkCalls, 0, 'test attempted a live HTTPS request');
});

function response(code, body = String(code)) {
  return {
    code,
    body: Buffer.from(body),
    headers: {},
  };
}

function harness(outcomes, versuche = outcomes.length) {
  let calls = 0;
  const sleeps = [];

  return {
    opts: {
      pauseMs: 0,
      versuche,
      backoffMs: 7,
      _get: async () => {
        const outcome = outcomes[calls];
        calls += 1;
        if (outcome instanceof Error) throw outcome;
        return outcome;
      },
      _schlaf: async (ms) => {
        sleeps.push(ms);
      },
    },
    calls: () => calls,
    sleeps,
  };
}

test('HTTP 200 returns the exact response without retry or backoff', async () => {
  const ok = response(200, 'ok');
  const h = harness([ok]);

  const actual = await fetchBuffer('https://success.example.test/data', h.opts);

  assert.strictEqual(actual, ok);
  assert.equal(h.calls(), 1);
  assert.deepEqual(h.sleeps, []);
});

test('HTTP 402 fails fast with the quota-specific diagnostic', async () => {
  const h = harness([response(402)]);

  await assert.rejects(
    () => fetchBuffer('https://quota.example.test/data', h.opts),
    (error) => {
      assert.match(error.message, /HTTP 402/);
      assert.match(error.message, /Gratis-Kontingent/);
      assert.match(error.message, /Nicht durch Wiederholen/);
      assert.doesNotMatch(error.message, /nicht wiederholbar/);
      return true;
    },
  );
  assert.equal(h.calls(), 1);
  assert.deepEqual(h.sleeps, []);
});

test('ordinary HTTP 404 fails fast instead of retrying', async () => {
  const h = harness([response(404)]);

  await assert.rejects(
    () => fetchBuffer('https://missing.example.test/data', h.opts),
    /HTTP 404 \(nicht wiederholbar\)/,
  );
  assert.equal(h.calls(), 1);
  assert.deepEqual(h.sleeps, []);
});

test('HTTP 429 retries once and then returns success', async () => {
  const ok = response(200, 'after-429');
  const h = harness([response(429), ok]);

  const actual = await fetchBuffer('https://rate-limit.example.test/data', h.opts);

  assert.strictEqual(actual, ok);
  assert.equal(h.calls(), 2);
  assert.deepEqual(h.sleeps, [7]);
});

test('repeated HTTP 429 responses exhaust the configured attempts', async () => {
  const h = harness([response(429), response(429), response(429)]);

  await assert.rejects(
    () => fetchBuffer('https://rate-limit-exhausted.example.test/data', h.opts),
    /nach 3 Versuchen aufgegeben: HTTP 429/,
  );
  assert.equal(h.calls(), 3);
  assert.deepEqual(h.sleeps, [7, 14]);
});

test('HTTP 500 retries once and then returns success', async () => {
  const ok = response(200, 'after-500');
  const h = harness([response(500), ok]);

  const actual = await fetchBuffer('https://lower-5xx.example.test/data', h.opts);

  assert.strictEqual(actual, ok);
  assert.equal(h.calls(), 2);
  assert.deepEqual(h.sleeps, [7]);
});

test('HTTP 599 retries once and then returns success', async () => {
  const ok = response(200, 'after-599');
  const h = harness([response(599), ok]);

  const actual = await fetchBuffer('https://upper-5xx.example.test/data', h.opts);

  assert.strictEqual(actual, ok);
  assert.equal(h.calls(), 2);
  assert.deepEqual(h.sleeps, [7]);
});

test('network failure retries independently of HTTP status handling', async () => {
  const reset = new Error('connection reset');
  reset.code = 'ECONNRESET';
  const ok = response(200, 'after-reset');
  const h = harness([reset, ok]);

  const actual = await fetchBuffer('https://network-error.example.test/data', h.opts);

  assert.strictEqual(actual, ok);
  assert.equal(h.calls(), 2);
  assert.deepEqual(h.sleeps, [7]);
});

test('repeated HTTP 500 responses use exponential backoff before success', async () => {
  const ok = response(200, 'after-backoff');
  const h = harness([response(500), response(500), response(500), ok]);

  const actual = await fetchBuffer('https://backoff.example.test/data', h.opts);

  assert.strictEqual(actual, ok);
  assert.equal(h.calls(), 4);
  assert.deepEqual(h.sleeps, [7, 14, 28]);
});
