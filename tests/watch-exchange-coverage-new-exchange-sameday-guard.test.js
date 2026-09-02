'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { updateBaseline } = require('../scripts/watch-exchange-coverage.js');

const DATE = '2026-09-01';

test('same-day rerun replaces an existing exchange slot', () => {
  const updated = updateBaseline(
    { NYSE: [10], _lastUpdated: DATE },
    { NYSE: 12 },
    DATE,
  );

  assert.deepEqual(updated.NYSE, [12]);
});

test('same-day rerun seeds a newly observed exchange', () => {
  const updated = updateBaseline({ _lastUpdated: DATE }, { Taiwan: 7 }, DATE);

  assert.deepEqual(updated.Taiwan, [7]);
});
