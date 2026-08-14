'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'early-detection-q010-sc004-methods-path-deferred-v1.py');
const CONTRACT = path.join(ROOT, 'research', 'early-detection-v4', 'q010-sc004-methods-path-deferred-governance-contract-v1.json');
const EVENTS = path.join(ROOT, 'state', 'early-detection-q010-sc004-methods-path-deferred-events-v1.jsonl');
const STATE = path.join(ROOT, 'state', 'early-detection-q010-sc004-methods-path-deferred-state-v1.json');
const EVENT_RAW_SHA256 = 'a8152fab07f21908e15f90de435ae3eb99c30c1b0965e5bc36d159c10d782371';
const NEXT = 'Q010-SC005-PRE2021-MULTITHEME-TEL-CORPUS-DECISION';
const sha256 = raw => crypto.createHash('sha256').update(raw).digest('hex');

function run(args, optimized = false, ok = true, env = process.env) {
  const result = spawnSync('python', [...(optimized ? ['-O'] : []), '-B', SCRIPT, ...args], {
    cwd: ROOT, encoding: 'utf8', windowsHide: true, env,
  });
  if (ok) {
    assert.equal(result.status, 0, `${args.join(' ')} failed: ${result.stderr}`);
  } else {
    assert.notEqual(result.status, 0, `${args.join(' ')} unexpectedly passed`);
    assert.match(result.stderr, /FAIL_CLOSED/);
  }
  return result;
}

function rejectDuplicateKeys(text) {
  let i = 0;
  const ws = () => { while (/\s/.test(text[i] || '')) i += 1; };
  const stringToken = () => {
    const start = i; assert.equal(text[i++], '"');
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; continue; }
      if (text[i++] === '"') return JSON.parse(text.slice(start, i));
    }
    throw new Error('unterminated JSON string');
  };
  const value = () => {
    ws();
    if (text[i] === '{') {
      i += 1; ws(); const keys = new Set();
      if (text[i] === '}') { i += 1; return; }
      while (true) {
        ws(); const key = stringToken();
        if (keys.has(key)) throw new Error(`duplicate JSON key: ${key}`);
        keys.add(key); ws(); assert.equal(text[i++], ':'); value(); ws();
        if (text[i] === '}') { i += 1; return; }
        assert.equal(text[i++], ',');
      }
    }
    if (text[i] === '[') {
      i += 1; ws(); if (text[i] === ']') { i += 1; return; }
      while (true) { value(); ws(); if (text[i] === ']') { i += 1; return; } assert.equal(text[i++], ','); }
    }
    if (text[i] === '"') { stringToken(); return; }
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));
    if (!token) throw new Error('invalid JSON token');
    i += token[0].length;
  };
  value(); ws(); assert.equal(i, text.length);
  return JSON.parse(text);
}

for (const optimized of [false, true]) {
  const self = JSON.parse(run(['self-test'], optimized).stdout);
  assert.equal(self.status, 'PASS');
  assert.equal(self.nextSubchunkId, NEXT);
  assert.equal(self.sourceRequests, 0);
  assert.equal(self.aiRuns, 0);
  assert.equal(self.scientificCredit, 'NONE');
  const first = JSON.parse(run(['bootstrap'], optimized).stdout);
  const second = JSON.parse(run(['bootstrap'], optimized).stdout);
  assert.deepEqual(first, second);
  assert.equal(first.writePerformed, false);
  run(['verify'], optimized, false);
  const verified = JSON.parse(run(['verify', '--remote'], optimized).stdout);
  assert.ok(['PRE', 'POST'].includes(verified.phase));
  assert.equal(verified.status, verified.phase === 'POST' ? 'PASS' : 'METHODS_PATH_DEFERRED_PRE_INTRODUCTION_DIAGNOSTIC');
  assert.equal(verified.nextAuthorized, verified.phase === 'POST');
  assert.equal(verified.startAuthorized, false);
  assert.equal(verified.sourceAccessAuthorized, false);
  assert.equal(verified.aiRunAuthorized, false);
  if (verified.phase === 'PRE') run(['next', '--remote'], optimized, false);
  for (const command of ['start','source','run','packet','open','aggregate','coding','ai-run']) {
    run([command, '--remote'], optimized, false);
  }
}

const redirected = run(['verify', '--remote'], false, false, {
  ...process.env,
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'url.https://example.invalid/redirected.git.insteadOf',
  GIT_CONFIG_VALUE_0: 'https://github.com/Karlryl/screener-data.git',
});
assert.match(redirected.stderr, /origin remote URL drift/);

const eventRaw = fs.readFileSync(EVENTS);
assert.equal(eventRaw.length, 2141);
assert.equal(sha256(eventRaw), EVENT_RAW_SHA256);
assert.equal(eventRaw[eventRaw.length - 1], 0x0a);
const event = rejectDuplicateKeys(eventRaw.toString('utf8').trimEnd());
assert.equal(event.eventId, 'Q010-SC004-DEFER-EVT-00000001');
assert.equal(event.eventType, 'METHODS_PATH_DEFERRED_DECISION_RECORDED');
assert.equal(event.payload.decisionStatus, 'DEFERRED_METHODS_EXPLORATION');
assert.equal(event.payload.aiRuns, 0);
assert.equal(event.payload.sourceRequests, 0);
assert.equal(event.payload.nextSubchunkId, NEXT);
assert.equal(event.payload.scientificCredit, 'NONE');
assert.equal(event.payload.originalV4GreenOfficialGates, 2);
assert.equal(event.payload.originalV4OfficialGateCount, 13);
assert.equal(event.payload.originalV4Protocol, 'FEM-SEC-US@1.2.0');
assert.equal(event.payload.originalV4Complete, false);
assert.equal(event.payload.originalV4ResultComputationAllowed, false);
assert.equal(event.payload.originalV4OutcomesAccessed, false);

const contract = rejectDuplicateKeys(fs.readFileSync(CONTRACT, 'utf8'));
assert.equal(contract.frozenStaticPolicySha256, 'ed31701e40b73ac2bc8f9a4976a9e40aeeb2a92875c844998e4232fb07ab2823');
assert.equal(contract.repository.expectedIntroductionSubject, 'Tag 922: Q010-SC004 AI-Methodenpfad pausieren');
assert.equal(contract.repository.expectedIntroductionPaths.length, 5);
assert.equal(contract.decision.decisionStatus, 'DEFERRED_METHODS_EXPLORATION');
assert.equal(contract.decision.workDisposition, 'NO_START');
assert.equal(contract.decision.originalV4GreenOfficialGates, 2);
assert.equal(contract.decision.originalV4OfficialGateCount, 13);
assert.equal(contract.decision.originalV4Protocol, 'FEM-SEC-US@1.2.0');
assert.equal(contract.decision.originalV4Complete, false);
assert.equal(contract.decision.originalV4ResultComputationAllowed, false);
assert.equal(contract.decision.originalV4OutcomesAccessed, false);
assert.equal(contract.decision.systemEstablished, false);
assert.equal(contract.decision.outcomeBlindClaimed, false);
assert.equal(contract.decision.prospectivePitVerified, false);
assert.equal(contract.decision.priceReturnGqsOutcomeAccessed, false);
assert.equal(contract.decision.sc004ResumeAuthorized, false);
assert.equal(contract.decision.toolFreeIsolationCapabilityStatus, 'NOT_MACHINE_VERIFIED_ESTABLISHED');
assert.equal(contract.decision.reasonCodes[1], 'TOOL_FREE_ISOLATION_NOT_MACHINE_VERIFIED_ESTABLISHED');
assert.equal(contract.decision.nextSubchunkId, NEXT);
assert.deepEqual(contract.decision.resumeOnlyAfterAll, ['CORE_CORPUS_EXISTS','STABLE_CODEBOOK_EXISTS','MACHINE_ENFORCEABLE_TOOL_MEMORY_EGRESS_ISOLATION_OR_HUMANS_AVAILABLE']);
assert.equal(contract.decision.currentTaskEndsAfterTag922CheckpointPostGates, true);
assert.equal(contract.priorV4GovernanceBinding.rawSha256, '29d40b8d2a34c8d2377b086ea92154ddbc41a72670bff79bd9b41922a1cb5297');
assert.equal(new Set(contract.parentTag921Binding.introducedBlobBindings.map(x => x.path)).size, 5);
assert.equal(contract.incumbentLocks.q003State, 'PAUSED_NONELIGIBLE');
assert.equal(contract.incumbentLocks.q004State, 'PAUSED_NONELIGIBLE');
assert.equal(contract.incumbentLocks.q005State, 'PAUSED_NONELIGIBLE');
assert.equal(contract.phasePolicy.preIntroductionNextAuthorized, false);
assert.equal(contract.phasePolicy.postIntroductionNextAuthorized, true);
assert.equal(contract.parentTag921Binding.committedAtUtc, '2026-08-14T05:32:18Z');
assert.equal(contract.phasePolicy.tag922CommitAtOrAfterDecisionRequired, true);

const state = rejectDuplicateKeys(fs.readFileSync(STATE, 'utf8'));
assert.equal(state.projection.contractCoreSha256, contract.contractCoreSha256);
assert.equal(state.projection.decisionStatus, 'DEFERRED_METHODS_EXPLORATION');
assert.equal(state.projection.nextSubchunkId, NEXT);
assert.equal(state.projection.nextAuthorized, false);
assert.equal(state.projection.startAuthorized, false);
assert.equal(state.projection.sourceAccessAuthorized, false);
assert.equal(state.projection.aiRunAuthorized, false);
assert.equal(state.projection.priceReturnGqsOutcomeAccessed, false);
assert.equal(state.projection.decisionEffectiveOnlyAfterRemoteIntroduction, true);
assert.equal(state.projection.sc004ResumeAuthorized, false);
assert.equal(state.projection.toolFreeIsolationCapabilityStatus, 'NOT_MACHINE_VERIFIED_ESTABLISHED');
assert.deepEqual(state.projection.reasonCodes, contract.decision.reasonCodes);
assert.deepEqual(state.projection.resumeOnlyAfterAll, contract.decision.resumeOnlyAfterAll);
assert.equal(state.projection.currentTaskEndsAfterTag922CheckpointPostGates, true);
assert.equal(state.projection.candidateState, null);
assert.equal(state.projection.scientificCredit, 'NONE');
assert.throws(() => rejectDuplicateKeys('{"startAuthorized":true,"startAuthorized":false}'), /duplicate JSON key/);

console.log(JSON.stringify({status:'PASS',suite:'early-detection-q010-sc004-methods-path-deferred',sourceRequests:0,aiRuns:0}));
