'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const REPO = path.join(__dirname, '..');
const RECORD = path.join(REPO, 'protocol', 'early-detection', '2.0.0',
  'c0-c1-sequencing-amendment-record.json');

function validate(record) {
  assert.equal(record.schema, 'early-detection-sequencing-amendment-record/v1');
  assert.equal(record.mode, 'AMENDMENT_NO_RETROACTIVE_REWRITE');
  assert.deepEqual(record.plannedSequence, ['E6b', 'Strang C']);
  assert.ok(Date.parse(record.observedExecution.C0.startedAt)
    < Date.parse(record.observedExecution.C0.completedAt));
  assert.ok(Date.parse(record.observedExecution.C0.completedAt)
    < Date.parse(record.observedExecution.C1.startedAt));
  assert.ok(Date.parse(record.observedExecution.C1.completedAt)
    < Date.parse(`${record.recordedAt}T23:59:59+02:00`));
  assert.equal(record.observedExecution.E6b.pathsAcrossLocalGitRefsAsOfRecordDate, 0);
  assert.equal(record.deviation.observed, 'C0_AND_C1_BEFORE_E6b');
  assert.equal(record.deviation.recorded, true);
  assert.deepEqual(record.preservation, {
    C0Rewritten: false,
    C1Rewritten: false,
    E6bCreatedByThisRecord: false,
    confirmatoryVerdictsChanged: 0,
    endtestOpened: false,
  });
}

test('C0/C1 sequencing amendment records planned and observed dates exactly', () => {
  const record = JSON.parse(fs.readFileSync(RECORD, 'utf8'));
  validate(record);
  assert.equal(record.source.effectiveDate, '2026-08-16');
  assert.equal(record.source.sha256,
    'debcb57b102e3d8643519e1cfe3ca27259d62089fd7aa6ec7010bf843acc08cc');
  assert.equal(record.observedExecution.C0.completedCommit,
    '86b35923013e70d4faaab0219e87c33ab3ce8e22');
  assert.equal(record.observedExecution.C1.completedCommit,
    'de1c6e9b80d63ee613abd7e6610873d1488d339a');
});

test('C0/C1 sequencing amendment contains facts, dates, and no rationale fields', () => {
  const record = JSON.parse(fs.readFileSync(RECORD, 'utf8'));
  const keys = [];
  function visit(value) {
    if (Array.isArray(value)) return value.forEach(visit);
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        keys.push(key.toLowerCase());
        visit(child);
      }
    }
  }
  visit(record);
  for (const forbidden of ['reason', 'justification', 'recommendation']) {
    assert.ok(!keys.includes(forbidden), `${forbidden} is not a fact/date field`);
  }
});

test('C0/C1 sequencing amendment validator fails on a falsified chronology', () => {
  const record = JSON.parse(fs.readFileSync(RECORD, 'utf8'));
  const sabotage = structuredClone(record);
  sabotage.observedExecution.C1.startedAt = '2026-08-19T20:00:00+02:00';
  assert.throws(() => validate(sabotage), assert.AssertionError);
});
