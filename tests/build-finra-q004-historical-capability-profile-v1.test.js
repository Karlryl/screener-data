#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'build-finra-q004-historical-capability-profile-v1.py');
const contract = path.join(root, 'research', 'early-detection-v4', 'finra-q004-historical-capability-profile-contract-v1.json');
const output = path.join(root, 'reports', 'early-detection', 'finra-q004-historical-capability-profile-v1.json');
const EXPECTED_CONTRACT_RAW = '9af957802695d6d47f1eeb52fe8c8352c06b34f9e13173a923e888e99d672bf6';

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
    if (command === 'self-test') assert.deepEqual(new Set(Object.values(value.kills)), new Set([true]));
  }
}

if (fs.existsSync(output)) {
  for (const optimized of [false, true]) {
    const prefix = optimized ? ['-O', '-B', script] : ['-B', script];
    const run = spawnSync(process.env.PYTHON || 'python', [...prefix, 'verify-output'], { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const value = JSON.parse(run.stdout.trim());
    assert.equal(value.status, 'PASS');
    assert.equal(value.privateCasVerified, true);
    assert.equal(value.recordCount, 145103);
    assert.equal(value.outcomesAccessed, false);
  }
}

const source = fs.readFileSync(script, 'utf8');
assert.doesNotMatch(source, /urllib|requests\.|http\.client|socket\.|aiohttp|fetch\(/);
assert.doesNotMatch(source, /Credential|keyring|os\.environ|os\.getenv|Authorization/i);

console.log('build-finra-q004-historical-capability-profile-v1.test.js: PASS');
