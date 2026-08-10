#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const script = path.join(ROOT, 'scripts', 'early-detection-sec-filing-individual.py');
const run = spawnSync(process.env.PYTHON || 'python', [script, 'self-test'], {
  cwd: ROOT,
  encoding: 'utf8',
  windowsHide: true,
});

assert.equal(run.error, undefined, run.error?.message);
assert.equal(run.status, 0, run.stderr || run.stdout);
const result = JSON.parse(run.stdout);
assert.equal(result.status, 'PASS');
assert.equal(result.emptyCaptureSetAccepted, true);
assert.equal(result.captureParsed, true);
assert.equal(result.primaryPathVerified, true);
assert.equal(result.urlVariantsVerified, true);
assert.equal(result.deterministicSampleVerified, true);
assert.equal(result.malformedRejected, true);
assert.equal(result.submissionInspectionVerified, true);

console.log('early-detection-sec-filing-individual.test.js: PASS');
