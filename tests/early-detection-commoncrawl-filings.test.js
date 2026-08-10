#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const script = path.join(ROOT, 'scripts', 'early-detection-commoncrawl-filings.py');
const run = spawnSync(process.env.PYTHON || 'python', [script, 'self-test'], {
  cwd: ROOT,
  encoding: 'utf8',
  windowsHide: true,
});

assert.equal(run.error, undefined, run.error?.message);
assert.equal(run.status, 0, run.stderr || run.stdout);
const result = JSON.parse(run.stdout);
assert.equal(result.status, 'PASS');
assert.equal(result.collinfoParsed, 3);
assert.equal(result.nearestLaterAndLatestVerified, true);
assert.equal(result.emptyCaptureSetAccepted, true);
assert.equal(result.byteRangeMetadataVerified, true);
assert.equal(result.malformedRejected, true);

console.log('early-detection-commoncrawl-filings.test.js: PASS');
