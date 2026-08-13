#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'early-detection-continuous-free-source-v14.py');
const contractPath = path.join(root, 'research', 'early-detection-v4', 'continuous-free-source-operational-state-contract-v14.json');
const EXPECTED_CONTRACT_RAW = 'd4f5d53fb42edc192cf614b3910476b53140bf7432edb2225aa2e6584d966eff';
const EXPECTED_CONTROLLER_NORMALIZED = 'b457b13b95d3b5c198d3f87c528f5b9b777d8856b5c75f7553fc99160207eb08';
const EXPECTED_TEST_NORMALIZED = 'b93ea3c7e8f61f0e92e566f159904a9f48f562a7ed48f3dec9c7ec7c84da8878';

const sha = raw => crypto.createHash('sha256').update(raw).digest('hex');

function normalizedTest(raw) {
  let text = raw.toString('utf8');
  for (const name of ['EXPECTED_CONTRACT_RAW', 'EXPECTED_CONTROLLER_NORMALIZED', 'EXPECTED_TEST_NORMALIZED']) {
    text = text.replace(new RegExp(`(const ${name}\\s*=\\s*')[^']+('\\s*;)`), `$1${name}_NORMALIZED$2`);
  }
  return sha(Buffer.from(text));
}

function run(args, optimized = false, expectSuccess = true) {
  const command = optimized ? ['-O', '-B', script, ...args] : ['-B', script, ...args];
  const result = spawnSync('python', command, { cwd: root, encoding: 'utf8', windowsHide: true });
  if (expectSuccess) {
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  }
  assert.notEqual(result.status, 0, 'command unexpectedly succeeded');
  return result;
}

assert.equal(sha(fs.readFileSync(contractPath)), EXPECTED_CONTRACT_RAW);
assert.equal(normalizedTest(fs.readFileSync(__filename)), EXPECTED_TEST_NORMALIZED);

for (const optimized of [false, true]) {
  const tested = run(['self-test'], optimized);
  assert.equal(tested.status, 'PASS');
  assert.equal(tested.killCount, 19);
  assert.ok(Object.values(tested.kills).every(Boolean));
  assert.equal(tested.outcomesAccessed, false);

  run(['verify'], optimized, false);
  run(['next'], optimized, false);

  const verified = run(['verify', '--remote'], optimized);
  assert.equal(verified.remoteVerified, true);
  assert.equal(verified.tasksConserved, 10);
  assert.equal(verified.resolvedTasks, 0);
  assert.equal(verified.nextTaskId, 'Q003-SEC-TERMINAL-WEALTH-QUEUE');
  assert.equal(verified.q002AutoNext, false);
  assert.equal(verified.originalV4GreenOfficialGates, 2);
  assert.equal(verified.originalV4OfficialGateCount, 13);
  assert.equal(verified.outcomesAccessed, false);

  if (verified.phase === 'PRE_INTRODUCTION') {
    assert.equal(verified.status, 'PRE_INTRODUCTION_DIAGNOSTIC');
    assert.equal(verified.controllerResumeAllowed, false);
    run(['next', '--remote'], optimized, false);
  } else {
    assert.equal(verified.phase, 'POST_INTRODUCTION');
    assert.equal(verified.status, 'PASS');
    assert.equal(verified.controllerResumeAllowed, true);
    const next = run(['next', '--remote'], optimized);
    assert.equal(next.nextTaskId, 'Q003-SEC-TERMINAL-WEALTH-QUEUE');
    assert.equal(next.remoteVerified, true);
    assert.equal(next.postIntroductionVerified, true);
    assert.equal(next.outcomesAccessed, false);
  }
}

console.log('early-detection-continuous-free-source-v14.test.js: PASS');
