'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { advanceEntry } = require('../scripts/update-ath-state.js');

const entry = {
  ath: 100,
  athDate: '2025-01-02',
  needsReseed: false,
};
const validBars = [
  { date: '2026-08-30', close: 80 },
  { date: '2026-08-31', close: 120 },
];

test('positive bars advance ATH state normally', () => {
  const result = advanceEntry(entry, validBars);

  assert.equal(result.ath, 120);
  assert.equal(result.lastClose, 120);
  assert.equal(result.lastDate, '2026-08-31');
});

test('later zero and negative closes are ignored', () => {
  for (const close of [0, -5]) {
    const result = advanceEntry(entry, [
      ...validBars,
      { date: '2026-09-01', close },
    ]);

    assert.equal(result.ath, 120);
    assert.equal(result.lastClose, 120);
    assert.equal(result.lastDate, '2026-08-31');
  }
});
