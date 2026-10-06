'use strict';
// P108 (06.10.2026): since Tag 1419 (#425) applyFinancialCases may ANNOTATE a snapshot with
// timeseries.reportedRevenueQEnds (verified period labels; no value changes, no event). The
// replay's byte guard treated that annotation as an unrelated change and aborted on ADI
// ("all unrelated bytes must match"). The annotation is reported separately, never as a cell.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { applyFinancialCases, table } = require('../lib/financial-known-cases.js');
const { diffCells } = require('../scripts/financial-corrections-replay.js');

const serial = JSON.stringify;
const labels = table.periodLabels.filter(c => c.ticker === 'ADI');
assert.ok(labels.length >= 2, 'fixture precondition: ADI has verified period labels in the hand table');

// Minimal ADI-like snapshot whose newest two quarters match the hand-table entries exactly.
function adiSnapshot() {
  const newest = labels.find(c => c.period === '2026-07-31'), prior = labels.find(c => c.period === '2025-07-31');
  return { meta: { ticker: 'ADI', reportingCurrency: 'USD', source: 'yahoo', name: 'Analog Devices' },
    timeseries: {
      revenueQ: [{ value: newest.verifiedValue }, { value: 2500000000 }, { value: 2400000000 }, { value: 2300000000 }, { value: prior.verifiedValue }],
      revenueQEnds: ['2026-07-31', '2026-04-30', '2026-01-31', '2025-10-31', '2025-07-31'],
    } };
}

test('a label annotation alone is not a cell change: no throw, no change, reported separately', () => {
  const before = adiSnapshot(), bytes = serial(before);
  const f = applyFinancialCases(before);
  assert.deepEqual(f.events, [], 'precondition: labels emit no correction event');
  assert.deepEqual(f.snapshot.timeseries.reportedRevenueQEnds, ['2026-08-01', null, null, null, '2025-08-02'], 'precondition: annotation present');
  const annotations = [];
  const changes = diffCells(before, f.snapshot, f.events, annotations);
  assert.deepEqual(changes, []);
  assert.deepEqual(annotations, [{ ticker: 'ADI', field: 'reportedRevenueQEnds', ends: ['2026-08-01', null, null, null, '2025-08-02'] }]);
  assert.equal(serial(before), bytes, 'input never mutated');
  // Second replay pass (zero guard) sees the annotation on both sides: nothing to report.
  assert.deepEqual(diffCells(f.snapshot, structuredClone(f.snapshot), [], annotations), []);
  assert.equal(annotations.length, 1);
  // Callers that pass no collector still get the same verdict.
  assert.deepEqual(diffCells(before, f.snapshot, f.events), []);
});

test('the byte guard still fires for any other unrelated difference', () => {
  const before = adiSnapshot(), f = applyFinancialCases(before);
  const tampered = structuredClone(f.snapshot); tampered.meta.name = 'Analog Devices Inc.';
  assert.throws(() => diffCells(before, tampered, f.events), /ADI: all unrelated bytes must match/);
  const withValue = structuredClone(f.snapshot); withValue.timeseries.revenueQ[1] = { value: 1 };
  assert.throws(() => diffCells(before, withValue, f.events), /ADI: all unrelated bytes must match/);
  const differentAnnotation = structuredClone(f.snapshot); differentAnnotation.timeseries.reportedRevenueQEnds[0] = '2026-08-02';
  assert.throws(() => diffCells(f.snapshot, differentAnnotation, []), /ADI: all unrelated bytes must match/,
    'a CHANGED annotation between two annotated snapshots is an unrelated difference');
});
