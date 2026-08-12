#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'verify-continuous-free-source-operational-resume-v1.py');
const contract = path.join(root, 'research', 'early-detection-v4', 'continuous-free-source-operational-resume-contract-v1.json');
const EXPECTED_RAW = '95edf2734e8d850bfb4bb77ae5c283865819409f243fbd30c1220f24ac9e09f7';

function sha(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

assert.equal(sha(fs.readFileSync(contract)), EXPECTED_RAW);
for (const optimized of [false, true]) {
  const prefix = optimized ? ['-O', '-B', script] : ['-B', script];
  for (const command of ['verify', 'self-test']) {
    const run = spawnSync(process.env.PYTHON || 'python', [...prefix, command], { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const value = JSON.parse(run.stdout.trim());
    assert.equal(value.status, 'PASS');
    assert.equal(value.outcomesAccessed, false);
    if (command === 'verify') {
      assert.equal(value.milestones, 6);
      assert.equal(value.autonomousNextActions, 3);
      assert.equal(value.originalV4GreenOfficialGates, 2);
      assert.equal(value.originalV4OfficialGateCount, 13);
    } else {
      assert.deepEqual(new Set(Object.values(value.kills)), new Set([true]));
    }
  }
}

console.log('verify-continuous-free-source-operational-resume-v1.test.js: PASS');
