#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'build-nasdaq-symbol-directory-monthly-gap-matrix-v1.py');
const contract = path.join(root, 'research', 'early-detection-v4', 'nasdaq-symbol-directory-monthly-gap-matrix-contract-v1.json');
const output = path.join(root, 'reports', 'early-detection', 'nasdaq-symbol-directory-monthly-gap-matrix-v1.json');
const EXPECTED_RAW = 'cc499b7cbaa9b585ba4fff6510623c2a6898360e16386edcf8546023fc62103e';

function sha(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

assert.equal(sha(fs.readFileSync(contract)), EXPECTED_RAW);
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
    assert.equal(value.sourceRebuildVerified, true);
    assert.equal(value.cells, 384);
    assert.equal(value.outcomesAccessed, false);
  }
}

console.log('build-nasdaq-symbol-directory-monthly-gap-matrix-v1.test.js: PASS');
