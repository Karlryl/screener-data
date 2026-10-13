#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const script = path.join(ROOT, 'scripts', 'early-detection-commoncrawl-static.py');
const run = spawnSync(process.env.PYTHON || 'python', [script, 'self-test'], {
  cwd: ROOT,
  encoding: 'utf8',
  windowsHide: true,
});

assert.equal(run.error, undefined, run.error?.message);
assert.equal(run.status, 0, run.stderr || run.stdout);
const result = JSON.parse(run.stdout);
assert.equal(result.status, 'PASS');
assert.equal(result.surtCanonicalizationVerified, true);
assert.equal(result.binaryClusterSearchVerified, true);
assert.equal(result.cdxBlockVerified, true);
assert.equal(result.pathListVerified, true);
assert.equal(result.shortRangeCacheVerified, true);
assert.equal(result.malformedRejected, true);

console.log('early-detection-commoncrawl-static.test.js: PASS');
