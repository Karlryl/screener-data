'use strict';
// Fixture for tests/clock-shift-gate.test.js. NOT a gate test (tests/fixtures/ is not discovered).
// Red at every clock: the guard must skip it (test-gate reports it), not call it clock-dependent.
const test = require('node:test');
const assert = require('node:assert/strict');

test('always red', () => {
  assert.equal(1, 2);
});
