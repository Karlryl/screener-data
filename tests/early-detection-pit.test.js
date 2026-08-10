#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const script = path.join(ROOT, 'scripts', 'early-detection-pit.py');
const run = spawnSync(process.env.PYTHON || 'python', [script, 'self-test'], {
  cwd: ROOT,
  encoding: 'utf8',
  windowsHide: true,
});

assert.equal(run.error, undefined, run.error?.message);
assert.equal(run.status, 0, run.stderr || run.stdout);
const result = JSON.parse(run.stdout);
assert.equal(result.status, 'PASS');
assert.equal(result.submissions, 2);
assert.equal(result.facts, 2);
assert.equal(result.futureFilingExcludedBeforeCutoff, true);
assert.equal(result.idempotentPayloadReuse, true);
assert.equal(result.timePolicy, 'SEC_EASTERN_US_DST_2007PLUS_V1');
assert.equal(result.legacyFractionalAcceptanceSupported, true);
assert.equal(result.csvFieldLimit, 64 * 1024 * 1024);
assert.equal(result.legacyCp1252Supported, true);

console.log('early-detection-pit.test.js: PASS');
