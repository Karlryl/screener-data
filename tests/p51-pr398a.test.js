'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { applyFinancialCases: apply, table } = require('../lib/financial-known-cases');
const fixtures = require('./fixtures/financial-known-cases.json').snapshots;
test('a revised table revalidates stored holds without bypassing context or losing vendor evidence', () => {
  const raw = structuredClone(fixtures.HTGC), c = table.cases.find(c => c.caseId === 'htgc-2026-06-30-revenueQ');
  const at = raw.timeseries.revenueQEnds.indexOf(c.period), i = 0;
  raw.timeseries = { revenueQ: [raw.timeseries.revenueQ[at]], revenueQEnds: [c.period] };
  raw.timeseries.revenueQ[i].value++;
  const held = apply(raw).snapshot, original = JSON.stringify(held);
  assert.equal(held.timeseries.revenueQ[i].value, null);
  assert.deepEqual(apply(held).snapshot, held, 'same revision remains held');
  const revised = structuredClone(table); revised.revision += '-p51';
  revised.cases.find(x => x.caseId === c.caseId).expectedBadValue++;
  const got = apply(held, { table: revised }).snapshot;
  assert.deepEqual(got, apply(raw, { table: revised }).snapshot);
  assert.equal(got.timeseries.revenueQ[i].value, 149114000);
  assert.equal(got.timeseries.revenueQ[i].financialMissing, undefined);
  assert.equal(JSON.stringify(held), original, 'input remains immutable');
  for (const change of [s => { s.meta.reportingCurrencyOriginal = 'EUR'; },
    s => { s.timeseries.revenueQ[i].financialMissing.originalVendorRow.unit = 'shares'; },
    s => { s.timeseries.revenueQEnds[1] = c.period; }]) {
    const unsafe = structuredClone(held); change(unsafe);
    assert.equal(apply(unsafe, { table: revised }).snapshot.timeseries.revenueQ[i].value, null);
  }
  const absent = structuredClone(held); delete absent.timeseries.revenueQ[i].financialMissing.originalVendorRow;
  assert.equal(apply(absent, { table: revised }).snapshot.timeseries.revenueQ[i].value, null);
  const denied = structuredClone(table); denied.revision += '-denied';
  let retry = apply(held, { table: denied }).snapshot;
  assert.equal(retry.timeseries.revenueQ[i].financialMissing.revision, denied.revision);
  retry = structuredClone(retry);
  retry.meta.reportingCurrencyOriginal = 'EUR'; denied.revision += '-context';
  retry = apply(retry, { table: denied }).snapshot;
  assert.equal(retry.timeseries.revenueQ[i].financialMissing.reasonCode, 'context-changed');
  retry.meta.reportingCurrencyOriginal = raw.meta.reportingCurrencyOriginal;
  assert.deepEqual(apply(retry, { table: revised }).snapshot, got);
  const confirmedRaw = structuredClone(raw); confirmedRaw.timeseries.revenueQ[i].value = c.replacementValue;
  const fakeHold = structuredClone(held);
  fakeHold.timeseries.revenueQ[i].financialMissing.originalVendorRow = confirmedRaw.timeseries.revenueQ[i];
  assert.equal(apply(fakeHold, { table: revised }).snapshot.timeseries.revenueQ[i].value, c.replacementValue);
});

test('extending quarterly coverage revalidates the retained vendor value', () => {
  const raw = structuredClone(fixtures.HTGC);
  const c = table.cases.find(c => c.caseId === 'htgc-2026-06-30-revenueQ');
  const i = raw.timeseries.revenueQEnds.indexOf(c.period);
  const earlier = structuredClone(table); earlier.revision += '-before-coverage';
  earlier.cases = earlier.cases.filter(x => x.caseId !== c.caseId);
  earlier.coverage.find(x => x.ticker === c.ticker && x.field === c.field).coversThrough = '2026-03-31';
  const held = apply(raw, { table: earlier }).snapshot;
  assert.equal(held.timeseries.revenueQ[i].financialMissing.reasonCode, 'period-after-coverage');
  assert.deepEqual(apply(held, { table: earlier }).snapshot, held);
  assert.deepEqual(apply(held).snapshot.timeseries.revenueQ[i], apply(raw).snapshot.timeseries.revenueQ[i]);
  const unsafe = structuredClone(held);
  unsafe.timeseries.revenueQ[i].financialMissing.originalVendorRow.currency = 'EUR';
  assert.equal(apply(unsafe).snapshot.timeseries.revenueQ[i].value, null);
});
