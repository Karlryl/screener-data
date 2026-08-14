'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const controller = path.join(root, 'scripts', 'early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-v1.py');
const statePath = path.join(root, 'state', 'early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-state-v1.json');
const controllerText = readFileSync(controller, 'utf8');

for (const requiredSurface of [
  'MoveFileExW', 'MOVEFILE_WRITE_THROUGH', 'FILE_FLAG_BACKUP_SEMANTICS', 'FlushFileBuffers',
  'exclusive_runtime_mutex', 'assert_durable_query_barrier', 'replay_private_ledger',
  'HOLD_COHERENTLY_REHASHED_RUN_STATE_NOT_EXACT_LEDGER_REPLAY',
  'preCompletionEventBinding', 'receiptManifestSha256', 'projectionHeadSha256',
  'HOLD_LOCATOR_HTTP_STATUS_NOT_EXACT_200', 'HOLD_RESPONSE_HEADER_PROJECTION_NOT_REPLAYABLE_FROM_EVENT',
  'HOLD_OPAQUE_PROJECTION_NOT_EXACT_DETERMINISTIC_REPLAY',
  'material_join_binding', 'INCIDENT_MISMATCH_BOUND',
  'responseBlobReferenceMultiset', 'responseBlobReferenceIntegrity',
  'early-detection-q010-sc003-material-join-binding/v3',
  'early-detection-q010-sc003-pre-completion-event-binding/v2',
]) assert.ok(controllerText.includes(requiredSurface), `missing P0 surface ${requiredSurface}`);

function run(args, optimized = false, ok = true) {
  const py = optimized ? ['-O', '-B', controller, ...args] : ['-B', controller, ...args];
  const r = spawnSync('python', py, { cwd: root, encoding: 'utf8', timeout: 90000 });
  assert.equal(r.error, undefined, `spawn error: ${r.error && r.error.message}`);
  assert.notEqual(r.status, null, 'process timed out');
  if (ok) assert.equal(r.status, 0, r.stderr || r.stdout);
  else assert.notEqual(r.status, 0, 'expected fail-closed rejection');
  return r;
}

for (const optimized of [false, true]) {
  const self = JSON.parse(run(['self-test'], optimized).stdout);
  assert.equal(self.status, 'PASS');
  assert.equal(self.kills, 118);
  assert.equal(self.controllerChildExecutions, 0);
  assert.equal(self.sourceRequests, 0);
  assert.equal(self.resumeCrashCases, 11);
  assert.equal(self.p0RuntimeFixtures, 45);

  run(['verify'], optimized, false);
  const verified = JSON.parse(run(['verify', '--remote'], optimized).stdout);
  assert.ok(['START_PRE_INTRODUCTION', 'START_POST_INTRODUCTION'].includes(verified.phase));
  const introduced = verified.phase === 'START_POST_INTRODUCTION';
  assert.equal(verified.status, introduced ? 'PASS' : 'START_PRE_INTRODUCTION_DIAGNOSTIC');
  assert.equal(verified.subchunkId, 'Q010-SC-003-DMV7-BALANCED-TEL-RAW-CAPTURE');
  assert.equal(verified.workClass, 'CORE_SOURCE_CORPUS_CAPTURE');
  assert.equal(verified.populationCount, 7);
  assert.equal(verified.captureUnitCount, 15);
  assert.equal(verified.targetDimensions.join(','), 'T,E,L');
  assert.equal(verified.decisionRecorded, true);
  assert.equal(verified.decisionRemoteIntroductionVerified, true);
  assert.equal(verified.startRemoteIntroductionVerified, introduced);
  assert.equal(verified.workStarted, true);
  assert.equal(verified.workStartedAtUtc, '2026-08-14T01:34:34.454637Z');
  assert.equal(verified.researchSourceAccessAuthorized, false);
  assert.equal(verified.runtimeResearchSourceAccessAuthorized, introduced);
  assert.equal(verified.codingAllowed, false);
  assert.equal(verified.candidateState, null);
  assert.equal(verified.futureSourceRecordStatus, 'NOT_CREATED_PENDING_SEPARATE_BLIND_DECISION');
  assert.equal(verified.sourceRecordCount, 0);
  assert.equal(verified.controlMatchingAllowed, false);
  assert.equal(verified.scientificCredit, 'NONE');
  assert.equal(verified.nextQ010SubchunkAuthorized, false);
  assert.equal(verified.q003SchedulerEligible, false);
  assert.equal(verified.sc001IncidentRemainsEffective, true);
  assert.equal(verified.sc002IncidentRemainsEffective, true);
  assert.equal(verified.earlyDetectionSystemBuilt, false);
  assert.equal(verified.controllerChildExecutions, 0);
  run(['start', '--remote'], optimized, introduced);
  if (!introduced) {
    run(['run', '--remote'], optimized, false);
    run(['source', '--remote'], optimized, false);
  }
}

const state = JSON.parse(readFileSync(statePath, 'utf8'));
assert.equal(state.eventCount, 2);
assert.equal(state.projection.decisionRemoteIntroductionVerified, true);
assert.equal(state.projection.startRemoteIntroductionVerified, false);
assert.equal(state.projection.workStarted, true);
assert.equal(state.projection.workStartedAtUtc, '2026-08-14T01:34:34.454637Z');
assert.equal(state.projection.researchSourceAccessAuthorized, false);
assert.equal(state.projection.codingAllowed, false);
assert.equal(state.projection.candidateState, null);
assert.equal(state.projection.futureSourceRecordStatus, 'NOT_CREATED_PENDING_SEPARATE_BLIND_DECISION');
assert.equal(state.projection.sourceRecordCount, 0);
assert.equal(state.projection.scientificCredit, 'NONE');
assert.equal(state.projection.captureUnitCount, 15);

console.log('early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-v1.test.js: PASS');
