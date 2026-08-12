#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const script = path.join(ROOT, 'scripts', 'verify-quantconnect-free-cloud-pilot-v1.py');
const run = spawnSync(process.env.PYTHON || 'python', ['-B', script], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
assert.equal(run.error, undefined, run.error?.message);
assert.equal(run.status, 0, run.stderr || run.stdout);
const result = JSON.parse(run.stdout);
assert.equal(result.status, 'PASS');
assert.equal(result.caseCount, 50);
assert.equal(result.executionBlocked, true);
assert.equal(result.outcomesAccessed, false);
console.log('quantconnect-free-cloud-pilot-v1.test.js: PASS');
