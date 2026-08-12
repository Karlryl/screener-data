#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const script = path.join(ROOT, 'scripts', 'early-detection-continuous-free-source-v3.py');
for (const optimization of [[], ['-O']]) {
  const run = spawnSync(process.env.PYTHON || 'python', [...optimization, '-B', script, 'self-test'], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  assert.equal(run.error, undefined, run.error?.message);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const value = JSON.parse(run.stdout);
  assert.equal(value.status, 'PASS');
  assert.equal(value.nestedHypothesisOutcomeRejected, true);
  assert.equal(value.outcomeArtifactContentRejected, true);
  assert.equal(value.accountLaneReachableAfterExactAttestation, true);
  assert.equal(value.pendingAndQuarantineLicensesCannotPromote, true);
  assert.equal(value.remoteTrustAnchorFrozen, true);
  assert.equal(value.independentPromotionRequired, true);
  assert.equal(value.rawInputsRequireByteCasGitRemoteBinding, true);
  assert.equal(value.casPublishedFromValidatedSnapshot, true);
  assert.equal(value.eachMutationRequiresRemoteQueueSnapshot, true);
  assert.equal(value.outcomesAccessed, false);
}
console.log('early-detection-continuous-free-source-v3.test.js: PASS');
