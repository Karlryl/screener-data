'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { uncheckedStats } = require('../scripts/check-pull-stats.js');

function row(asOf, overrides = {}) {
  return {
    asOf,
    yahooOk: 100,
    yahooFailed: 0,
    yahooTotal: 100,
    yahooSuccessRate: 1,
    fxRatesCount: 10,
    fxFailed: 0,
    earningsWithDate: 20,
    priceTickerCount: 30,
    universeSize: 40,
    snapshotsCount: 50,
    ...overrides,
  };
}

const TODAY = row('2026-09-02');
const RECENT = [
  row('2026-08-29'),
  row('2026-08-30'),
  row('2026-08-31'),
  row('2026-09-01'),
];

test('four complete recent rows make every watched metric comparable', () => {
  assert.deepEqual(uncheckedStats(TODAY, RECENT), []);
});

test('an older valid row cannot hide a gap in the latest window', () => {
  const recentWithGap = RECENT.map((entry) => ({ ...entry }));
  recentWithGap[3].priceTickerCount = null;

  assert.deepEqual(
    uncheckedStats(TODAY, [
      row('2026-08-28'),
      ...recentWithGap,
    ]),
    ['priceTickerCount'],
  );
});
