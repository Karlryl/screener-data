'use strict';
// Fixture for tests/clock-shift-gate.test.js. NOT a gate test (tests/fixtures/ is not discovered).
// Every check is skipped: green exit code, but nothing was verified - the guard must not call it green.
const test = require('node:test');

test('never runs', { skip: 'precondition missing' }, () => {
  throw new Error('unreachable');
});
