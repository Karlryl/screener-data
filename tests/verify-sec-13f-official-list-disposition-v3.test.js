'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'verify-sec-13f-official-list-disposition-v3.py');
const CONTRACT = path.join(ROOT, 'research', 'early-detection-v4', 'sec-13f-official-list-disposition-contract-v3.json');

function run(prefix, command) {
  const result = spawnSync('python', [...prefix, SCRIPT, command], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

for (const prefix of [[], ['-O', '-B']]) {
  const tested = run(prefix, 'self-test');
  assert.equal(tested.status, 'PASS');
  assert.equal(tested.studyCredit, 'ZERO');
  assert.equal(tested.mutationsRejected, 6);
  assert.equal(tested.V1NetworkReportAndWriteEntrypointsDisabled, true);
  assert.equal(tested.wholeTreeAbsenceNotClaimed, true);
  assert.equal(tested.networkRequests, 0);
  assert.equal(tested.filesWritten, 0);
  assert.equal(tested.outcomesAccessed, false);
}

const value = JSON.parse(fs.readFileSync(CONTRACT, 'utf8'));
assert.equal(value.incidentDisposition.removedFromPilotRunnerAndTestCurrentBytes, true);
assert.equal(value.incidentDisposition.identifierAbsentFromWholeCurrentTree, false);
assert.equal(value.incidentDisposition.knownPreexistingArtifactsContainingSameIdentifier.length, 3);
assert.equal(value.sourceDisposition.futureExecutionAuthorized, false);
assert.equal(value.sourceDisposition.automatedArchiveExecutionAuthorized, false);
assert.deepEqual(new Set(Object.values(value.claimLocks)), new Set([false]));

console.log(JSON.stringify({
  status: 'PASS',
  V1NetworkReportAndWriteEntrypointsDisabled: true,
  honestCurrentTreeDisposition: true,
  studyCredit: 'ZERO',
}));
