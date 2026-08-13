#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'early-detection-continuous-free-source-v15.py');
const contractPath = path.join(root, 'research', 'early-detection-v4', 'continuous-free-source-operational-controller-contract-v15.json');
const EXPECTED_CONTRACT_RAW = 'db39ed1fa5641b5eb57879975faa5dfff57dcfa691d9dfde1a5ce23033754372';
const EXPECTED_CONTROLLER_NORMALIZED = '7c02fb5cf902029b21764c842427dc226c9674973489f8e258fc0c16f42314df';
const EXPECTED_TEST_NORMALIZED = 'd87154d26faaf8ce2a90ce7a52d7fd9e10aef66b74d7a091b69a7a645bc012fc';

const sha = raw => crypto.createHash('sha256').update(raw).digest('hex');

function normalizedTest(raw) {
  let text = raw.toString('utf8');
  for (const name of ['EXPECTED_CONTRACT_RAW', 'EXPECTED_CONTROLLER_NORMALIZED', 'EXPECTED_TEST_NORMALIZED']) {
    text = text.replace(new RegExp(`(const ${name}\\s*=\\s*')[^']+('\\s*;)`), `$1${name}_NORMALIZED$2`);
  }
  return sha(Buffer.from(text));
}

function run(args, optimized = false, success = true) {
  const prefix = optimized ? ['-O', '-B'] : ['-B'];
  const result = spawnSync(process.env.PYTHON || 'python', [...prefix, script, ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  if (!success) {
    assert.notEqual(result.status, 0, 'command unexpectedly succeeded');
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
  assert.equal(tested.killCount, 10);
  assert.ok(Object.values(tested.kills).every(Boolean));
  assert.equal(tested.outcomesAccessed, false);

  run(['verify'], optimized, false);
  run(['next'], optimized, false);

  const verified = run(['verify', '--remote'], optimized);
  assert.equal(verified.remoteVerified, true);
  assert.equal(verified.v14IntroductionCommit, 'eca62f4260e940eff70ab8f17ada26c1fd57ab48');
  assert.equal(verified.v14IntroductionLocatedBelowCurrentHead, true);
  assert.equal(verified.v14StateReplayVerified, true);
  assert.equal(verified.tasksConserved, 10);
  assert.equal(verified.resolvedTasks, 0);
  assert.equal(verified.nextTaskId, 'Q003-SEC-TERMINAL-WEALTH-QUEUE');
  assert.equal(verified.originalV4GreenOfficialGates, 2);
  assert.equal(verified.originalV4OfficialGateCount, 13);
  assert.equal(verified.outcomesAccessed, false);
  if (verified.phase === 'PRE_INTRODUCTION') {
    assert.equal(verified.status, 'PRE_INTRODUCTION_DIAGNOSTIC');
    assert.equal(verified.controllerResumeAllowed, false);
    run(['next', '--remote'], optimized, false);
  } else {
    assert.equal(verified.phase, 'POST_INTRODUCTION');
    assert.equal(verified.controllerResumeAllowed, true);
    const next = run(['next', '--remote'], optimized);
    assert.equal(next.nextTaskId, 'Q003-SEC-TERMINAL-WEALTH-QUEUE');
    assert.equal(next.postIntroductionVerified, true);
    assert.equal(next.outcomesAccessed, false);
  }
}

console.log('early-detection-continuous-free-source-v15.test.js: PASS');
