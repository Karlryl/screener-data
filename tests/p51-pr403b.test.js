'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { applyFinancialCases: apply } = require('../lib/financial-known-cases');
const fixture = require('./fixtures/financial-known-cases.json').snapshots.CARG;
test('partly dated annual rows fail closed while fully dated and unrelated rows keep their contract', () => {
  for (const ends of [['2025-12-31', null, null, null], ['2025-12-31'], ['2025-12-31', 'invalid', '2023-12-31', '2022-12-31']]) {
    const raw = structuredClone(fixture);
    for (const field of ['annualRev', 'annualGP']) raw.annual[field + 'Ends'] = ends;
    const before = JSON.stringify(raw), result = apply(raw);
    for (const field of ['annualRev', 'annualGP']) {
      assert.ok(result.snapshot.annual[field].every(row => row.value === null));
      assert.ok(result.snapshot.annual[field].every(row => row.financialMissing.reasonCode === 'annual-value-changed'));
    }
    assert.ok(result.events.some(e => e.container === 'annual' && e.status === 'stale'));
    assert.equal(JSON.stringify(raw), before); assert.deepEqual(apply(result.snapshot).snapshot, result.snapshot);
    raw.meta.ticker = 'UNLISTED'; assert.equal(apply(raw).snapshot, raw);
  }
  const dated = structuredClone(fixture);
  for (const field of ['annualRev', 'annualGP']) dated.annual[field + 'Ends'] = ['2025-12-31', '2024-12-31', '2023-12-31', '2022-12-31'];
  assert.equal(apply(dated).snapshot.annual.annualRev[3].value, null);
  assert.equal(apply(dated).snapshot.annual.annualRev[0].value, fixture.annual.annualRev[0].value);
  for (const field of ['annualRev', 'annualGP']) dated.annual[field + 'Ends'][3] = '2021-12-31';
  assert.deepEqual(apply(dated).snapshot.annual, dated.annual, 'fully dated absent case stays absent');
});
