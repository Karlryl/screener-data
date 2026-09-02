'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ADAPTER_BUDGET_MS,
  zeitbudget,
} = require('../discovery/zeitbudget');

test('omitted budget uses the adapter default', () => {
  const budget = zeitbudget('default', undefined, () => 10);
  assert.equal(budget.budgetMs, ADAPTER_BUDGET_MS);
  assert.equal(budget.restMs(), ADAPTER_BUDGET_MS);
});

test('null budget uses the adapter default', () => {
  const budget = zeitbudget('default', null, () => 10);
  assert.equal(budget.budgetMs, ADAPTER_BUDGET_MS);
  assert.equal(budget.restMs(), ADAPTER_BUDGET_MS);
});

test('finite positive budget is exhausted at its exact boundary', () => {
  let now = 100;
  const budget = zeitbudget('positive', 10, () => now);

  now = 109;
  assert.equal(budget.restMs(), 1);
  assert.equal(budget.erschoepft(), false);

  now = 110;
  assert.equal(budget.restMs(), 0);
  assert.equal(budget.erschoepft(), true);
});

test('zero budget preserves immediate exhaustion', () => {
  const budget = zeitbudget('zero', 0, () => 0);
  assert.equal(budget.budgetMs, 0);
  assert.equal(budget.restMs(), 0);
  assert.equal(budget.erschoepft(), true);
});

test('negative finite budget preserves immediate exhaustion', () => {
  const budget = zeitbudget('negative', -1, () => 0);
  assert.equal(budget.budgetMs, -1);
  assert.equal(budget.restMs(), -1);
  assert.equal(budget.erschoepft(), true);
});

test('coercible finite legacy budgets retain their original value and arithmetic', () => {
  const cases = [
    { value: '100', expectedRest: 100, exhausted: false },
    { value: '1e3', expectedRest: 1000, exhausted: false },
    { value: '', expectedRest: 0, exhausted: true },
    { value: '   ', expectedRest: 0, exhausted: true },
    { value: false, expectedRest: 0, exhausted: true },
  ];

  for (const entry of cases) {
    const budget = zeitbudget('coercible', entry.value, () => 0);
    assert.strictEqual(budget.budgetMs, entry.value);
    assert.equal(budget.restMs(), entry.expectedRest);
    assert.equal(budget.erschoepft(), entry.exhausted);
  }
});

function assertInvalidBeforeClock(value) {
  let clockReads = 0;
  assert.throws(
    () => zeitbudget('invalid', value, () => {
      clockReads += 1;
      return 0;
    }),
    TypeError,
  );
  assert.equal(clockReads, 0);
}

test('NaN budget is rejected before reading the clock', () => {
  assertInvalidBeforeClock(Number.NaN);
});

test('positive Infinity budget is rejected before reading the clock', () => {
  assertInvalidBeforeClock(Number.POSITIVE_INFINITY);
});

test('negative Infinity budget is rejected before reading the clock', () => {
  assertInvalidBeforeClock(Number.NEGATIVE_INFINITY);
});

test('string Infinity budget is rejected before reading the clock', () => {
  assertInvalidBeforeClock('Infinity');
});

test('non-numeric string budget is rejected before reading the clock', () => {
  assertInvalidBeforeClock('junk');
});

test('unit-suffixed string budget is rejected before reading the clock', () => {
  assertInvalidBeforeClock('1ms');
});
