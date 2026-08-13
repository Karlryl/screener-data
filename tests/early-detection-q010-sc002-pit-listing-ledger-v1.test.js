'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const controller = path.join(root, 'scripts', 'early-detection-q010-sc002-pit-listing-ledger-v1.py');

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
  assert.equal(self.kills, 105);
  assert.equal(self.controllerChildExecutions, 0);

  run(['verify'], optimized, false);
  const verified = JSON.parse(run(['verify', '--remote'], optimized).stdout);
  assert.ok(['START_PRE_INTRODUCTION_DIAGNOSTIC', 'PASS'].includes(verified.status));
  assert.ok(['START_PRE_INTRODUCTION', 'START_POST_INTRODUCTION'].includes(verified.phase));
  const introduced = verified.phase === 'START_POST_INTRODUCTION';
  assert.equal(verified.subchunkId, 'Q010-SC-002-PIT-LISTING-ENTITY-LEDGER-2015');
  assert.equal(verified.decisionRecorded, true);
  assert.equal(verified.preChunkTimingClaimRecorded, true);
  assert.equal(verified.preChunkTimingVerified, true);
  assert.equal(verified.prospectiveDecisionRemoteIntroductionVerified, true);
  assert.equal(verified.startEventRecorded, true);
  assert.equal(verified.prospectiveStartRemoteIntroductionVerified, introduced);
  assert.equal(verified.workStarted, introduced);
  assert.equal(verified.startAuthorized, introduced);
  assert.equal(verified.researchSourceAccessAuthorized, introduced);
  assert.equal(verified.firstResearchSourceRetrievedAtUtc, null);
  assert.equal(verified.controlMatchingAllowed, false);
  assert.equal(verified.telCodingAllowed, false);
  assert.equal(verified.candidateStateComputationAllowed, false);
  assert.equal(verified.pricesAccessed, false);
  assert.equal(verified.returnsAccessed, false);
  assert.equal(verified.gqsAccessed, false);
  assert.equal(verified.outcomesAccessed, false);
  assert.equal(verified.scientificCredit, 'NONE');
  assert.equal(verified.q003SchedulerEligible, false);
  assert.equal(verified.earlyDetectionSystemBuilt, false);
  assert.equal(verified.sc001BlindingIncidentRemainsEffective, true);
  assert.equal(verified.sc001ChunkStatus, 'TYPED_HOLD_COMPLETED');
  assert.equal(verified.sc001IncidentId, 'Q010-SC001-INCIDENT-0001');
  assert.equal(verified.sc001CandidateState, null);
  assert.equal(verified.sc001ScientificCredit, 'NONE');
  assert.equal(verified.sc001BlindingRemediationStillRequired, true);
  assert.match(verified.frozenGovernanceProjectionSha256, /^[0-9a-f]{64}$/);
  assert.equal(verified.controllerChildExecutions, 0);
  if (introduced) {
    assert.equal(verified.status, 'PASS');
    assert.match(verified.introductionCommit, /^[0-9a-f]{40}$/);
    assert.match(verified.startRemoteObservedAtUtc, /^\d{4}-\d{2}-\d{2}T/);
    const started = JSON.parse(run(['start', '--remote'], optimized).stdout);
    assert.equal(started.researchSourceAccessAuthorized, true);
  } else {
    assert.equal(verified.status, 'START_PRE_INTRODUCTION_DIAGNOSTIC');
    assert.equal(verified.introductionCommit, null);
    assert.equal(verified.startRemoteObservedAtUtc, null);
    run(['start', '--remote'], optimized, false);
  }
}

console.log('early-detection-q010-sc002-pit-listing-ledger-v1.test.js: PASS');
