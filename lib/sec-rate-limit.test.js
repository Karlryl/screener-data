'use strict';
/** Standalone, offline coverage. Run: node lib/sec-rate-limit.test.js */
const assert = require('node:assert/strict');
const limits = require('./sec-rate-limit.js');

let passed = 0;
let failed = 0;
let assertions = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (error) { failed++; console.error('FAIL   ' + name + '\n' + error.stack); }
}
function equal(actual, expected, message) {
  assertions++;
  assert.equal(actual, expected, message);
}

test('both documented delays are exported in milliseconds', () => {
  assertions++;
  assert.deepEqual(Object.keys(limits).sort(), ['RATE_DELAY_MS', 'RATE_LIMIT_BACKOFF_MS']);
  equal(limits.RATE_DELAY_MS, 125);
  equal(limits.RATE_LIMIT_BACKOFF_MS, 30000);
});

test('delay values are finite positive integers and backoff exceeds normal spacing', () => {
  for (const value of Object.values(limits)) {
    equal(typeof value, 'number');
    equal(Number.isFinite(value), true);
    equal(Number.isInteger(value), true);
    equal(value > 0, true);
  }
  equal(limits.RATE_LIMIT_BACKOFF_MS > limits.RATE_DELAY_MS, true);
});

test('constants cannot be overwritten by invalid delay values', () => {
  for (const [key, expected] of Object.entries(limits)) {
    for (const invalid of [0, -1, NaN, null, '']) {
      equal(Reflect.set(limits, key, invalid), false);
      equal(limits[key], expected);
    }
  }
});

test('frozen exports reject missing keys and deletion', () => {
  equal(Object.isFrozen(limits), true);
  equal(Object.isExtensible(limits), false);
  equal(limits.UNKNOWN_DELAY_MS, undefined);
  equal(Reflect.set(limits, 'UNKNOWN_DELAY_MS', 1), false);
  equal(Reflect.deleteProperty(limits, 'RATE_DELAY_MS'), false);
  equal(Reflect.deleteProperty(limits, 'RATE_LIMIT_BACKOFF_MS'), false);
  equal(limits.RATE_DELAY_MS, 125);
  equal(limits.RATE_LIMIT_BACKOFF_MS, 30000);
});

console.log(`\nsec-rate-limit.test.js: ${passed} ok, ${failed} fail, ${assertions} assertions`);
process.exitCode = failed ? 1 : 0;
