'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { advanceEntry } = require('../scripts/update-ath-state.js');

const entry = {
  ath: 100,
  athDate: '2025-01-02',
  needsReseed: false,
};
const chronologicalBars = [
  { date: '2026-08-30', close: 80 },
  { date: '2026-08-31', close: 120 },
];

test('chronological bars advance ATH state to the newest close', () => {
  const result = advanceEntry(entry, chronologicalBars);

  assert.equal(result.ath, 120);
  assert.equal(result.lastClose, 120);
  assert.equal(result.lastDate, '2026-08-31');
});

test('reverse-ordered bars produce the same newest state', () => {
  const result = advanceEntry(entry, [
    chronologicalBars[1],
    chronologicalBars[0],
  ]);

  assert.equal(result.ath, 120);
  assert.equal(result.lastClose, 120);
  assert.equal(result.lastDate, '2026-08-31');
});
