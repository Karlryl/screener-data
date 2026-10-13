'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isExchangeAlarming } = require('../scripts/watch-exchange-coverage.js');

test('an exchange remains quiet while its baseline window is still seeding', () => {
  assert.equal(isExchangeAlarming(0, Array(13).fill(100)), false);
});

test('a zero count alarms once the baseline window is complete', () => {
  assert.equal(isExchangeAlarming(0, Array(14).fill(100)), true);
});
