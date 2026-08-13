#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'early-detection-continuous-free-source-v16.py');
const contractPath = path.join(root, 'research', 'early-detection-v4', 'continuous-free-source-operational-state-contract-v16.json');
const EXPECTED_CONTRACT_RAW = '5814a37795ac02095dc68f7ac75f0a6d43e14c6b15851f6360224980f1b07a7c';
const EXPECTED_CONTROLLER_NORMALIZED = '672eacd25459f73e5a5edf25570c3404df6aa5c21651b5d7c1a0ab8c7dd27b2c';
const EXPECTED_TEST_NORMALIZED = '02021a6d8999c72d0a8725997b1e8bbbd64910edc90139a61d738313d7876354';
const EXPECTED_EVENTS_RAW = '6a8913a5b3477291cfe7eaa71b7f868f2c96faf956b07378b12ef861cd141aae';
const EXPECTED_STATE_RAW = 'fbd2129a2e2c4aa5eb479412cb493529942d0552d5b310fccc243ffe357725f2';
const EXPECTED_STATE_SELF = '1c8c080ea5b1ec16742d195a8be464e8f47efc44f5aee52c3d7d99c316d7d326';
const EXPECTED_PROJECTION_SHA = '4616098cded1347f856de4c62f49f7e37adcc87b587e546e8e0c1a2e94ca0fb1';

const sha = raw => crypto.createHash('sha256').update(raw).digest('hex');

function normalizedTest(raw) {
  let text = raw.toString('utf8');
  for (const name of ['EXPECTED_CONTRACT_RAW','EXPECTED_CONTROLLER_NORMALIZED','EXPECTED_TEST_NORMALIZED','EXPECTED_EVENTS_RAW','EXPECTED_STATE_RAW','EXPECTED_STATE_SELF','EXPECTED_PROJECTION_SHA']) {
    text = text.replace(new RegExp(`(const ${name}\\s*=\\s*')[^']+('\\s*;)`), `$1${name}_NORMALIZED$2`);
  }
  return sha(Buffer.from(text));
}

function run(args, optimized = false, success = true) {
  const result = spawnSync(process.env.PYTHON || 'python', [...(optimized ? ['-O','-B'] : ['-B']), script, ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  if (!success) { assert.notEqual(result.status, 0, 'command unexpectedly succeeded'); return result; }
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

assert.equal(sha(fs.readFileSync(contractPath)), EXPECTED_CONTRACT_RAW);
assert.equal(normalizedTest(fs.readFileSync(__filename)), EXPECTED_TEST_NORMALIZED);

for (const optimized of [false, true]) {
  const tested = run(['self-test'], optimized);
  assert.equal(tested.status, 'PASS');
  assert.equal(tested.killCount, 13);
  assert.ok(Object.values(tested.kills).every(Boolean));
  run(['verify'], optimized, false);
  run(['next'], optimized, false);
  const verified = run(['verify','--remote'], optimized);
  assert.equal(verified.remoteVerified, true);
  assert.equal(verified.v15RemoteVerified, true);
  assert.equal(verified.v14PrefixVerified, true);
  assert.equal(verified.milestoneGitDeltasVerified, 10);
  assert.equal(verified.operationalMilestones, 20);
  assert.equal(verified.newMilestones, 10);
  assert.equal(verified.tasksConserved, 10);
  assert.equal(verified.resolvedTasks, 0);
  assert.equal(verified.nextTaskId, 'Q003-SEC-TERMINAL-WEALTH-QUEUE');
  assert.equal(verified.outcomesAccessed, false);
  if (verified.phase === 'PRE_INTRODUCTION') {
    assert.equal(verified.status, 'PRE_INTRODUCTION_DIAGNOSTIC');
    assert.equal(verified.controllerResumeAllowed, false);
    run(['next','--remote'], optimized, false);
  } else {
    assert.equal(verified.phase, 'POST_INTRODUCTION');
    assert.equal(verified.controllerResumeAllowed, true);
    const next = run(['next','--remote'], optimized);
    assert.equal(next.nextTaskId, 'Q003-SEC-TERMINAL-WEALTH-QUEUE');
    assert.equal(next.outcomesAccessed, false);
  }
}

console.log('early-detection-continuous-free-source-v16.test.js: PASS');
