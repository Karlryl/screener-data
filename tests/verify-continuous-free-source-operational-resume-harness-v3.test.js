#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'verify-continuous-free-source-operational-resume-harness-v3.py');
const contract = path.join(root, 'research', 'early-detection-v4', 'continuous-free-source-operational-resume-harness-contract-v3.json');
const test = __filename;
const BUILD_BASE = '2d0b8ee0e1cf3d9fea6489d529b8bf85774bcfb9';
const EXPECTED_RAW = '84fc2a7aec9603193764104742735c36fe0da77be3b477411de6a50199ae4a5e';
const EXPECTED_SELF = '751fff7a32bede74696c011380e8f56b0525d14f778b7df37b7b4835b88a06c8';
const EXPECTED_SCRIPT_NORMALIZED = '7bcaf079510a32bcc2a4387b461692d6eafd6da94f327fb37e18a16c05a5f6b6';
const EXPECTED_TEST_NORMALIZED = '2948f4565aef0064cc2a4eb914da20c3fe91b0f9d67a2aa45e1bdc716054253e';

function sha(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalized(file) {
  let raw = fs.readFileSync(file, 'utf8');
  for (const token of [EXPECTED_SCRIPT_NORMALIZED, EXPECTED_TEST_NORMALIZED]) {
    raw = raw.split(token).join('0'.repeat(64));
  }
  return sha(Buffer.from(raw, 'utf8'));
}

function git(...args) {
  const run = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return run.stdout.trim();
}

const raw = fs.readFileSync(contract);
assert.equal(sha(raw), EXPECTED_RAW);
const value = JSON.parse(raw);
const claim = value.contractSha256;
delete value.contractSha256;
assert.equal(claim, EXPECTED_SELF);
assert.equal(sha(Buffer.from(canonical(value), 'utf8')), EXPECTED_SELF);
assert.equal(normalized(script), EXPECTED_SCRIPT_NORMALIZED);
assert.equal(normalized(test), EXPECTED_TEST_NORMALIZED);

const head = git('rev-parse', 'HEAD');
const expectedPhase = head === BUILD_BASE ? 'PRE_INTRODUCTION' : 'POST_INTRODUCTION';
if (expectedPhase === 'POST_INTRODUCTION') {
  const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', BUILD_BASE, head], { cwd: root, windowsHide: true });
  assert.equal(ancestry.status, 0);
}

const expectedKills = [
  'authorizedPathOrder',
  'lineageParent',
  'originalV4GateCredit',
  'outcomeAccess',
  'providerMilestones',
  'providerPhase',
  'remoteRef',
  'remoteUrl',
  'sourceBuildBase',
  'v2ContractHash',
  'v2TestBlob',
  'v2VerifierHash',
];

for (const optimized of [false, true]) {
  const prefix = optimized ? ['-O', '-B', script] : ['-B', script];
  for (const command of ['verify', 'self-test']) {
    const run = spawnSync(process.env.PYTHON || 'python', [...prefix, command, '--remote'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const result = JSON.parse(run.stdout.trim());
    assert.equal(result.status, 'PASS');
    assert.equal(result.phase, expectedPhase);
    assert.equal(result.outcomesAccessed, false);
    if (command === 'verify') {
      assert.equal(result.v2ProviderRuns, 2);
      assert.equal(result.v2ProviderPhase, 'POST_INTRODUCTION');
      assert.equal(result.v2Milestones, 9);
      assert.equal(result.originalV4GreenOfficialGates, 2);
      assert.equal(result.originalV4OfficialGateCount, 13);
    } else {
      assert.deepEqual(Object.keys(result.kills).sort(), expectedKills);
      assert.deepEqual(new Set(Object.values(result.kills)), new Set([true]));
    }
  }
}

console.log('verify-continuous-free-source-operational-resume-harness-v3.test.js: PASS');
