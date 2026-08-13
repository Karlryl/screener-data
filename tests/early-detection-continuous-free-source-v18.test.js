#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'early-detection-continuous-free-source-v18.py');
const contractPath = path.join(root, 'research', 'early-detection-v4', 'continuous-free-source-operational-state-contract-v18.json');
const EXPECTED_CONTRACT_RAW = '37bf21c8a80c9904c1dc93a8729af8e757a934f9f6b87922389ac4a206f92492';
const EXPECTED_CONTROLLER_NORMALIZED = 'd23be82907248490576b8ec357c3f8c0a3fe71e5e2d39b573c026ab7f1a56b55';
const EXPECTED_TEST_NORMALIZED = 'fcb59960459ebcd2156e9375d5cc6fd7d2ba0ffca10e7c1b1e004d869eaf7058';
const EXPECTED_EVENTS_RAW = '715514032dd5cfd7fa570dc3e47a96d2be46ead4a8a969e14cb5c05521d6c01f';
const EXPECTED_STATE_RAW = '0d2b92c5b6ced877593878dba5cdd40d4690b4081ed83bb5d12f000ac2304f43';
const EXPECTED_STATE_SELF = 'b2bde4af82e9012dcc807787bb72ae587ea434445428947f880df57da71d25e0';
const EXPECTED_PROJECTION_SHA = 'dde9fb903ea61408c7b6840699cffc02a645a6195c0837842c0b4507a761b970';

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
  assert.equal(verified.v17RemoteVerified, true);
  assert.equal(verified.v17PrefixVerified, true);
  assert.equal(verified.consumerArtifactsRemoteVerified, 3);
  assert.equal(verified.milestoneGitDeltasVerified, 5);
  assert.equal(verified.operationalMilestones, 28);
  assert.equal(verified.newMilestones, 5);
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

console.log('early-detection-continuous-free-source-v18.test.js: PASS');
