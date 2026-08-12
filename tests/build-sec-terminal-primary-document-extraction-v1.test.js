#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'build-sec-terminal-primary-document-extraction-v1.py');
const contract = path.join(root, 'research', 'early-detection-v4', 'sec-terminal-primary-document-extraction-contract-v1.json');
const output = path.join(root, 'reports', 'early-detection', 'sec-terminal-primary-document-extraction-v1.json');
const EXPECTED_CONTRACT_RAW = 'cc18c2d7ac4d984b5511830eae714a0131096e384c77d63817c4b59afa2cf797';

function sha(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

assert.equal(sha(fs.readFileSync(contract)), EXPECTED_CONTRACT_RAW);
for (const optimized of [false, true]) {
  const prefix = optimized ? ['-O', '-B', script] : ['-B', script];
  for (const command of ['verify-contract', 'self-test']) {
    const run = spawnSync(process.env.PYTHON || 'python', [...prefix, command], { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const value = JSON.parse(run.stdout.trim());
    assert.equal(value.status, 'PASS');
    assert.equal(value.outcomesAccessed, false);
    if (command === 'self-test') assert.deepEqual(new Set(Object.values(value.checks)), new Set([true]));
  }
}

if (fs.existsSync(output)) {
  for (const optimized of [false, true]) {
    const prefix = optimized ? ['-O', '-B', script] : ['-B', script];
    const run = spawnSync(process.env.PYTHON || 'python', [...prefix, 'verify-output'], { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const value = JSON.parse(run.stdout.trim());
    assert.equal(value.status, 'PASS');
    assert.equal(value.sourceRebuildVerified, true);
    assert.equal(value.rows, 656);
    assert.equal(value.outcomesAccessed, false);
  }
}

const source = fs.readFileSync(script, 'utf8');
assert.doesNotMatch(source, /urllib|requests\.|http\.client|socket\.|aiohttp|fetch\(/);
assert.doesNotMatch(source, /priceData|stockPrice|returnValue|pValue|eligibility/i);

console.log('build-sec-terminal-primary-document-extraction-v1.test.js: PASS');
