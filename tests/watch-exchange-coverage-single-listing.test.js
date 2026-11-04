'use strict';

// Run 41805213687 (04.11.2026) went red on 'Nasdaq: dropped to 0 (median 1)'.
// The only listing under that label (NXDR) has been labelled 'NasdaqCM' by
// Yahoo since its refetch on 30.10.; nothing was lost. A loss of at most one
// listing must not alarm, a loss of two or more still must.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isExchangeAlarming,
  checkDrift,
  updateBaseline,
  singleListingDrops
} = require('../scripts/watch-exchange-coverage.js');

// data-health/exchange-coverage-baseline.json at 729a132042 (after the red run).
const NASDAQ_0411 = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0];

test('the 04.11. Nasdaq label (one listing relabelled) does not alarm', () => {
  assert.equal(isExchangeAlarming(0, NASDAQ_0411), false);
  assert.deepEqual(checkDrift({ NasdaqCM: 101 }, { Nasdaq: NASDAQ_0411 }), []);
});

test('one listing lost from a two-listing label does not alarm', () => {
  assert.equal(isExchangeAlarming(1, Array(14).fill(2)), false);
});

test('two or more listings lost still alarm on small labels', () => {
  assert.equal(isExchangeAlarming(0, Array(14).fill(2)), true);
  assert.equal(isExchangeAlarming(1, Array(14).fill(3)), true); // Budapest-sized label, 3 -> 1
  assert.equal(isExchangeAlarming(2, [3, 4, 3, 4, 3, 4, 3, 4, 3, 4, 3, 4, 3, 4]), true); // median 3.5 -> 2
  assert.equal(isExchangeAlarming(0, [1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2]), true); // median 1.5 -> 0
  assert.deepEqual(checkDrift({}, { Budapest: Array(14).fill(3) }), ['Budapest: dropped to 0 (median 3)']);
});

test('a non-alarming single-listing zero enters the window instead of freezing it', () => {
  const next = updateBaseline({ Nasdaq: NASDAQ_0411 }, {}, '2026-11-05');
  assert.deepEqual(next.Nasdaq, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0]);
});

test('the emptied label is still reported as a note, a real drop is not', () => {
  assert.deepEqual(singleListingDrops({}, { Nasdaq: NASDAQ_0411 }),
    ['Nasdaq: 0 today (median 1), at most one listing lost']);
  assert.deepEqual(singleListingDrops({}, { Budapest: Array(14).fill(3) }), []);
  assert.deepEqual(singleListingDrops({ Nasdaq: 1 }, { Nasdaq: NASDAQ_0411 }), []);
  assert.deepEqual(singleListingDrops({}, { Nasdaq: NASDAQ_0411.slice(1) }), []); // still seeding
});
