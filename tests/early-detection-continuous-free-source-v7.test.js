#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const script = path.join(ROOT, 'scripts', 'early-detection-continuous-free-source-v7.py');
for (const optimization of [[], ['-O']]) {
  const run = spawnSync(process.env.PYTHON || 'python', [...optimization, '-B', script, 'self-test'], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  assert.equal(run.error, undefined, run.error?.message);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const value = JSON.parse(run.stdout);
  assert.equal(value.status, 'PASS');
  assert.equal(value.nestedHypothesisOutcomeRejected, true);
  assert.equal(value.outcomeArtifactContentRejected, true);
  assert.equal(value.autonomousAccountSelfAttestationRejected, true);
  assert.equal(value.casefoldCamelSpaceOutcomeTokensRejected, true);
  assert.equal(value.nestedCompletedStudyInputRejected, true);
  assert.equal(value.baseControllerPreImportBytesBound, true);
  assert.equal(value.singleFrozenStatePathPairRequired, true);
  assert.equal(value.pendingAndQuarantineLicensesCannotPromote, true);
  assert.equal(value.remoteTrustAnchorFrozen, true);
  assert.equal(value.resolutionFailClosedUntilDeterministicReparser, true);
  assert.equal(value.captureFailClosedUntilTransactionalCas, true);
  assert.equal(value.eachMutationRequiresStableRemoteQueueSnapshot, true);
  assert.equal(value.outcomesAccessed, false);
}
console.log('early-detection-continuous-free-source-v7.test.js: PASS');
