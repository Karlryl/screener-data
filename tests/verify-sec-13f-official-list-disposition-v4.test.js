'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'verify-sec-13f-official-list-disposition-v4.py');
const CONTRACT = path.join(ROOT, 'research', 'early-detection-v4', 'sec-13f-official-list-disposition-contract-v4.json');

function run(prefix) {
  const result = spawnSync('python', [...prefix, SCRIPT, 'self-test'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

for (const prefix of [[], ['-O', '-B']]) {
  const tested = run(prefix);
  assert.equal(tested.status, 'PASS');
  assert.equal(tested.mutationsRejected, 6);
  assert.equal(tested.dependenciesBound, 12);
  assert.equal(tested.studyCredit, 'ZERO');
  assert.equal(tested.wholeTreeAbsenceNotClaimed, true);
  assert.equal(tested.networkRequests, 0);
  assert.equal(tested.filesWritten, 0);
  assert.equal(tested.outcomesAccessed, false);
}

const value = JSON.parse(fs.readFileSync(CONTRACT, 'utf8'));
assert.equal(value.dependencyGitBindings.length, 12);
assert.ok(value.dependencyGitBindings.every((item) => item.requiredAtIntroductionCommit === true));
assert.equal(value.incidentDisposition.identifierAbsentFromWholeCurrentTree, false);
assert.equal(value.sourceDisposition.studyCredit, 'ZERO');
assert.deepEqual(new Set(Object.values(value.claimLocks)), new Set([false]));

console.log(JSON.stringify({ status: 'PASS', dependencyGitBindings: 12, studyCredit: 'ZERO' }));
