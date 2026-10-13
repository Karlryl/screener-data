'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { detectStatsDrift } = require('../scripts/check-pull-stats.js');

const HISTORY = Array.from(
  { length: 4 },
  () => ({ yahooOk: 100 }),
);

test('flags a coverage loss beyond the drift threshold', () => {
  const alerts = detectStatsDrift(
    { yahooOk: 74 },
    HISTORY,
    0.25,
  );

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].metric, 'yahooOk');
});

test('does not flag equivalent coverage growth', () => {
  assert.deepEqual(
    detectStatsDrift(
      { yahooOk: 126 },
      HISTORY,
      0.25,
    ),
    [],
  );
});
