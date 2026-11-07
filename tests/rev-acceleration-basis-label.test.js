'use strict';
// Basis label of the revenue acceleration axis (07.11.2026, display only). Red when the onBasis reports in
// src/scoring/axes.js or the export derivation are removed: the counts fall to 0 and the annual basis to null.
const assert = require('node:assert/strict');
const { test } = require('node:test');

process.env.RUN_DATE_UTC = '2026-11-07';
const A = require('../src/scoring/axes.js');
const { revAccelerationBasisForSnapshot: label, checkRevAccelerationBasis } = require('../scripts/write-findash-export.js');

const ENDS = ['2026-09-30', '2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'];
const snap = (rq, ar = [400, 300, 250]) => ({
  meta: { ticker: 'X', fetchedAt: '2026-11-01T00:00:00Z' },
  timeseries: { revenueQ: rq, revenueQEnds: ENDS.slice(0, rq.length), statementPeriods: { revenueQ: rq.map(() => '3M') } },
  annual: { annualRev: ar, annualRevEnds: ['2025-12-31', '2024-12-31', '2023-12-31'].slice(0, ar.length) },
});

test('the label names the branch revAcceleration took and the usable year-ago comparisons', () => {
  const cases = [
    ['six full quarters', snap([120, 110, 100, 95, 100, 100]), { basis: 'quarter', quarterComparisons: 2, newestQuarterStale: false }, 0.1],
    ['six, June 2025 missing', snap([120, 110, 100, 95, 100, null]), { basis: 'year', quarterComparisons: 1, newestQuarterStale: false }, 400 / 300 - 300 / 250],
    ['six, September 2025 missing', snap([120, 110, 100, 95, null, 100]), { basis: 'year', quarterComparisons: 1, newestQuarterStale: false }, 400 / 300 - 300 / 250],
    ['five quarters', snap([120, 110, 100, 95, 100]), { basis: 'year', quarterComparisons: 1, newestQuarterStale: false }, 400 / 300 - 300 / 250],
    ['five quarters, two years', snap([120, 110, 100, 95, 100], [400, 300]), { basis: 'none', quarterComparisons: 1, newestQuarterStale: false }, null],
  ];
  for (const [name, s, want, value] of cases) {
    const got = A.revAcceleration(s);
    if (value === null) assert.equal(got, null, name); else assert.ok(Math.abs(got - value) < 1e-12, name + ': value unchanged');
    assert.deepEqual(label(s), want, name);
  }
  assert.equal(label(null), null, 'no snapshot, no label');
});

test('a stale newest quarter pair leaves the quarterly basis and says so', () => {
  const old = snap([120, 110, 100, 95, 100, 100]);
  old.timeseries.revenueQEnds = ['2024-09-30', '2024-06-30', '2024-03-31', '2023-12-31', '2023-09-30', '2023-06-30'];
  const got = label(old);
  assert.equal(got.quarterComparisons, 2);
  assert.equal(got.newestQuarterStale, true);
  assert.notEqual(got.basis, 'quarter');
});

test('the export check tolerates absence and null, rejects a malformed or contradictory label', () => {
  const errs = (row) => { const e = []; checkRevAccelerationBasis(row, 'r', e); return e; };
  assert.deepEqual(errs({}), []);
  assert.deepEqual(errs({ revAccelerationBasis: null }), []);
  assert.deepEqual(errs({ revAccelerationBasis: { basis: 'quarter', quarterComparisons: 2, newestQuarterStale: false } }), []);
  assert.equal(errs({ revAccelerationBasis: { basis: 'quarterly', quarterComparisons: 2, newestQuarterStale: false } }).length, 1);
  assert.equal(errs({ revAccelerationBasis: { basis: 'year', quarterComparisons: -1, newestQuarterStale: false } }).length, 1);
  assert.equal(errs({ revAccelerationBasis: { basis: 'year', quarterComparisons: 1 } }).length, 1);
  assert.equal(errs({ revAccelerationBasis: { basis: 'quarter', quarterComparisons: 1, newestQuarterStale: false } }).length, 1);
  assert.equal(errs({ revAccelerationBasis: { basis: 'quarter', quarterComparisons: 2, newestQuarterStale: true } }).length, 1);
});
