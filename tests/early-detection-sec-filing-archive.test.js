#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const script = path.join(ROOT, 'scripts', 'early-detection-sec-filing-archive.py');
const run = spawnSync(process.env.PYTHON || 'python', [script, 'self-test'], {
  cwd: ROOT,
  encoding: 'utf8',
  windowsHide: true,
});

assert.equal(run.error, undefined, run.error?.message);
assert.equal(run.status, 0, run.stderr || run.stdout);
const result = JSON.parse(run.stdout);
assert.equal(result.status, 'PASS');
assert.equal(result.parsedFeedCaptures, 3);
assert.equal(result.selectedDays, 2);
assert.equal(result.malformedRejected, true);
assert.equal(result.offlineCacheVerified, true);
assert.equal(result.coverageMathVerified, true);
assert.equal(result.archiveInspectionVerified, true);
assert.equal(result.contentLengthGuardVerified, true);

console.log('early-detection-sec-filing-archive.test.js: PASS');
