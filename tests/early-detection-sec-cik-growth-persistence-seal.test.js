'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'early-detection-sec-cik-growth-persistence-seal.py');

test('SEC CIK checkpoint validator rejects schema drift and outcome unlocks', () => {
  const run = spawnSync('python', [script, 'self-test'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout);
  assert.deepEqual(result, {
    bindingMutationRejected: true,
    duplicateAgentRejected: true,
    futureAuthorizationTimestampRejected: true,
    futureSealTimestampRejected: true,
    outcomeUnlockRejected: true,
    outcomesAccessed: false,
    schemaDriftRejected: true,
    selfHashMutationRejected: true,
    status: 'PASS',
    statusMutationRejected: true,
    validTimelineAccepted: true,
    validAuditSetAccepted: true,
  });
});
