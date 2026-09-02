'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { nachDatum } = require('../scripts/build-twannual');

const DATE = '2025-12-31';
const revenue = (value) => ({ date: DATE, type: 'Revenue', value });

test('Taiwan annual parser accepts duplicate rows with the same value', () => {
  const grouped = nachDatum([revenue(100), revenue(100)]);

  assert.equal(grouped.get(DATE).Revenue, 100);
});

test('Taiwan annual parser rejects duplicate rows with conflicting values', () => {
  assert.throws(() => nachDatum([revenue(100), revenue(101)]), /zwei verschiedene Werte/);
});
