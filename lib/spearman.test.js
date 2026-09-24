'use strict';

// Run standalone: node lib/spearman.test.js
const assert = require('node:assert/strict');
const { averageRank, spearman } = require('./spearman.js');
let assertions = 0;
function check(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  assertions++;
}
function throws(fn, message) {
  assert.throws(fn, TypeError, message);
  assertions++;
}
function near(actual, expected, message) {
  assert.ok(typeof actual === 'number' && Math.abs(actual - expected) < 1e-12,
    `${message}: expected ${expected}, received ${actual}`);
  assertions++;
}

check(averageRank([30, 10, 20]), [3, 1, 2], 'ranks retain original input order');
check(averageRank([1, 2, 3]), [1, 2, 3], 'ranks are one-based');
check(averageRank([3, 2, 1]), [3, 2, 1], 'descending values');
check(averageRank([10, 20, 20, 40]), [1, 2.5, 2.5, 4], 'average rank for middle ties');
check(averageRank([5, 5, 1, 1]), [3.5, 3.5, 1.5, 1.5], 'multiple tie groups');
check(averageRank([7, 7, 7]), [2, 2, 2], 'constant series');
check(averageRank([-4, -9, 0, 2]), [2, 1, 3, 4], 'negative values and zero');
check(averageRank([-0, 0, 1]), [1.5, 1.5, 3], 'signed zeros tie');
check(averageRank([0.1, -0.2, 0.1]), [2.5, 1, 2.5], 'fractional ties');
check(averageRank([]), [], 'empty array');
check(averageRank([42]), [1], 'singleton');
throws(() => averageRank(null), 'raw rank helper requires an array');
throws(() => averageRank(undefined), 'undefined is not a supported rank input');
// Current behavior: the raw helper has no finite-value guard. spearman guards it below.
check(averageRank([1, NaN, 2]), [1, 2, 3], 'current NaN rank behavior, not data validation');
check(averageRank([null, -1, 1]), [2, 1, 3], 'current null element behavior');
check(averageRank([-Infinity, 0, Infinity]), [1, 2, 3], 'current infinite rank behavior');
const rankInput = Object.freeze([9, 3, 3, 6]);
check(averageRank(rankInput), [4, 1.5, 1.5, 3], 'frozen input is supported');
check(rankInput, [9, 3, 3, 6], 'ranking does not mutate its input');

check(spearman([1, 2, 3], [10, 20, 30]), 1, 'perfect increasing correlation');
check(spearman([1, 2, 3], [30, 20, 10]), -1, 'perfect decreasing correlation');
near(spearman([1, 2, 3], [1, 3, 2]), 0.5, 'nontrivial three-point correlation');
near(spearman([1, 2, 3, 4, 5], [4, 1, 3, 2, 5]), 0.3, 'nontrivial five-point correlation');
near(spearman([1, 2, 2, 4], [4, 1, 1, 2]), -1 / 3, 'average-rank Pearson with ties');
check(spearman([1, 2, 2, 4], [10, 20, 20, 40]), 1, 'matching tie structures');
check(spearman([-3, -2, -1], [-30, -20, -10]), 1, 'negative inputs are valid');
check(spearman([1, 2, 3, 4], [2, 4, 1, 3]), 0, 'uncorrelated rank vectors');
check(spearman([], []), null, 'empty arrays');
check(spearman([1], [2]), null, 'singleton arrays');
check(spearman([1, 2], [3, 4]), null, 'two observations are insufficient');
check(spearman([1, 2, 3], [1, 2, 3, 4]), null, 'different lengths');
check(spearman([2, 2, 2], [1, 2, 3]), null, 'zero variance in first series');
check(spearman([1, 2, 3], [2, 2, 2]), null, 'zero variance in second series');
check(spearman([2, 2, 2], [2, 2, 2]), null, 'both series constant');
for (const invalid of [null, undefined, NaN, -1, '123', {}, new Float64Array([1, 2, 3])]) {
  check(spearman(invalid, [1, 2, 3]), null, 'first series must be an array');
  check(spearman([1, 2, 3], invalid), null, 'second series must be an array');
}
for (const invalid of [NaN, Infinity, -Infinity, null, undefined, '2']) {
  check(spearman([1, invalid, 3], [1, 2, 3]), null, 'first series rejects nonfinite/non-number elements');
  check(spearman([1, 2, 3], [1, invalid, 3]), null, 'second series rejects nonfinite/non-number elements');
}
const left = Object.freeze([3, 1, 2, 2]);
const right = Object.freeze([4, 2, 3, 3]);
check(spearman(left, right), 1, 'frozen correlation inputs');
check(left, [3, 1, 2, 2], 'left input unchanged');
check(right, [4, 2, 3, 3], 'right input unchanged');
near(spearman([5, 1, 4, 2], [3, 8, 7, 4]),
  spearman([3, 8, 7, 4], [5, 1, 4, 2]), 'correlation is symmetric');

console.log(`spearman: ${assertions} assertions passed`);
