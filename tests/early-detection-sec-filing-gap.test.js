#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const script = path.join(ROOT, 'scripts', 'early-detection-sec-filing-gap.py');
const run = spawnSync(process.env.PYTHON || 'python', [script, 'self-test'], {
  cwd: ROOT,
  encoding: 'utf8',
  windowsHide: true,
});

assert.equal(run.error, undefined, run.error?.message);
assert.equal(run.status, 0, run.stderr || run.stdout);
const result = JSON.parse(run.stdout);
assert.equal(result.status, 'PASS');
assert.equal(result.signedInputsVerified, true);
assert.equal(result.bulkUnionGapVerified, true);
assert.equal(result.deterministicBatchPlanVerified, true);
assert.equal(result.aggregateIncrementVerified, true);
assert.equal(result.captureCandidateExtractionVerified, true);
assert.equal(result.filerCikPathPriorityVerified, true);
assert.equal(result.tamperedPlanRejected, true);
assert.equal(result.productiveGqsModified, false);

console.log('early-detection-sec-filing-gap.test.js: PASS');
