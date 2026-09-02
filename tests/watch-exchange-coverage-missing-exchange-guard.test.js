'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkDrift } = require('../scripts/watch-exchange-coverage.js');

const baseline = { NYSE: Array(14).fill(100) };

test('a healthy exchange present today stays quiet', () => {
  assert.deepEqual(checkDrift({ NYSE: 100 }, baseline), []);
});

test('an exchange missing from today is still checked against its baseline', () => {
  const alerts = checkDrift({}, baseline);

  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /^NYSE:/);
});
