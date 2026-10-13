#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const script = path.join(ROOT, 'scripts', 'early-detection-pit-compact.py');
const run = spawnSync(process.env.PYTHON || 'python', [script, 'self-test'], {
  cwd: ROOT,
  encoding: 'utf8',
  windowsHide: true,
});

assert.equal(run.error, undefined, run.error?.message);
assert.equal(run.status, 0, run.stderr || run.stdout);
const result = JSON.parse(run.stdout);
assert.equal(result.status, 'PASS');
assert.deepEqual(result.totals, {
  facts: 2,
  orphans: 2,
  presentations: 2,
  submissions: 2,
  tags: 1,
});
assert.equal(result.futureFilingExcludedBeforeCutoff, true);
assert.equal(result.idempotentPayloadReuse, true);
assert.equal(result.tagDefinitions, 1);
assert.equal(result.orphanRowsQuarantined, 2);

console.log('early-detection-pit-compact.test.js: PASS');
