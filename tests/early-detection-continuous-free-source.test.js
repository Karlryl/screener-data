#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const script = path.join(ROOT, 'scripts', 'early-detection-continuous-free-source.py');
const run = spawnSync(process.env.PYTHON || 'python', [script, 'self-test'], {
  cwd: ROOT,
  encoding: 'utf8',
  windowsHide: true,
});

assert.equal(run.error, undefined, run.error?.message);
assert.equal(run.status, 0, run.stderr || run.stdout);
const result = JSON.parse(run.stdout);
assert.equal(result.status, 'PASS');
assert.equal(result.syntheticFixtureOnly, true);
assert.equal(result.inputBundleBound, true);
assert.equal(result.eventPredecessorMismatchRejected, true);
assert.equal(result.rawLineEndingDriftRejected, true);
assert.equal(result.pathTraversalRejected, true);
assert.equal(result.duplicateTaskRejected, true);
assert.equal(result.zombieFencingTokenRejected, true);
assert.equal(result.crossAgentTransitionRejected, true);
assert.equal(result.resolvedWithoutEvidenceRejected, true);
assert.equal(result.futureDatedEventRejected, true);
assert.equal(result.outcomeDependentPriorityRejected, true);
assert.equal(result.externalStatePathRejected, true);
assert.equal(result.sameEventsAndStatePathRejected, true);
assert.equal(result.fencingTokenAdvanced, true);
assert.equal(result.originalV4CannotBeCompleteAtTwoOfThirteen, true);
assert.equal(result.addOnStudiesLockedAppendOnly, true);
assert.equal(result.outcomesAccessed, false);

console.log('early-detection-continuous-free-source.test.js: PASS');
