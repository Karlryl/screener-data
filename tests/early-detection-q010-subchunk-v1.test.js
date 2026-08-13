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
  assert.equal(self.kills, 37);
  assert.equal(self.controllerChildExecutions, 0);

  run(['verify'], optimized, false);
  const verified = JSON.parse(run(['verify', '--remote'], optimized).stdout);
  assert.ok(['START_PRE_INTRODUCTION_DIAGNOSTIC', 'PASS'].includes(verified.status));
  assert.ok(['START_PRE_INTRODUCTION', 'START_POST_INTRODUCTION'].includes(verified.phase));
  assert.equal(verified.subchunkId, 'Q010-SC-001-CA-DMV-AV-2015-CENSUS-TEL');
  assert.equal(verified.decisionRecorded, true);
  assert.equal(verified.preChunkTimingClaimRecorded, true);
  assert.equal(verified.preChunkTimingVerified, true);
  assert.equal(verified.prospectiveRemoteIntroductionVerified, true);
  const started = verified.phase === 'START_POST_INTRODUCTION';
  assert.equal(verified.workStarted, started);
  assert.equal(verified.startAuthorized, started);
  assert.equal(verified.researchSourceAccessAuthorized, started);
  if (started) assert.equal(verified.workStartedAt, '2026-08-13T21:15:08Z');
  else assert.equal(verified.workStartedAt, null);
  assert.equal(verified.scientificCredit, 'NONE');
  assert.equal(verified.pricesReturnsOutcomesAccessed, false);
  assert.equal(verified.controllerChildExecutions, 0);
  assert.equal(verified.v23TaskLevelAuthorizationCannotAuthorizeConcreteSubchunkStart, true);
  assert.equal(verified.startEventRemoteIntroductionVerified, started);
  if (verified.phase === 'START_PRE_INTRODUCTION') {
    assert.equal(verified.status, 'START_PRE_INTRODUCTION_DIAGNOSTIC');
    assert.equal(verified.introductionCommit, null);
    run(['start', '--remote'], optimized, false);
  } else {
    assert.equal(verified.status, 'PASS');
    assert.match(verified.introductionCommit, /^[0-9a-f]{40}$/);
    const startedResult = JSON.parse(run(['start', '--remote'], optimized).stdout);
    assert.equal(startedResult.startAuthorized, true);
  }
}

console.log('early-detection-q010-subchunk-v1.test.js: PASS');
