'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { advanceEntry } = require('../scripts/update-ath-state.js');

const bars = [
  { date: '2026-08-30', close: 80 },
  { date: '2026-08-31', close: 120 },
];

test('a valid ATH advances without requesting a reseed', () => {
  const result = advanceEntry({
    ath: 100,
    athDate: '2025-01-02',
    needsReseed: false,
  }, bars);

  assert.equal(result.needsReseed, false);
  assert.equal(result.ath, 120);
  assert.equal(result.athDate, '2026-08-31');
});

test('a null ATH requests a reseed instead of inventing a window high', () => {
  const result = advanceEntry({
    ath: null,
    athDate: null,
    needsReseed: false,
  }, bars);

  assert.equal(result.needsReseed, true);
  assert.equal(result.ath, null);
  assert.equal(result.athDate, null);
  assert.equal(result.lastClose, 120);
  assert.equal(result.lastDate, '2026-08-31');
});
