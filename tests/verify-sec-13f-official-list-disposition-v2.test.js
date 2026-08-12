'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'verify-sec-13f-official-list-disposition-v2.py');
const CONTRACT = path.join(ROOT, 'research', 'early-detection-v4', 'sec-13f-official-list-disposition-contract-v2.json');

function run(args) {
  const result = spawnSync('python', args, { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

for (const prefix of [[SCRIPT], ['-O', '-B', SCRIPT]]) {
  const verified = run([...prefix, 'verify']);
  assert.equal(verified.status, 'PASS');
  assert.equal(verified.studyCredit, 'ZERO');
  assert.equal(verified.networkRequests, 0);
  const tested = run([...prefix, 'self-test']);
  assert.equal(tested.status, 'PASS');
  assert.equal(tested.mutationsRejected, 6);
  assert.equal(tested.networkRequests, 0);
}

const value = JSON.parse(fs.readFileSync(CONTRACT, 'utf8'));
assert.equal(value.supersededV1.futureExecutionAuthorized, false);
assert.equal(value.supersededV1.studyCredit, 'ZERO');
assert.equal(value.incidentDisposition.exactIdentifierRepeatedInDisposition, false);
assert.equal(value.incidentDisposition.providerPdfCaptured, false);
assert.equal(value.sourceDisposition.automatedArchiveExecutionAuthorized, false);
assert.equal(value.eligibilityCensus.rowsWithLabelBoundCusipEvidence, 1);
assert.equal(value.eligibilityCensus.rowsWithoutLabelBoundCusipEvidence, 655);
assert.deepEqual(new Set(Object.values(value.claimLocks)), new Set([false]));

console.log(JSON.stringify({ status: 'PASS', V1ExecutionSuperseded: true, currentTreeFixtureScrubbed: true }));
