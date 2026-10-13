'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { advanceEntry } = require('../scripts/update-ath-state.js');

const entry = {
  ath: 100,
  athDate: '2025-01-02',
  needsReseed: false,
};
const numericBars = [
  { date: '2026-08-30', close: 80 },
  { date: '2026-08-31', close: 120 },
];

test('numeric bars advance ATH state normally', () => {
  const result = advanceEntry(entry, numericBars);

  assert.equal(result.needsReseed, false);
  assert.equal(result.ath, 120);
  assert.equal(result.lastClose, 120);
  assert.equal(result.lastDate, '2026-08-31');
});

test('a later numeric-string close is ignored instead of entering ATH state', () => {
  const result = advanceEntry(entry, [
    ...numericBars,
    { date: '2026-09-01', close: '130' },
  ]);

  assert.equal(result.ath, 120);
  assert.equal(typeof result.ath, 'number');
  assert.equal(result.lastClose, 120);
  assert.equal(typeof result.lastClose, 'number');
  assert.equal(result.lastDate, '2026-08-31');
});
