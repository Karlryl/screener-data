#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'build-sec-explicit-fixed-cash-consideration-v1.py');
const contract = path.join(root, 'research', 'early-detection-v4', 'sec-explicit-fixed-cash-consideration-contract-v1.json');
const output = path.join(root, 'reports', 'early-detection', 'sec-explicit-fixed-cash-consideration-v1.json');
const EXPECTED_CONTRACT_RAW = 'a603de6fbb2a5f850cdafd232a7eeaccadc8116ff25ae7b84d4978ab78f2b928';
function sha(raw) { return crypto.createHash('sha256').update(raw).digest('hex'); }
assert.equal(sha(fs.readFileSync(contract)), EXPECTED_CONTRACT_RAW);
for (const optimized of [false, true]) {
  const prefix = optimized ? ['-O', '-B', script] : ['-B', script];
  for (const command of ['verify-contract', 'self-test']) {
    const run = spawnSync(process.env.PYTHON || 'python', [...prefix, command], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 120000 });
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
    const run = spawnSync(process.env.PYTHON || 'python', [...prefix, 'verify-output'], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 120000 });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const value = JSON.parse(run.stdout.trim());
    assert.equal(value.status, 'PASS');
    assert.equal(value.sourceRebuildVerified, true);
    assert.equal(value.verifiedRows, 4);
    assert.equal(value.outcomesAccessed, false);
  }
}
const source = fs.readFileSync(script, 'utf8');
assert.doesNotMatch(source, /urllib|requests\.|http\.client|socket\.|aiohttp|fetch\(/);
console.log('build-sec-explicit-fixed-cash-consideration-v1.test.js: PASS');
