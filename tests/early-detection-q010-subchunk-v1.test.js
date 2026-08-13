'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const controller = path.join(root, 'scripts', 'early-detection-q010-subchunk-v1.py');

function run(args, optimized = false, ok = true) {
  const pythonArgs = optimized ? ['-O', '-B', controller, ...args] : ['-B', controller, ...args];
  const r = spawnSync('python', pythonArgs, { cwd: root, encoding: 'utf8', timeout: 90000 });
  assert.equal(r.error, undefined, `spawn error: ${r.error && r.error.message}`);
  assert.notEqual(r.status, null, 'process timed out');
  if (ok) assert.equal(r.status, 0, r.stderr || r.stdout);
  else assert.notEqual(r.status, 0, 'expected fail-closed rejection');
  return r;
}

for (const optimized of [false, true]) {
  const self = JSON.parse(run(['self-test'], optimized).stdout);
  assert.equal(self.status, 'PASS');
  assert.equal(self.kills, 34);
  assert.equal(self.controllerChildExecutions, 0);

  run(['verify'], optimized, false);
  const verified = JSON.parse(run(['verify', '--remote'], optimized).stdout);
  assert.ok(['PRE_INTRODUCTION_DIAGNOSTIC', 'PASS'].includes(verified.status));
  assert.ok(['PRE_INTRODUCTION', 'POST_INTRODUCTION'].includes(verified.phase));
  assert.equal(verified.subchunkId, 'Q010-SC-001-CA-DMV-AV-2015-CENSUS-TEL');
  assert.equal(verified.decisionRecorded, true);
  assert.equal(verified.preChunkTimingClaimRecorded, true);
  assert.equal(verified.preChunkTimingVerified, verified.phase === 'POST_INTRODUCTION');
  assert.equal(verified.prospectiveRemoteIntroductionVerified, verified.phase === 'POST_INTRODUCTION');
  assert.equal(verified.workStarted, false);
  assert.equal(verified.startAuthorized, false);
  assert.equal(verified.researchSourceAccessAuthorized, false);
  assert.equal(verified.scientificCredit, 'NONE');
  assert.equal(verified.pricesReturnsOutcomesAccessed, false);
  assert.equal(verified.controllerChildExecutions, 0);
  assert.equal(verified.v23TaskLevelAuthorizationCannotAuthorizeConcreteSubchunkStart, true);
  if (verified.phase === 'PRE_INTRODUCTION') {
    assert.equal(verified.status, 'PRE_INTRODUCTION_DIAGNOSTIC');
    assert.equal(verified.introductionCommit, null);
  } else {
    assert.equal(verified.status, 'PASS');
    assert.match(verified.introductionCommit, /^[0-9a-f]{40}$/);
  }
  run(['start', '--remote'], optimized, false);
}

console.log('early-detection-q010-subchunk-v1.test.js: PASS');
