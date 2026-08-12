#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'build-sec-terminal-candidate-reconciliation-v1.py');

for (const optimized of [false, true]) {
  const args = optimized ? ['-O', '-B', script, '--self-test'] : ['-B', script, '--self-test'];
  const run = spawnSync(process.env.PYTHON || 'python', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout.trim());
  assert.equal(result.status, 'PASS');
  assert.equal(result.contractRawBound, true);
  assert.equal(result.rawHashDriftRejected, true);
  assert.equal(result.validExactCandidateAccepted, true);
  assert.equal(result.exactDuplicateCollapsedWithOccurrences, true);
  assert.equal(result.sameTextDifferentLocatorRetained, true);
  assert.equal(result.conflictingSameLocationRetained, true);
  assert.equal(result.crossFormAccessionCollisionRetained, true);
  assert.equal(result.candidatePromotionRejected, true);
  assert.equal(result.sourceRefTamperRejected, true);
  assert.equal(result.ambiguousSourceRejected, true);
  assert.equal(result.priorityMutationRejected, true);
  assert.equal(result.priceReturnTerminalClaimRejected, true);
  assert.equal(result.rowLossRejected, true);
  assert.equal(result.rowReorderRejected, true);
  assert.equal(result.claimMutationRejected, true);
  assert.equal(result.outcomesAccessed, false);
}

console.log('build-sec-terminal-candidate-reconciliation-v1.test.js: PASS');
