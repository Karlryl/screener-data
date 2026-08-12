#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'build-sec-form15-structured-metadata-v1.py');

for (const optimized of [false, true]) {
  const args = optimized ? ['-O', '-B', script, '--self-test'] : ['-B', script, '--self-test'];
  const run = spawnSync(process.env.PYTHON || 'python', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout);
  assert.equal(result.status, 'PASS');
  assert.equal(result.contractRawBound, true);
  assert.equal(result.authorizedSourceCommitBound, true);
  assert.equal(result.validExactExtractionAccepted, true);
  assert.equal(result.formSubtypeConflictRejected, true);
  assert.equal(result.strictSecHeaderRejected, true);
  assert.equal(result.malformedExtraAccessionRejected, true);
  assert.equal(result.duplicateHeaderFieldAmbiguous, true);
  assert.equal(result.hiddenHtmlContentRejected, true);
  assert.equal(result.malformedHtmlFallbackDeterministic, true);
  assert.equal(result.binaryDocumentEvidenceRejected, true);
  assert.equal(result.tickerOnlyJoinMutationRejected, true);
  assert.equal(result.missingSourceHashMutationRejected, true);
  assert.equal(result.candidatePromotionMutationRejected, true);
  assert.equal(result.falseClaimMutationRejected, true);
  assert.equal(result.outcomesAccessed, false);
}

console.log('build-sec-form15-structured-metadata-v1.test.js: PASS');
