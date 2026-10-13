#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const script = path.join(ROOT, 'scripts', 'early-detection-filing-transport-decision.py');
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
assert.equal(result.populationUnionVerified, true);
assert.equal(result.incrementalSampleVerified, true);
assert.equal(result.contentPayloadHashesVerified, true);
assert.equal(result.wilsonIntervalVerified, true);
assert.equal(result.tamperedInputRejected, true);

console.log('early-detection-filing-transport-decision.test.js: PASS');
