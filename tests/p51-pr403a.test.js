'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { applyFinancialCases: apply, table } = require('../lib/financial-known-cases');
const { diffCells } = require('../scripts/financial-corrections-replay');
const fixture = require('./fixtures/financial-known-cases.json').snapshots.OTF;
test('the superseded OTF marker is removed only after the annual replacement safeguard', () => {
  const old = structuredClone(fixture);
  old.meta.financialDataIssue = { caseId: 'otf-vendor-annual-revenue-20261001', reason: 'synthetic historical hold' };
  const original = JSON.stringify(old), result = apply(old), fresh = apply(structuredClone(fixture)).snapshot;
  assert.equal(result.snapshot.meta.financialDataIssue, undefined);
  assert.deepEqual(result.snapshot, fresh);
  assert.ok(result.snapshot.annual.annualRev.every(row => row.value === null));
  assert.ok(result.events.some(e => e.reasonCode === 'quarantine-superseded'));
  assert.doesNotThrow(() => diffCells(old, result.snapshot, result.events));
  assert.equal(JSON.stringify(old), original); assert.deepEqual(apply(result.snapshot).snapshot, result.snapshot);
  for (const change of [s => { s.meta.financialDataIssue.caseId = 'unrelated-hold'; },
    s => { delete s.annual; }, s => { s.meta.ticker = 'UNLISTED'; }]) {
    const control = structuredClone(old); change(control);
    assert.deepEqual(apply(control).snapshot.meta.financialDataIssue, control.meta.financialDataIssue);
  }
  const noAnnual = structuredClone(table); noAnnual.cases = noAnnual.cases.filter(c => c.periodType !== '12M');
  assert.ok(apply(old, { table: noAnnual }).snapshot.meta.financialDataIssue);
  const unrelated = { meta: { ticker: 'UNLISTED' } };
  Object.defineProperty(unrelated, 'annual', { get() { throw new Error('unrelated annual block must not be read'); } });
  assert.equal(apply(unrelated).snapshot, unrelated);
});

test('replay restores the superseded marker in its original position and still detects unrelated metadata changes', () => {
  const raw = structuredClone(fixture);
  raw.meta = { financialDataIssue: { caseId: 'otf-vendor-annual-revenue-20261001' }, ...raw.meta };
  const result = apply(raw);
  assert.equal(result.snapshot.meta.financialDataIssue, undefined);
  assert.doesNotThrow(() => diffCells(raw, result.snapshot, result.events));
  for (const change of [meta => { meta.sharesOutstanding++; }, meta => { delete meta.name; }, meta => { meta.extra = true; }]) {
    const corrupt = structuredClone(result.snapshot); change(corrupt.meta);
    assert.throws(() => diffCells(raw, corrupt, result.events), /all unrelated bytes must match/);
  }
});
