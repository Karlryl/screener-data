'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const controller = path.join(root, 'scripts', 'early-detection-q010-sc002-pit-listing-ledger-v1.py');
const statePath = path.join(root, 'state', 'early-detection-q010-sc002-pit-listing-ledger-state-v1.json');

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
  assert.equal(self.kills, 135);
  assert.equal(self.controllerChildExecutions, 0);

  run(['verify'], optimized, false);
  const verified = JSON.parse(run(['verify', '--remote'], optimized).stdout);
  assert.ok(['COMPLETION_PRE_INTRODUCTION_DIAGNOSTIC', 'PASS'].includes(verified.status));
  assert.ok(['COMPLETION_PRE_INTRODUCTION', 'COMPLETION_POST_INTRODUCTION'].includes(verified.phase));
  const introduced = verified.phase === 'COMPLETION_POST_INTRODUCTION';
  assert.equal(verified.subchunkId, 'Q010-SC-002-PIT-LISTING-ENTITY-LEDGER-2015');
  assert.equal(verified.decisionRecorded, true);
  assert.equal(verified.preChunkTimingClaimRecorded, true);
  assert.equal(verified.preChunkTimingVerified, true);
  assert.equal(verified.prospectiveDecisionRemoteIntroductionVerified, true);
  assert.equal(verified.startEventRecorded, true);
  assert.equal(verified.prospectiveStartRemoteIntroductionVerified, true);
  assert.equal(verified.completionEventRecorded, true);
  assert.equal(verified.completionRemoteIntroductionVerified, introduced);
  assert.equal(verified.workStarted, true);
  assert.equal(verified.startAuthorized, false);
  assert.equal(verified.researchSourceAccessAuthorized, false);
  assert.equal(verified.firstResearchSourceRetrievedAtUtc, null);
  assert.equal(verified.chunkStatus, 'TYPED_GLOBAL_HOLD_COMPLETED');
  assert.equal(verified.controlFrameStatus, 'GLOBAL_TYPED_HOLD');
  assert.equal(verified.globalHoldReason, 'HOLD_OFFICIAL_LISTING_UNIVERSE_INCOMPLETE');
  assert.equal(verified.controlFrameUsable, false);
  assert.equal(verified.acceptedPrimaryPayloadCount, 0);
  assert.equal(verified.locatorQueriesConsumed, 12);
  assert.equal(verified.queryGranularTimestampsRecorded, false);
  assert.equal(verified.prospectiveLocatorTimingMachineVerified, false);
  assert.equal(verified.locatorTimingIncidentOccurred, true);
  assert.equal(verified.locatorTimingIncidentId, 'Q010-SC002-INCIDENT-0001');
  assert.equal(verified.locatorFindingsEpistemicUse, 'OPERATIONAL_STOP_ONLY_NO_LEDGER_SIGNAL_CANDIDATE_OR_SCIENTIFIC_CREDIT');
  assert.equal(verified.completionEventCreatedAtMeaning, 'COMPLETION_RECORD_TIME_NOT_QUERY_PROBE_OR_RETRIEVAL_TIME');
  assert.equal(verified.locatorFindingsAreNotAcceptedResearchPayloads, true);
  assert.equal(verified.sideProjectStopCriterionTriggered, true);
  assert.equal(verified.nextQ010SubchunkAuthorized, false);
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
    assert.match(verified.completionRemoteObservedAtUtc, /^\d{4}-\d{2}-\d{2}T/);
    run(['start', '--remote'], optimized, false);
  } else {
    assert.equal(verified.status, 'COMPLETION_PRE_INTRODUCTION_DIAGNOSTIC');
    assert.equal(verified.introductionCommit, null);
    assert.equal(verified.completionRemoteObservedAtUtc, null);
    run(['start', '--remote'], optimized, false);
  }
}

const replayState = JSON.parse(require('node:fs').readFileSync(statePath, 'utf8'));
assert.equal(replayState.projection.prospectiveStartRemoteIntroductionVerified, true);
assert.equal(replayState.projection.workStarted, true);
assert.equal(replayState.projection.workStartedAt, '2026-08-13T23:26:22.7404680Z');
assert.equal(replayState.projection.startAuthorized, false);
assert.equal(replayState.projection.researchSourceAccessAuthorized, false);
assert.equal(replayState.projection.scientificCredit, 'NONE');

console.log('early-detection-q010-sc002-pit-listing-ledger-v1.test.js: PASS');
