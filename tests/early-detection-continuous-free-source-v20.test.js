#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'early-detection-continuous-free-source-v20.py');
const contractPath = path.join(root, 'research', 'early-detection-v4', 'continuous-free-source-operational-state-contract-v20.json');
const EXPECTED_CONTRACT_RAW = '4d3003d800fcc008d09c8c5580864f3c785f25cc7d053ba2d8f51754f29e6a48';
const EXPECTED_CONTROLLER_NORMALIZED = '7ad2ad192146411ed8d5902f0f1424b70eb659028883c5dd09b2520d6a87ac1d';
const EXPECTED_TEST_NORMALIZED = 'c158fc4649be5bd5f1b628dd6ce7a973648bd5da822095c20dd96174a660b77a';
const EXPECTED_EVENTS_RAW = '5fdcf15b333ef319bfc69c297d927a42d8a27dcb688327583d555c0a04f8650a';
const EXPECTED_STATE_RAW = '44e9b09497040481b78739cb2fed6af3e6f097c559e4f962790b798317cce11e';
const EXPECTED_STATE_SELF = '96a5bc6e1635a25627c610cc0a122a802c7f421fc03ebf7523b596ee9bcda9b8';
const EXPECTED_PROJECTION_SHA = 'bb16321ece1bbbc3353c86f234fbbe0dedb9bc4bff8192d4464d5d5f6c3dfabf';

const sha = raw => crypto.createHash('sha256').update(raw).digest('hex');

function normalizedTest(raw) {
  let text = raw.toString('utf8').replace(/\r\n/g, '\n');
  for (const name of ['EXPECTED_CONTRACT_RAW','EXPECTED_CONTROLLER_NORMALIZED','EXPECTED_TEST_NORMALIZED','EXPECTED_EVENTS_RAW','EXPECTED_STATE_RAW','EXPECTED_STATE_SELF','EXPECTED_PROJECTION_SHA']) {
    text = text.replace(new RegExp(`(const ${name}\\s*=\\s*')[^']+('\\s*;)`), `$1${name}_NORMALIZED$2`);
  }
  return sha(Buffer.from(text));
}

function run(args, optimized = false, success = true) {
  const result = spawnSync(process.env.PYTHON || 'python', [...(optimized ? ['-O','-B'] : ['-B']), script, ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, timeout: 600000,
  });
  if (!success) {
    assert.notEqual(result.status, 0, `command unexpectedly succeeded: ${args.join(' ')}`);
    return result;
  }
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

assert.equal(sha(fs.readFileSync(contractPath)), EXPECTED_CONTRACT_RAW);
assert.equal(normalizedTest(fs.readFileSync(__filename)), EXPECTED_TEST_NORMALIZED);

for (const optimized of [false, true]) {
  const tested = run(['self-test'], optimized);
  assert.equal(tested.status, 'PASS');
  assert.equal(tested.killCount, 20);
  assert.ok(Object.values(tested.kills).every(Boolean));
  run(['verify'], optimized, false);
  run(['next'], optimized, false);
  const verified = run(['verify','--remote'], optimized);
  assert.equal(verified.remoteVerified, true);
  assert.equal(verified.v19RemoteVerified, true);
  assert.equal(verified.v19PrefixVerified, true);
  assert.equal(verified.consumerArtifactsRemoteVerified, 1);
  assert.equal(verified.milestoneGitDeltasVerified, 1);
  assert.equal(verified.eventCount, 8);
  assert.equal(verified.operationalMilestones, 30);
  assert.equal(verified.newMilestones, 1);
  assert.equal(verified.tasksConserved, 10);
  assert.equal(verified.resolvedTasks, 0);
  assert.equal(verified.eligibleTasks, 4);
  assert.equal(verified.nextTaskId, 'Q003-SEC-TERMINAL-WEALTH-QUEUE');
  assert.equal(verified.originalV4GreenOfficialGates, 2);
  assert.equal(verified.originalV4OfficialGateCount, 13);
  assert.equal(verified.outcomesAccessed, false);
  if (verified.phase === 'PRE_INTRODUCTION') {
    assert.equal(verified.status, 'PRE_INTRODUCTION_DIAGNOSTIC');
    assert.equal(verified.controllerResumeAllowed, false);
    run(['next','--remote'], optimized, false);
  } else {
    assert.equal(verified.phase, 'POST_INTRODUCTION');
    assert.equal(verified.status, 'PASS');
    assert.equal(verified.controllerResumeAllowed, true);
    const next = run(['next','--remote'], optimized);
    assert.equal(next.nextTaskId, 'Q003-SEC-TERMINAL-WEALTH-QUEUE');
    assert.equal(next.remoteVerified, true);
    assert.equal(next.outcomesAccessed, false);
  }
}

console.log('early-detection-continuous-free-source-v20.test.js: PASS');
