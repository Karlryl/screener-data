'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const shared = require('../lib/sec-rate-limit.js');

const ORIGINAL_DELAY_MS = shared.RATE_DELAY_MS;
const ORIGINAL_BACKOFF_MS = shared.RATE_LIMIT_BACKOFF_MS;

test('shared SEC rate-limit configuration is frozen', () => {
  assert.equal(Object.isFrozen(shared), true);
});

test('request delay cannot be reassigned', () => {
  assert.equal(Reflect.set(shared, 'RATE_DELAY_MS', ORIGINAL_DELAY_MS + 1), false);
  assert.equal(shared.RATE_DELAY_MS, ORIGINAL_DELAY_MS);
});

test('rate-limit backoff cannot be reassigned', () => {
  assert.equal(Reflect.set(shared, 'RATE_LIMIT_BACKOFF_MS', ORIGINAL_BACKOFF_MS + 1), false);
  assert.equal(shared.RATE_LIMIT_BACKOFF_MS, ORIGINAL_BACKOFF_MS);
});

test('shared configuration cannot be extended with a client-local override', () => {
  assert.equal(Object.hasOwn(shared, 'CLIENT_OVERRIDE_MS'), false);
  assert.equal(Reflect.set(shared, 'CLIENT_OVERRIDE_MS', 1), false);
  assert.equal(Object.hasOwn(shared, 'CLIENT_OVERRIDE_MS'), false);
});
