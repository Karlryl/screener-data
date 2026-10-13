'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { applyFinancialCases } = require('../lib/financial-known-cases');
const { diffCells } = require('../scripts/financial-corrections-replay');
const fixture = require('./fixtures/financial-known-cases.json').snapshots['BANPU.BK'];
test('a stale quarantine is reported without dereferencing a nonexistent cell', () => {
  const raw = structuredClone(fixture); raw.meta.sharesOutstanding *= 1.001;
  const before = JSON.stringify(raw), result = applyFinancialCases(raw);
  assert.ok(result.events.some(e => e.reasonCode === 'quarantine-fingerprint-changed'));
  const changes = diffCells(raw, result.snapshot, result.events);
  assert.equal(changes.length, 5);
  assert.ok(changes.every(e => e.container && e.field && Number.isInteger(e.index)));
  assert.ok(result.snapshot.meta.financialDataIssue);
  assert.equal(JSON.stringify(raw), before);
  const corrupt = structuredClone(result.snapshot); corrupt.meta.sharesOutstanding++;
  assert.throws(() => diffCells(raw, corrupt, result.events), /all unrelated bytes must match/);
});
