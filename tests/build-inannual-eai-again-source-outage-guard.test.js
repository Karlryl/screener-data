'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { istQuellenausfall } = require('../scripts/build-inannual');

test('NSE source-outage guard recognizes a temporary DNS resolution failure', () => {
  assert.equal(istQuellenausfall('getaddrinfo EAI_AGAIN www.nseindia.com'), true);
});

test('NSE source-outage guard keeps a symbol-local HTTP 404 out of the circuit breaker', () => {
  assert.equal(istQuellenausfall('https://x -> HTTP 404 (nicht wiederholbar)'), false);
});
