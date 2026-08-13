#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'early-detection-continuous-free-source-v17.py');
const contractPath = path.join(root, 'research', 'early-detection-v4', 'continuous-free-source-operational-state-contract-v17.json');
const EXPECTED_CONTRACT_RAW = '4b0b9e4e5ecd3d6c24ff7e3777ed9c1c688e8c2982b1881dab0ca1f1a856ed59';
const EXPECTED_CONTROLLER_NORMALIZED = 'f8960a5c9f8fc85f4d07855f34c03de1e996af65ef667f2016882a78cc53d069';
const EXPECTED_TEST_NORMALIZED = '409213b1cdeff3db2155c32e335c0c3c81874399009246458843035449d8ac38';
const EXPECTED_EVENTS_RAW = '8652d2964a8c474c1951cf6e519a6783d410262fc3c2ef47f743f2074d6b7773';
const EXPECTED_STATE_RAW = 'b6bed7c9b176666039339c28cd3e842d38612e60781a81bfa4139e1a8bb1fde9';
const EXPECTED_STATE_SELF = 'fe4855dbfbc7090bf45d94cd714926cb22f681215790f5580e40a908f5247ebe';
const EXPECTED_PROJECTION_SHA = '35462c0b427c0ee1f23939eac68a65b44db7c62737f0819a3a12b2259a3302fc';

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
  assert.equal(verified.v16RemoteVerified, true);
  assert.equal(verified.v16PrefixVerified, true);
  assert.equal(verified.milestoneGitDeltasVerified, 3);
  assert.equal(verified.operationalMilestones, 23);
  assert.equal(verified.newMilestones, 3);
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

console.log('early-detection-continuous-free-source-v17.test.js: PASS');
