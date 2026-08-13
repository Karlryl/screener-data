#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'early-detection-continuous-free-source-v19.py');
const contractPath = path.join(root, 'research', 'early-detection-v4', 'continuous-free-source-operational-state-contract-v19.json');
const EXPECTED_CONTRACT_RAW = 'ba35f9616cac19ca4b403533439d3fdf1a88d5d22fe786d573456996e1658cd8';
const EXPECTED_CONTROLLER_NORMALIZED = '843b8fae81fedefaa58a9f97f2c53dc1ddcc45934dbf66d03481e3685c209387';
const EXPECTED_TEST_NORMALIZED = 'bb4a9cd4d10161d0134d1fb8a02ce4ed50cf6d34804b992ecdc22b73881aec25';
const EXPECTED_EVENTS_RAW = 'c9851dca2c68582e0fd1a5fd9301d86e3bc18d5e968cb3b1b4d8d56f231edd1b';
const EXPECTED_STATE_RAW = 'a241a9e77d1f49e2741ebab3b7f21fdf0025f71730abe5c341a648b7c2caafee';
const EXPECTED_STATE_SELF = '73d0f6db6d8300c07bb8a7c079bfeb9b638aa36e39d2befde1f9c8c02978c5be';
const EXPECTED_PROJECTION_SHA = '35691ff8c61bfed20e6fae73647e02eca073d1bdbb23aa10311c981d9f0c0297';

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
  assert.equal(verified.v18RemoteVerified, true);
  assert.equal(verified.v18PrefixVerified, true);
  assert.equal(verified.consumerArtifactsRemoteVerified, 1);
  assert.equal(verified.milestoneGitDeltasVerified, 1);
  assert.equal(verified.eventCount, 7);
  assert.equal(verified.operationalMilestones, 29);
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

console.log('early-detection-continuous-free-source-v19.test.js: PASS');
