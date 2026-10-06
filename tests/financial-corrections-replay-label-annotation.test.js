'use strict';
// P108 (06.10.2026): since Tag 1419 (#425) applyFinancialCases may ANNOTATE a snapshot with
// timeseries.reportedRevenueQEnds (verified period labels; no value changes, no event). The
// replay's byte guard treated that annotation as an unrelated change and aborted on ADI
// ("all unrelated bytes must match"). The pull persists prepared snapshots, so a stored snapshot
// may already carry an annotation from an OLDER label table (D10, review of #437): replaying a
// revised table yields a changed or removed annotation. Annotations are reported separately
// (new / changed / removed), never as a cell, and never trip the byte guard.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { applyFinancialCases, table } = require('../lib/financial-known-cases.js');
const { diffCells } = require('../scripts/financial-corrections-replay.js');

const serial = JSON.stringify;
const labels = table.periodLabels.filter(c => c.ticker === 'ADI');
assert.ok(labels.length >= 2, 'fixture precondition: ADI has verified period labels in the hand table');
const FULL = ['2026-08-01', null, null, null, '2025-08-02'];

// Minimal ADI-like snapshot whose newest two quarters match the hand-table entries exactly.
function adiSnapshot(annotation) {
  const newest = labels.find(c => c.period === '2026-07-31'), prior = labels.find(c => c.period === '2025-07-31');
  const s = { meta: { ticker: 'ADI', reportingCurrency: 'USD', source: 'yahoo', name: 'Analog Devices' },
    timeseries: {
      revenueQ: [{ value: newest.verifiedValue }, { value: 2500000000 }, { value: 2400000000 }, { value: 2300000000 }, { value: prior.verifiedValue }],
      revenueQEnds: ['2026-07-31', '2026-04-30', '2026-01-31', '2025-10-31', '2025-07-31'],
    } };
  if (annotation !== undefined) s.timeseries.reportedRevenueQEnds = annotation;
  return s;
}

test('new annotation: no throw, no cell change, reported once as kind new', () => {
  const before = adiSnapshot(), bytes = serial(before);
  const f = applyFinancialCases(before);
  assert.deepEqual(f.events, [], 'precondition: labels emit no correction event');
  assert.deepEqual(f.snapshot.timeseries.reportedRevenueQEnds, FULL, 'precondition: annotation present');
  const annotations = [];
  assert.deepEqual(diffCells(before, f.snapshot, f.events, annotations), []);
  assert.deepEqual(annotations, [{ ticker: 'ADI', field: 'reportedRevenueQEnds', kind: 'new', before: null, after: FULL }]);
  assert.equal(serial(before), bytes, 'input never mutated');
  // Second replay pass (zero guard) sees the same annotation on both sides: nothing to report.
  assert.deepEqual(diffCells(f.snapshot, structuredClone(f.snapshot), [], annotations), []);
  assert.equal(annotations.length, 1);
  // Callers that pass no collector still get the same verdict.
  assert.deepEqual(diffCells(before, f.snapshot, f.events), []);
});

test('stored snapshot with an OLDER label table (D10 B1): changed annotation is reported, not thrown', () => {
  const stored = adiSnapshot(['2026-08-01', null, null, null, null]); // persisted by an earlier pull
  const f = applyFinancialCases(stored);
  assert.deepEqual(f.snapshot.timeseries.reportedRevenueQEnds, FULL, 'precondition: revised table annotates the prior quarter too');
  const annotations = [];
  assert.deepEqual(diffCells(stored, f.snapshot, f.events, annotations), []);
  assert.deepEqual(annotations, [{ ticker: 'ADI', field: 'reportedRevenueQEnds', kind: 'changed',
    before: ['2026-08-01', null, null, null, null], after: FULL }]);
  assert.deepEqual(stored.timeseries.reportedRevenueQEnds, ['2026-08-01', null, null, null, null], 'input never mutated');
});

test('removed annotation (drift, table entry withdrawn): reported as kind removed, not thrown', () => {
  const before = adiSnapshot(FULL), after = adiSnapshot();
  const annotations = [];
  assert.deepEqual(diffCells(before, after, [], annotations), []);
  assert.deepEqual(annotations, [{ ticker: 'ADI', field: 'reportedRevenueQEnds', kind: 'removed', before: FULL, after: null }]);
});

test('the byte guard still fires for any other unrelated difference, with or without annotations', () => {
  const before = adiSnapshot(), f = applyFinancialCases(before);
  const tampered = structuredClone(f.snapshot); tampered.meta.name = 'Analog Devices Inc.';
  assert.throws(() => diffCells(before, tampered, f.events, []), /ADI: all unrelated bytes must match/);
  const withValue = structuredClone(f.snapshot); withValue.timeseries.revenueQ[1] = { value: 1 };
  assert.throws(() => diffCells(before, withValue, f.events), /ADI: all unrelated bytes must match/);
  const storedTampered = adiSnapshot(['2026-08-01', null, null, null, null]);
  const changedPlusValue = structuredClone(applyFinancialCases(storedTampered).snapshot); changedPlusValue.timeseries.revenueQ[2] = { value: 7 };
  assert.throws(() => diffCells(storedTampered, changedPlusValue, [], []), /ADI: all unrelated bytes must match/,
    'a changed annotation does not hide a real value change');
});
