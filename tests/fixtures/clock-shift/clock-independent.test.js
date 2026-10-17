'use strict';
// Fixture for tests/clock-shift-gate.test.js. NOT a gate test (tests/fixtures/ is not discovered).
// Reads the clock only through calls that must stay exact under the guard.
const test = require('node:test');
const assert = require('node:assert/strict');

test('explicit dates stay exact', () => {
  assert.equal(new Date('2026-01-02T03:04:05Z').toISOString(), '2026-01-02T03:04:05.000Z');
  assert.equal(new Date(2026, 0, 2).getFullYear(), 2026);
  assert.equal(Date.UTC(2026, 0, 1), 1767225600000);
  assert.equal(Date.parse('2026-01-01T00:00:00Z'), 1767225600000);
});

test('elapsed time between two clock reads is not shifted', () => {
  const a = Date.now();
  const b = Date.now();
  assert.ok(b - a < 1000);
});
