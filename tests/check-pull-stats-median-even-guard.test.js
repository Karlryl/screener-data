'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { median } = require('../scripts/check-pull-stats.js');

test('returns the middle value for an odd-sized sample', () => {
  assert.equal(median([1, 5, 9]), 5);
});

test('averages the two middle values for an even-sized sample', () => {
  assert.equal(median([1, 3, 5, 7]), 4);
});
