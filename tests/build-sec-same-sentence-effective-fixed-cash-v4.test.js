#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'build-sec-same-sentence-effective-fixed-cash-v4.py');
const contract = path.join(root, 'research', 'early-detection-v4', 'sec-same-sentence-effective-fixed-cash-contract-v4.json');
const output = path.join(root, 'reports', 'early-detection', 'sec-same-sentence-effective-fixed-cash-v4.json');
const EXPECTED_CONTRACT_RAW = '3e391d70c08c62b66fd48383af05efcb99bbbc6bec088686d514e67341a43747';
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
    if (command === 'self-test') {
      assert.deepEqual(new Set(Object.values(value.kills)), new Set([true]));
      for (const key of ['preferredStock', 'classAStock', 'numericClassAStock', 'depositaryShare', 'equityInterest', 'fractionalOrdinaryShare', 'securityBeforeCash', 'unrecognizedAdditionalTail']) assert.equal(value.kills[key], true);
    }
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
    assert.equal(value.verifiedRows, 11);
    assert.equal(value.outcomesAccessed, false);
  }
}
console.log('build-sec-same-sentence-effective-fixed-cash-v4.test.js: PASS');
