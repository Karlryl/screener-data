#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'build-finra-sec-point-candidate-crosswalk-v1.py');
const contract = path.join(root, 'research', 'early-detection-v4', 'finra-sec-point-candidate-crosswalk-contract-v1.json');
const output = path.join(root, 'reports', 'early-detection', 'finra-sec-point-candidate-crosswalk-v1.json');
const EXPECTED_CONTRACT_RAW = 'd8e2ae6adf01c4327acb9af44f14d5dd864c1a4c22cd41e00711a22857d05c1c';
function sha(raw) { return crypto.createHash('sha256').update(raw).digest('hex'); }
assert.equal(sha(fs.readFileSync(contract)), EXPECTED_CONTRACT_RAW);
for (const optimized of [false, true]) {
  const prefix = optimized ? ['-O', '-B', script] : ['-B', script];
  for (const command of ['verify-contract', 'self-test']) {
    const run = spawnSync(process.env.PYTHON || 'python', [...prefix, command], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 240000 });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const value = JSON.parse(run.stdout.trim());
    assert.equal(value.status, 'PASS');
    assert.equal(value.outcomesAccessed, false);
    if (command === 'self-test') assert.deepEqual(new Set(Object.values(value.kills)), new Set([true]));
  }
}
if (fs.existsSync(output)) {
  for (const optimized of [false, true]) {
    const prefix = optimized ? ['-O', '-B', script] : ['-B', script];
    const run = spawnSync(process.env.PYTHON || 'python', [...prefix, 'verify-output'], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 240000 });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const value = JSON.parse(run.stdout.trim());
    assert.equal(value.status, 'PASS');
    assert.equal(value.privateSourceRebuildVerified, true);
    assert.equal(value.candidatePairs, 3);
    assert.equal(value.outcomesAccessed, false);
  }
}
const source = fs.readFileSync(script, 'utf8');
assert.doesNotMatch(source, /urllib|requests\.|http\.client|socket\.|aiohttp|fetch\(/);
console.log('build-finra-sec-point-candidate-crosswalk-v1.test.js: PASS');
