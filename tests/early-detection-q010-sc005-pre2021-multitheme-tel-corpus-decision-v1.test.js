'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'early-detection-q010-sc005-pre2021-multitheme-tel-corpus-decision-v1.py');
const CONTRACT = path.join(ROOT, 'research', 'early-detection-v4', 'q010-sc005-pre2021-multitheme-tel-corpus-decision-governance-contract-v1.json');
const EVENTS = path.join(ROOT, 'state', 'early-detection-q010-sc005-pre2021-multitheme-tel-corpus-decision-events-v1.jsonl');
const STATE = path.join(ROOT, 'state', 'early-detection-q010-sc005-pre2021-multitheme-tel-corpus-decision-state-v1.json');
const TEST = path.join(ROOT, 'tests', 'early-detection-q010-sc005-pre2021-multitheme-tel-corpus-decision-v1.test.js');

const TAG911 = 'ba90828892932147c93afe2040498116982bd416';
const TAG914 = '2d744159e4a001bfe1e2ff5b9d31113cbc347487';
const TAG922 = 'c40c879070ac05b1aac11ab7c8f52b1dcc8cc375';
const REMOTE_REF = 'refs/heads/codex/early-detection-v4-gates-20260810';
const NEXT = 'Q010-SC005-FREE-OFFICIAL-ROUTE-DISCOVERY-DECISION';
const SUBJECT = 'Tag 923: Q010-SC005 Pre-2021-Multithemen-TEL-Korpus vorab entscheiden';
const DMV_ROWS_SHA256 = '86cbf51e9181c92c91dbca66f06eb86f11bccd49dfb041f556c2b67510759b2e';
const ROSTER_SHA256 = '5acb2252c2a35787ae6902b01a8fe8e7c10a52a60c6f7c5609487f1e153f96b5';
const FROZEN_STATIC_POLICY_SHA256 = '707aec4f285534cd5510d9114f901c7b1bac980f1c3eb911ca106d0e9f750654';
const FINAL_POLICY_TIME = '2026-08-14T19:10:12.3291443Z';
const ELIGIBLE_COMPLETE_HOLD = 'HOLD_FEWER_THAN_THREE_ELIGIBLE_COMPLETE_OFFICIAL_FRAMES';
const ELIGIBLE_COMPLETE_HOLD_RULE = 'HOLD_FEWER_THAN_THREE_ELIGIBLE_COMPLETE_OFFICIAL_FRAMES_IFF_COUNT(THEME_DISPOSITION_EQ_COMPLETE_OFFICIAL_REGISTER_MANIFEST_AND_ELIGIBLE_ROW_COUNT_N_GTE_1)_LT_3';
const HASH_POLICY_LITERAL = {
  canonicalJson: 'UTF8_SORT_KEYS_NO_WHITESPACE_SEPARATORS_COMMA_COLON_ENSURE_ASCII_FALSE',
  contractCoreNormalization: 'SET_CORE_SELF_NULL_AND_EVENT_STATE_CONTENT_HASH_FIELDS_NULL',
  selfHashNormalization: 'SET_OWN_SELF_FIELD_NULL',
  duplicateJsonKeysForbidden: true,
  nonFiniteJsonNumbersForbidden: true,
  eventLineRule: 'ONE_CANONICAL_JSON_OBJECT_PLUS_LF',
};

const OWNED_PATHS = [
  'research/early-detection-v4/q010-sc005-pre2021-multitheme-tel-corpus-decision-governance-contract-v1.json',
  'scripts/early-detection-q010-sc005-pre2021-multitheme-tel-corpus-decision-v1.py',
  'state/early-detection-q010-sc005-pre2021-multitheme-tel-corpus-decision-events-v1.jsonl',
  'state/early-detection-q010-sc005-pre2021-multitheme-tel-corpus-decision-state-v1.json',
  'tests/early-detection-q010-sc005-pre2021-multitheme-tel-corpus-decision-v1.test.js',
];
const OWNED_FILES = [CONTRACT, SCRIPT, EVENTS, STATE, TEST];
const FORBIDDEN_COMMANDS = [
  'start', 'source', 'census', 'census-discovery', 'capture', 'run',
  'packet', 'open', 'aggregate', 'coding', 'ai-run',
];
const ROSTER = [
  ['cloud computing', 'successAndMixed'],
  ['smartphones and mobile ecosystems', 'successAndMixed'],
  ['semiconductors and AI infrastructure', 'successAndMixed'],
  ['solar and batteries', 'successAndMixed'],
  ['shale gas and LNG', 'successAndMixed'],
  ['cybersecurity', 'successAndMixed'],
  ['GLP-1', 'successAndMixed'],
  ['industrial automation', 'successAndMixed'],
  ['3D printing', 'failuresOrLongDelays'],
  ['metaverse', 'failuresOrLongDelays'],
  ['hydrogen mobility', 'failuresOrLongDelays'],
  ['cannabis', 'failuresOrLongDelays'],
  ['autonomous driving', 'failuresOrLongDelays'],
  ['earlier cleantech waves', 'failuresOrLongDelays'],
  ['selected genomics and biotechnology hype', 'failuresOrLongDelays'],
];
const DMV_ROW_ORDER = [
  'DMV2015-BOSCH', 'DMV2015-DELPHI', 'DMV2015-GOOGLE', 'DMV2015-NISSAN',
  'DMV2015-MERCEDES', 'DMV2015-TESLA', 'DMV2015-VOLKSWAGEN',
];
const ROLE_PHASES = [
  [1, 'ROUTE_DISCOVERY_DECISION', 'TAG923_REMOTE', [], true, 'ALL_FALSE_ZERO_NULL_NONE'],
  [2, 'ROUTE_DISCOVERY_START', 'ROUTE_DISCOVERY_DECISION_REMOTE', ['FREE_OFFICIAL_ROUTE_DISCOVERY_FOR_UNRESOLVED_14_ONLY'], true, 'ONLY_ROUTE_SOURCE_ACCESS_MAY_TRANSITION_TRUE'],
  [3, 'ROUTE_DISCOVERY_TERMINAL', 'ROUTE_DISCOVERY_START_REMOTE', [], true, 'NO_TEL_NO_CANDIDATE_NO_CREDIT'],
  [4, 'CENSUS_DISCOVERY_DECISION', 'ROUTE_DISCOVERY_TERMINAL_REMOTE', [], true, 'ALL_FALSE_ZERO_NULL_NONE'],
  [5, 'CENSUS_DISCOVERY_START', 'CENSUS_DISCOVERY_DECISION_REMOTE', ['OFFICIAL_FRAME_CENSUS_ONLY'], true, 'ONLY_CENSUS_SOURCE_ACCESS_MAY_TRANSITION_TRUE'],
  [6, 'CENSUS_DISCOVERY_TERMINAL', 'CENSUS_DISCOVERY_START_REMOTE', [], true, 'NO_TEL_NO_CANDIDATE_NO_CREDIT'],
  [7, 'CONTEMPORANEOUS_TERM_FREEZE', 'CENSUS_DISCOVERY_TERMINAL_REMOTE', [], true, 'NO_NEW_SOURCE_NO_TEL_NO_CANDIDATE_NO_CREDIT'],
  [8, 'CAPTURE_DECISION', 'CONTEMPORANEOUS_TERM_FREEZE_REMOTE', [], true, 'ALL_FALSE_ZERO_NULL_NONE'],
  [9, 'CAPTURE_START', 'CAPTURE_DECISION_REMOTE', ['EQUAL_BUDGET_CAPTURE_ONLY'], true, 'ONLY_CAPTURE_SOURCE_ACCESS_MAY_TRANSITION_TRUE'],
  [10, 'CAPTURE_TERMINAL', 'CAPTURE_START_REMOTE', [], false, 'NO_CODING_NO_TEL_NO_CANDIDATE_NO_CREDIT'],
];
const CROSS_PHASE_OBLIGATIONS = [
  'EXACT_ROLE_PHASE_APPEND_ONLY_REMOTE_TOPOLOGY_WITH_PHASE_SPECIFIC_TERMINAL_BRANCHES',
  'EACH_DECISION_REMOTE_BEFORE_SEPARATE_START_REMOTE_BEFORE_ANY_AUTHORIZED_ACCESS',
  'EACH_START_EMBEDS_BYTE_IDENTICAL_CANONICAL_DECISION_AND_PRIOR_REMOTE_RECEIPT_WITH_AUTHORIZATION_ONLY_IN_SEPARATE_START_ENVELOPE',
  'EXACT_PUBLIC_CONTENT_ADDRESSED_PRIOR_REMOTE_RECEIPT_ARTIFACTS_FROM_TAG923_FORWARD_AND_ACYCLIC_NO_NEXT_RECEIPT_SEAL_RULE',
  'EXACT_FIVE_PATH_DIRECT_CHILD_GIT_INTRODUCTIONS_WITH_FULL_PARENT_BLOB_EQUALITY_RAW_COMMIT_TIME_AND_SUBJECT_PLUS_LF_ONLY',
  'STRICT_DUPLICATE_KEY_FREE_EXACT_KEY_VALUE_SCHEMAS_WITH_ALIAS_FREE_GENERATION_AND_REACHABILITY_GATES',
  'PUBLIC_GOVERNANCE_STATE_DERIVED_ONLY_BY_EXACT_EVENT_PREFIX_REPLAY_WITH_ALL_NO_CREDIT_LOCKS',
  'CONTENT_ADDRESSED_IMPLEMENTATION_ARTIFACTS_BIND_ACTIVE_CALLABLE_BYTES_NO_DYNAMIC_IMPORT_EVAL_OR_DECLARED_HASH_ONLY',
  'CANDIDATE_SIGNAL_TEL_TIMECAPSULE_PIT_SYSTEM_AND_SCIENTIFIC_CREDIT_REMAIN_FALSE_NULL_OR_NONE_AT_EVERY_DISCOVERY_AND_CAPTURE_PHASE',
];
const ROUTE_ONLY_OBLIGATIONS = [
  'UNRESOLVED_14_EXACT_ORDINAL_LABEL_ROSTER_WITH_CATEGORIES_AUDIT_ONLY',
  'SAME_POSITIVE_ROUTE_DISCOVERY_SLOT_CAP_NO_TRANSFER_RETRY_SUBSTITUTION_OR_EARLY_STOP',
  'COMPLETE_ROUTE_DISCOVERY_SLOT_PLAN_WITH_EXACT_METHOD_HEADERS_REQUEST_BYTES_TRANSPORT_AND_ANONYMOUS_OFFICIAL_FREE_RULES',
  'ROUTE_ONLY_REQUEST_RESPONSE_RAW_PROJECTION_JOIN_MATERIAL_MANIFEST_AND_CATALOG_AGGREGATION_SCHEMAS',
  'ROUTE_ONLY_DURABILITY_ADMISSION_MUTEX_CRASH_RESUME_TRUSTED_UNTRUSTED_INCIDENT_AND_TERMINAL_SCHEMAS',
  'ROUTE_DISCOVERY_EXACT_EQUAL_CAP_PLANS_MATERIAL_JOINS_CATALOG_AGGREGATION_AND_CONFLICT_PRECEDENCE',
  'ROUTE_IMPLEMENTATION_ARTIFACTS_AND_EXECUTABLE_HASHES_FROZEN_AND_MUTATION_TESTED',
  'EXACT_TAG925_ROUTE_START_INTRODUCTION_AND_REMOTE_RECEIPT_POLICY',
  'NO_SOURCE_ACCESS_BEFORE_TAG925_ROUTE_START_REMOTE',
  'SOURCE_FREE_MATERIALIZATION_FAILURE_REQUIRES_HOLD_NO_START_NO_SOURCE_ACCESS',
];
const CENSUS_OBLIGATIONS = [
  'MAY_BE_FROZEN_ONLY_AFTER_ROUTE_DISCOVERY_TERMINAL_REMOTE_AND_BEFORE_SEPARATE_CENSUS_START_REMOTE',
  'CENSUS_EXACT_REQUEST_PLAN_CONTINUATION_TEMPLATE_MATERIALIZER_PROJECTION_ROWS_DEDUP_CONFLICT_EXHAUSTION_AND_MANIFEST_JOINS',
  'CENSUS_RUNTIME_DURABILITY_ADMISSION_INCIDENT_TERMINAL_AND_IMPLEMENTATION_ARTIFACTS_FROZEN_IN_CENSUS_DECISION_NOT_TAG924',
  'ALL_15_TERMINAL_LEDGER_WITH_CARRIED_TAG914_AND_COMPLETE_OR_TYPED_HOLD_FOR_EVERY_THEME',
  'NO_CENSUS_SOURCE_ACCESS_BEFORE_CENSUS_START_REMOTE',
];
const CAPTURE_OBLIGATIONS = [
  'MAY_BE_FROZEN_ONLY_AFTER_CENSUS_TERMINAL_REMOTE_AND_CONTEMPORANEOUS_TERM_FREEZE_REMOTE',
  'TERM_DERIVATION_ONLY_FROM_CUTOFF_ELIGIBLE_OFFICIAL_FRAME_METADATA_NO_MANUAL_LLM_CURRENT_OR_OUTCOME_ADDITION',
  'CAPTURE_EXACT_ALL_COMPLETE_FRAME_UNIT_AND_THREE_SLOT_BIJECTION_RAW_EVIDENCE_FIRST_TWO_VALID_ACCEPTANCE_AND_TERMINAL_EQUATIONS',
  'PIT_TIME_FIELDS_SEPARATE_PUBLICATION_AVAILABILITY_EFFECTIVE_RETRIEVAL_WITH_KNOWN_AT_MAX_VERIFIED_PUBLIC_AVAILABILITY',
  'ANONYMOUS_OFFICIAL_FREE_TRANSPORT_SAFE_HEADER_URI_HOST_SCHEME_PORT_PATH_AND_NO_CREDENTIAL_SURFACE',
  'SOURCE_AGNOSTIC_PREACCESS_SELECTION_REDACTION_IDENTITY_DENYLIST_HIDING_COMMITMENTS_AND_NO_SMALL_SPACE_PUBLIC_ORACLE',
  'CAPTURE_RUNTIME_DURABILITY_ADMISSION_INCIDENT_TERMINAL_AND_IMPLEMENTATION_ARTIFACTS_FROZEN_IN_CAPTURE_DECISION_NOT_TAG924',
  'CAPTURE_DECISION_CAPTURE_START_AND_CAPTURE_TERMINAL_ARE_THREE_SEPARATE_REMOTE_ROLES',
];

const TOP_KEYS = [
  'schema', 'finalPolicyMaterializedAtUtc', 'purpose', 'frozenStaticPolicySha256',
  'contractCoreSha256', 'contractSelfSha256', 'staticPolicy', 'eventContract',
  'stateContract', 'hashPolicy', 'implementation',
];
const STATIC_POLICY_KEYS = [
  'repository', 'parentTag922Binding', 'tag911PriorGovernanceBinding',
  'tag914CarriedFrameBinding', 'protocolBinding', 'decision', 'framePolicy',
  'terminalHoldCodes', 'futureGovernance', 'incumbentLocks',
];
const EVENT_KEYS = [
  'allAccessAndWorkRemainForbidden', 'contractCoreSha256', 'createdAtUtc',
  'decisionEffectiveOnlyAfterRemoteIntroduction', 'decisionStatus', 'eventId',
  'eventSha256', 'eventType', 'frozenStaticPolicySha256',
  'nextDecisionConstructionAuthorized', 'nextDecisionId', 'previousEventSha256',
  'schema', 'science', 'sequence',
];
const STATE_KEYS = [
  'schema', 'materializedAtUtc', 'authority', 'contractCoreSha256',
  'frozenStaticPolicySha256', 'eventCount', 'eventHeadSha256', 'decisionStatus',
  'decisionEffectiveOnlyAfterRemoteIntroduction', 'nextDecisionId',
  'nextDecisionConstructionAuthorized', 'sourceAccessAuthorized',
  'routeDiscoveryAuthorized', 'censusDiscoveryAuthorized', 'captureAuthorized',
  'codingAuthorized', 'aggregationAuthorized', 'packetAccessAuthorized',
  'aiRunAuthorized', 'sourceRequests', 'routeDiscoveryRequests', 'censusRequests',
  'captureRequests', 'aiRuns', 'sourceRecordCount', 'levelsAssigned',
  'candidateState', 'signalState', 'telFinalState', 'timeCapsuleState',
  'prospectivePitVerified', 'newPriceReturnGqsOrOutcomeArtifactsAccessed',
  'currentIdentifiersAccessed', 'humanAgreementGate', 'scientificCredit',
  'systemEstablished', 'originalV4Protocol', 'originalV4GreenOfficialGates',
  'originalV4OfficialGateCount', 'originalV4Complete',
  'originalV4ResultComputationAllowed', 'originalV4OutcomesAccessed',
  'stateSelfSha256',
];

const sha256 = raw => crypto.createHash('sha256').update(raw).digest('hex');

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]));
  }
  return value;
}

function canonicalBytes(value) {
  return Buffer.from(JSON.stringify(canonicalValue(value)), 'utf8');
}

function canonicalSha(value) {
  return sha256(canonicalBytes(value));
}

function selfHash(value, field) {
  const body = structuredClone(value);
  body[field] = null;
  return canonicalSha(body);
}

function contractCoreHash(contract) {
  const body = structuredClone(contract);
  body.contractCoreSha256 = null;
  body.contractSelfSha256 = null;
  body.eventContract = {
    path: body.eventContract.path,
    eventCount: 1,
    eventId: 'Q010-SC005-EVT-00000001',
    eventType: 'PRE2021_ALL15_DECISION_RECORDED',
    eventRawSha256: null,
    eventRawBytes: null,
    eventSha256: null,
  };
  body.stateContract = {
    path: body.stateContract.path,
    stateRawSha256: null,
    stateRawBytes: null,
    stateSelfSha256: null,
  };
  body.implementation.eventsRawSha256 = null;
  body.implementation.stateRawSha256 = null;
  return canonicalSha(body);
}

function rejectDuplicateKeys(text) {
  let i = 0;
  const ws = () => { while (/\s/.test(text[i] || '')) i += 1; };
  const str = () => {
    const start = i;
    assert.equal(text[i++], '"');
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; continue; }
      if (text[i++] === '"') return JSON.parse(text.slice(start, i));
    }
    throw new Error('unterminated JSON string');
  };
  const value = () => {
    ws();
    if (text[i] === '{') {
      i += 1; ws();
      const keys = new Set();
      if (text[i] === '}') { i += 1; return; }
      while (true) {
        ws(); const key = str();
        if (keys.has(key)) throw new Error(`duplicate JSON key: ${key}`);
        keys.add(key); ws(); assert.equal(text[i++], ':'); value(); ws();
        if (text[i] === '}') { i += 1; return; }
        assert.equal(text[i++], ',');
      }
    }
    if (text[i] === '[') {
      i += 1; ws();
      if (text[i] === ']') { i += 1; return; }
      while (true) {
        value(); ws();
        if (text[i] === ']') { i += 1; return; }
        assert.equal(text[i++], ',');
      }
    }
    if (text[i] === '"') { str(); return; }
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));
    if (!token) throw new Error('invalid JSON token');
    i += token[0].length;
  };
  value(); ws(); assert.equal(i, text.length);
  return JSON.parse(text);
}

function exactKeys(value, keys, label) {
  assert.deepEqual(Object.keys(value), keys, `${label} exact keys/order drift`);
}

function jsonOutput(result, label) {
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  assert.ok(lines.length > 0, `${label} emitted no JSON: ${result.stderr}`);
  return JSON.parse(lines.at(-1));
}

function runController(args, optimized = false, shouldPass = true, env = process.env) {
  const result = spawnSync('python', [...(optimized ? ['-O'] : []), '-B', SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    env,
  });
  assert.notEqual(result.status, null, `${args.join(' ')} did not exit: ${result.error || result.stderr}`);
  const output = jsonOutput(result, `${optimized ? '-O ' : ''}${args.join(' ')}`);
  if (shouldPass) {
    assert.equal(result.status, 0, `${args.join(' ')} failed: ${result.stderr || result.stdout}`);
    assert.notEqual(output.status, 'FAIL_CLOSED');
  } else {
    assert.notEqual(result.status, 0, `${args.join(' ')} unexpectedly passed`);
    assert.equal(output.status, 'FAIL_CLOSED');
    assert.deepEqual(
      [output.sourceRequests, output.routeDiscoveryRequests, output.censusRequests, output.captureRequests, output.aiRuns],
      [0, 0, 0, 0, 0],
    );
  }
  return output;
}

function cleanGitEnv(extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
  return {
    ...env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: 'NUL',
    GIT_TERMINAL_PROMPT: '0',
    GIT_NO_REPLACE_OBJECTS: '1',
    ...extra,
  };
}

function runGit(repo, args) {
  const result = spawnSync(repo.gitExecutable, [
    '--no-replace-objects',
    '-c', 'core.fsmonitor=false',
    '-c', 'credential.helper=',
    '-c', 'core.hooksPath=NUL',
    '-c', 'diff.external=',
    '-c', 'protocol.ext.allow=never',
    '-c', 'protocol.file.allow=never',
    ...args,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    env: cleanGitEnv(),
  });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function expectedEvent(contract) {
  const event = {
    schema: 'q010-sc005-pre2021-all15-decision-event/v1',
    sequence: 1,
    eventId: 'Q010-SC005-EVT-00000001',
    eventType: 'PRE2021_ALL15_DECISION_RECORDED',
    createdAtUtc: contract.finalPolicyMaterializedAtUtc,
    previousEventSha256: null,
    contractCoreSha256: contract.contractCoreSha256,
    frozenStaticPolicySha256: contract.frozenStaticPolicySha256,
    decisionStatus: 'DECISION_RECORDED_NO_START',
    decisionEffectiveOnlyAfterRemoteIntroduction: true,
    nextDecisionId: NEXT,
    nextDecisionConstructionAuthorized: false,
    allAccessAndWorkRemainForbidden: true,
    science: {
      candidate: null,
      signal: null,
      telFinal: null,
      timeCapsule: null,
      prospectivePitVerified: false,
      systemEstablished: false,
      scientificCredit: 'NONE',
    },
    eventSha256: null,
  };
  event.eventSha256 = selfHash(event, 'eventSha256');
  return event;
}

function expectedState(contract, event) {
  const decision = contract.staticPolicy.decision;
  const state = {
    schema: 'q010-sc005-pre2021-all15-decision-state/v1',
    materializedAtUtc: contract.finalPolicyMaterializedAtUtc,
    authority: 'STRICT_PUBLIC_EVENT_REPLAY_ONLY',
    contractCoreSha256: contract.contractCoreSha256,
    frozenStaticPolicySha256: contract.frozenStaticPolicySha256,
    eventCount: 1,
    eventHeadSha256: event.eventSha256,
    decisionStatus: decision.decisionStatus,
    decisionEffectiveOnlyAfterRemoteIntroduction: true,
    nextDecisionId: decision.nextDecisionId,
    nextDecisionConstructionAuthorized: false,
    sourceAccessAuthorized: false,
    routeDiscoveryAuthorized: false,
    censusDiscoveryAuthorized: false,
    captureAuthorized: false,
    codingAuthorized: false,
    aggregationAuthorized: false,
    packetAccessAuthorized: false,
    aiRunAuthorized: false,
    sourceRequests: 0,
    routeDiscoveryRequests: 0,
    censusRequests: 0,
    captureRequests: 0,
    aiRuns: 0,
    sourceRecordCount: 0,
    levelsAssigned: false,
    candidateState: null,
    signalState: null,
    telFinalState: null,
    timeCapsuleState: null,
    prospectivePitVerified: false,
    newPriceReturnGqsOrOutcomeArtifactsAccessed: false,
    currentIdentifiersAccessed: false,
    humanAgreementGate: 'OPEN',
    scientificCredit: 'NONE',
    systemEstablished: false,
    originalV4Protocol: 'FEM-SEC-US@1.2.0',
    originalV4GreenOfficialGates: 2,
    originalV4OfficialGateCount: 13,
    originalV4Complete: false,
    originalV4ResultComputationAllowed: false,
    originalV4OutcomesAccessed: false,
    stateSelfSha256: null,
  };
  state.stateSelfSha256 = selfHash(state, 'stateSelfSha256');
  return state;
}

function deepHasKey(value, key) {
  if (Array.isArray(value)) return value.some(item => deepHasKey(item, key));
  if (value === null || typeof value !== 'object') return false;
  if (Object.hasOwn(value, key)) return true;
  return Object.values(value).some(item => deepHasKey(item, key));
}

function assertIndependentLiteralPins(candidate, candidateEvent, candidateState) {
  assert.equal(candidate.frozenStaticPolicySha256, FROZEN_STATIC_POLICY_SHA256);
  assert.deepEqual(
    [candidate.finalPolicyMaterializedAtUtc, candidate.staticPolicy.decision.finalPolicyMaterializedAtUtc, candidateEvent.createdAtUtc, candidateState.materializedAtUtc],
    [FINAL_POLICY_TIME, FINAL_POLICY_TIME, FINAL_POLICY_TIME, FINAL_POLICY_TIME],
  );
  assert.ok(Date.parse(candidate.staticPolicy.parentTag922Binding.committedAtUtc) <= Date.parse(FINAL_POLICY_TIME), 'Tag922 must not postdate Tag923 policy');
  exactKeys(candidate.hashPolicy, ['canonicalJson', 'contractCoreNormalization', 'selfHashNormalization', 'duplicateJsonKeysForbidden', 'nonFiniteJsonNumbersForbidden', 'eventLineRule'], 'hash policy literal');
  assert.deepEqual(candidate.hashPolicy, HASH_POLICY_LITERAL);
  assert.deepEqual(
    [candidate.implementation.controllerPath, candidate.implementation.eventsPath, candidate.implementation.statePath, candidate.implementation.testPath],
    [OWNED_PATHS[1], OWNED_PATHS[2], OWNED_PATHS[3], OWNED_PATHS[4]],
  );
  const frame = candidate.staticPolicy.framePolicy;
  assert.equal(frame.eligibleCompleteThemeRule, 'COMPLETE_OFFICIAL_REGISTER_MANIFEST_AND_ELIGIBLE_ROW_COUNT_N_AT_LEAST_1');
  assert.equal(frame.terminalHoldRuleForInsufficientEligibleCompleteThemes, ELIGIBLE_COMPLETE_HOLD_RULE);
  assert.equal(candidate.staticPolicy.terminalHoldCodes.filter(code => code === ELIGIBLE_COMPLETE_HOLD).length, 1);
  assert.equal(candidate.staticPolicy.terminalHoldCodes.includes('HOLD_FEWER_THAN_THREE_COMPLETE_OFFICIAL_FRAMES'), false);
}

function coherentContractEventStateRebind(candidate, candidateEvent, candidateState) {
  candidate.frozenStaticPolicySha256 = canonicalSha(candidate.staticPolicy);
  candidate.contractCoreSha256 = contractCoreHash(candidate);
  candidateEvent.contractCoreSha256 = candidate.contractCoreSha256;
  candidateEvent.frozenStaticPolicySha256 = candidate.frozenStaticPolicySha256;
  candidateEvent.eventSha256 = selfHash(candidateEvent, 'eventSha256');
  const reboundEventRaw = Buffer.concat([canonicalBytes(candidateEvent), Buffer.from('\n')]);
  candidate.eventContract = {
    path: OWNED_PATHS[2],
    eventCount: 1,
    eventId: candidateEvent.eventId,
    eventType: candidateEvent.eventType,
    eventRawSha256: sha256(reboundEventRaw),
    eventRawBytes: reboundEventRaw.length,
    eventSha256: candidateEvent.eventSha256,
  };
  candidateState.contractCoreSha256 = candidate.contractCoreSha256;
  candidateState.frozenStaticPolicySha256 = candidate.frozenStaticPolicySha256;
  candidateState.eventHeadSha256 = candidateEvent.eventSha256;
  candidateState.stateSelfSha256 = selfHash(candidateState, 'stateSelfSha256');
  const reboundStateRaw = Buffer.from(`${JSON.stringify(candidateState, null, 2)}\n`, 'utf8');
  candidate.stateContract = {
    path: OWNED_PATHS[3],
    stateRawSha256: sha256(reboundStateRaw),
    stateRawBytes: reboundStateRaw.length,
    stateSelfSha256: candidateState.stateSelfSha256,
  };
  candidate.implementation.eventsRawSha256 = sha256(reboundEventRaw);
  candidate.implementation.stateRawSha256 = sha256(reboundStateRaw);
  candidate.contractSelfSha256 = selfHash(candidate, 'contractSelfSha256');
}

function assertCoherentContractEventStateCascade(candidate, candidateEvent, candidateState) {
  assert.equal(candidate.frozenStaticPolicySha256, canonicalSha(candidate.staticPolicy));
  assert.equal(candidate.contractCoreSha256, contractCoreHash(candidate));
  assert.equal(candidateEvent.eventSha256, selfHash(candidateEvent, 'eventSha256'));
  assert.equal(candidateState.stateSelfSha256, selfHash(candidateState, 'stateSelfSha256'));
  assert.equal(candidate.contractSelfSha256, selfHash(candidate, 'contractSelfSha256'));
}

const contractRaw = fs.readFileSync(CONTRACT);
const scriptRaw = fs.readFileSync(SCRIPT);
const eventRaw = fs.readFileSync(EVENTS);
const stateRaw = fs.readFileSync(STATE);
const testRaw = fs.readFileSync(TEST);
const contract = rejectDuplicateKeys(contractRaw.toString('utf8'));
const eventLines = eventRaw.toString('utf8').trimEnd().split('\n');
assert.equal(eventLines.length, 1, 'event log must contain exactly one event');
const event = rejectDuplicateKeys(eventLines[0]);
const state = rejectDuplicateKeys(stateRaw.toString('utf8'));
const scriptText = scriptRaw.toString('utf8');

const structuralChecks = [];
function structural(name, proof) {
  proof();
  structuralChecks.push(name);
}

structural('G1 inherited GIT_* scrub', () => {
  const repo = contract.staticPolicy.repository;
  assert.equal(repo.gitEnvironmentPolicy, 'REMOVE_ALL_INHERITED_GIT_STAR_CASE_INSENSITIVE_THEN_SET_CONTROLLED_NOSYSTEM_AND_EMPTY_GLOBAL');
  for (const fragment of [
    'if not key.upper().startswith("GIT_")',
    'env["GIT_CONFIG_NOSYSTEM"] = "1"',
    'env["GIT_CONFIG_GLOBAL"] = "NUL"',
    'env["GIT_TERMINAL_PROMPT"] = "0"',
    'env["GIT_NO_REPLACE_OBJECTS"] = "1"',
  ]) assert.ok(scriptText.includes(fragment), `missing Git environment guard: ${fragment}`);
});

structural('G2 replace-object bypass', () => {
  assert.equal(contract.staticPolicy.repository.gitReplaceObjectsPolicy, 'ALL_GIT_CALLS_USE_NO_REPLACE_OBJECTS_AND_REFS_REPLACE_MUST_BE_EMPTY');
  assert.ok(scriptText.includes('"--no-replace-objects"'));
  assert.ok(scriptText.includes('"refs/replace"'));
  assert.ok(scriptText.includes('git replace refs forbidden'));
});

structural('G3 process-capable Git config', () => {
  const repo = contract.staticPolicy.repository;
  assert.equal(repo.gitConfigPolicy, 'EFFECTIVE_SHOW_ORIGIN_SHOW_SCOPE_SYSTEM_GLOBAL_DISABLED_LOCAL_AND_WORKTREE_EXACT_ALLOWLIST_COMMAND_OVERRIDES_EXACT_NO_PROCESS_TLS_URL_OR_HELPER_SURFACE');
  assert.equal(repo.gitWorktreeDir, `${repo.gitCommonDir}\\worktrees\\form25-v2-promotion-20260812`);
  assert.equal(repo.gitLocalConfigFile, `${repo.gitCommonDir}\\config`);
  assert.equal(repo.gitWorktreeConfigFile, `${repo.gitWorktreeDir}\\config.worktree`);
  for (const fragment of [
    '"core.fsmonitor=false"', '"credential.helper="', '"core.hooksPath=NUL"',
    '"diff.external="', '"protocol.ext.allow=never"', '"protocol.file.allow=never"',
    'def validate_effective_git_config(raw)', 'forbidden effective git config scope',
    'unsafe local git config key', 'unsafe worktree git config',
    '["config","--show-origin","--show-scope","--null","--list"]',
  ]) assert.ok(scriptText.includes(fragment), `missing Git config guard: ${fragment}`);
  assert.equal((scriptText.match(/subprocess\.run\(/g) || []).length, 1, 'unexpected process surface');
  assert.doesNotMatch(scriptText, /subprocess\.Popen|os\.system|\b(?:eval|exec)\s*\(/);
  assert.doesNotMatch(scriptText, /^\s*(?:from|import)\s+(?:requests|urllib|http\.client|socket)\b/m);
});

structural('G4 exact commit message with no body', () => {
  const repo = contract.staticPolicy.repository;
  assert.equal(repo.expectedIntroductionSubject, SUBJECT);
  assert.equal(repo.expectedCommitMessageUtf8, `${SUBJECT}\n`);
  assert.equal(Buffer.from(repo.expectedCommitMessageUtf8, 'ascii').toString('ascii'), repo.expectedCommitMessageUtf8);
  assert.ok(scriptText.includes('msg==repo["expectedCommitMessageUtf8"].encode("ascii")'));
  assert.ok(scriptText.includes('subject body'));
});

structural('H1 exact Tag922 parent binding', () => {
  const binding = contract.staticPolicy.parentTag922Binding;
  assert.deepEqual(
    [binding.commit, binding.parentCommit, binding.subject, binding.committedAtUtc],
    [TAG922, 'd1768fe86422287b39fdf7b13531a8336cfe5f9b', 'Tag 922: Q010-SC004 AI-Methodenpfad pausieren', '2026-08-14T11:23:07Z'],
  );
  assert.equal(binding.introducedBlobBindings.length, 5);
  assert.equal(new Set(binding.introducedBlobBindings.map(item => item.path)).size, 5);
  for (const item of binding.introducedBlobBindings) {
    assert.match(item.gitBlobSha1, /^[0-9a-f]{40}$/);
    assert.match(item.rawSha256, /^[0-9a-f]{64}$/);
    assert.ok(Number.isInteger(item.rawBytes) && item.rawBytes > 0);
  }
});

structural('H2 exact Tag914 frame binding', () => {
  const carried = contract.staticPolicy.tag914CarriedFrameBinding;
  assert.equal(carried.binding.commit, TAG914);
  assert.equal(carried.binding.introducedBlobBindings.length, 5);
  assert.equal(carried.binding.frozenTreatmentPopulationCanonicalSha256, '4717b3847f11a5e3e05e9290890c6ceab493d3197b2ef5b9dfd75cb0ee0ceffd');
  assert.equal(carried.binding.frozenPopulationCount, 7);
  assert.equal(carried.carriedFrameReopenForbidden, undefined);
  assert.equal(carried.carriedTag914FrameReopenForbidden, true);
  assert.equal(runGit(contract.staticPolicy.repository, ['merge-base', '--is-ancestor', TAG911, TAG914]), '');
});

structural('H3 exact Tag911 six-field truth', () => {
  const prior = contract.staticPolicy.tag911PriorGovernanceBinding;
  assert.equal(prior.commit, TAG911);
  assert.deepEqual(
    [prior.gitBlobSha1, prior.rawSha256, prior.rawBytes, prior.sourceJsonPointer],
    ['167566f732f4e2519909f72905cc8cfe36b453ce', '29d40b8d2a34c8d2377b086ea92154ddbc41a72670bff79bd9b41922a1cb5297', 52300, 'operationalProjection.originalV4'],
  );
  assert.deepEqual(
    {
      protocol: prior.originalV4Protocol,
      greenOfficialGates: prior.originalV4GreenOfficialGates,
      officialGateCount: prior.originalV4OfficialGateCount,
      complete: prior.originalV4Complete,
      resultComputationAllowed: prior.originalV4ResultComputationAllowed,
      outcomesAccessed: prior.originalV4OutcomesAccessed,
    },
    {
      protocol: 'FEM-SEC-US@1.2.0', greenOfficialGates: 2, officialGateCount: 13,
      complete: false, resultComputationAllowed: false, outcomesAccessed: false,
    },
  );
});

structural('H4 exact All15 roster without selection', () => {
  const frame = contract.staticPolicy.framePolicy;
  assert.equal(frame.themeCount, 15);
  assert.deepEqual(frame.roster.map(item => [item.themeLabel, item.preregCategoryAuditOnly]), ROSTER);
  assert.deepEqual(frame.roster.map(item => item.ordinal), Array.from({ length: 15 }, (_, index) => index + 1));
  assert.equal(canonicalBytes(frame.roster).length, frame.rosterCanonicalBytes);
  assert.equal(canonicalSha(frame.roster), ROSTER_SHA256);
  assert.equal(frame.rosterCanonicalSha256, ROSTER_SHA256);
  assert.deepEqual(frame.preregCategoryCountsAuditOnly, { successAndMixed: 8, failuresOrLongDelays: 7 });
  assert.deepEqual(frame.unresolvedThemeOrdinals, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15]);
  assert.equal(frame.allCompleteFramesIncludedWithoutSelectionOrReplacement, true);
  assert.equal(frame.preregCategoriesOperationallyIgnored, true);
});

structural('E1 append-only event self-binding', () => {
  exactKeys(event, EVENT_KEYS, 'event');
  const replayed = expectedEvent(contract);
  assert.deepEqual(event, replayed);
  assert.equal(event.eventSha256, selfHash(event, 'eventSha256'));
  assert.deepEqual(eventRaw, Buffer.concat([canonicalBytes(replayed), Buffer.from('\n')]));
  assert.deepEqual(contract.eventContract, {
    path: OWNED_PATHS[2],
    eventCount: 1,
    eventId: event.eventId,
    eventType: event.eventType,
    eventRawSha256: sha256(eventRaw),
    eventRawBytes: eventRaw.length,
    eventSha256: event.eventSha256,
  });
});

structural('E2 strict event-to-state replay', () => {
  exactKeys(state, STATE_KEYS, 'state');
  const replayed = expectedState(contract, event);
  assert.deepEqual(state, replayed);
  assert.equal(state.stateSelfSha256, selfHash(state, 'stateSelfSha256'));
  assert.deepEqual(stateRaw, Buffer.from(`${JSON.stringify(replayed, null, 2)}\n`, 'utf8'));
  assert.deepEqual(contract.stateContract, {
    path: OWNED_PATHS[3],
    stateRawSha256: sha256(stateRaw),
    stateRawBytes: stateRaw.length,
    stateSelfSha256: state.stateSelfSha256,
  });
});

structural('N1 construction-only next transition', () => {
  const decision = contract.staticPolicy.decision;
  const future = contract.staticPolicy.futureGovernance;
  assert.deepEqual(
    [decision.nextDecisionId, decision.nextTag, decision.nextDecisionConstructionScope],
    [NEXT, 924, 'CONSTRUCT_SEPARATE_SYMMETRIC_FREE_OFFICIAL_ROUTE_DISCOVERY_DECISION_ONLY'],
  );
  assert.equal(decision.nextDecisionConstructionAuthorizedPreIntroduction, false);
  assert.equal(decision.nextDecisionConstructionAuthorizedPostIntroduction, true);
  assert.equal(future.tag923AuthorizesOnly, 'CONSTRUCTION_OF_TAG924_ROUTE_DISCOVERY_DECISION_AFTER_TAG923_REMOTE_POST');
  assert.equal(future.tag923AuthorizesNoSourcePacketCensusCaptureCodingAggregationOrAiRun, true);
  assert.equal(future.allTag924RouteObligationsMustBeMaterializedAndMutationTestedBeforeTag925StartRemote, true);
  assert.equal(state.nextDecisionConstructionAuthorized, false);
});

structural('N2 all work access and science remain closed', () => {
  const decision = contract.staticPolicy.decision;
  for (const key of [
    'startAuthorized', 'workStarted', 'sourceAccessAuthorized', 'routeDiscoveryAuthorized',
    'censusDiscoveryAuthorized', 'censusManifestFreezeAuthorized', 'captureAuthorized',
    'codingAuthorized', 'aggregationAuthorized', 'packetAccessAuthorized', 'aiRunAuthorized',
    'prospectivePitVerified', 'newPriceReturnGqsOrOutcomeArtifactsAccessed',
    'currentIdentifiersAccessed', 'levelsAssigned', 'systemEstablished',
    'operationalUseOfPreregisteredOutcomeCategories',
  ]) assert.equal(decision[key], false, `decision.${key} opened`);
  assert.deepEqual(
    [decision.sourceRequests, decision.routeDiscoveryRequests, decision.censusRequests, decision.captureRequests, decision.aiRuns, decision.sourceRecordCount],
    [0, 0, 0, 0, 0, 0],
  );
  assert.deepEqual([decision.candidateState, decision.signalState, decision.telFinalState, decision.timeCapsuleState], [null, null, null, null]);
  assert.equal(decision.scientificCredit, 'NONE');
  assert.equal(event.allAccessAndWorkRemainForbidden, true);
  assert.deepEqual(event.science, {
    candidate: null, signal: null, telFinal: null, timeCapsule: null,
    prospectivePitVerified: false, systemEstablished: false, scientificCredit: 'NONE',
  });
});

structural('N3 no Tag923 runtime-schema residue', () => {
  const future = contract.staticPolicy.futureGovernance;
  assert.equal(future.runtimeSchemaCountInTag923, 0);
  assert.equal(future.runtimeMechanicsClaimedImplementedByTag923, false);
  assert.equal(future.tag924MustNotFreezeCensusOrCaptureRuntimeSchemas, true);
  assert.equal(future.runtimeSchemasMayBeFrozenOnlyProspectivelyBeforeTheirPhase, true);
  for (const forbiddenKey of [
    'futureObjectSchemaPolicy', 'objectSchemas', 'materialEvidencePolicy',
    'terminalHoldPolicy', 'runtimeSchemas', 'requestSchema', 'responseSchema',
    'receiptJournalSchema', 'mutexSchema', 'incidentSchema',
  ]) assert.equal(deepHasKey(contract, forbiddenKey), false, `runtime residue: ${forbiddenKey}`);
  const defs = [...scriptText.matchAll(/^def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm)].map(match => match[1]);
  assert.equal(defs.some(name => /request|capture|census|route|packet|coding|aggregate|mutex|receipt|incident/i.test(name)), false);
});

structural('N4 exact role attributes and immutable Decision bytes', () => {
  const future = contract.staticPolicy.futureGovernance;
  assert.equal(future.rolePhaseCount, 10);
  assert.equal(future.rolePhases.length, 10);
  for (const item of future.rolePhases) {
    exactKeys(item, ['ordinal', 'role', 'priorRemoteRole', 'mayAuthorize', 'mustBeRemoteBeforeNext', 'scienceAndAccessLocks'], `role ${item.ordinal}`);
  }
  assert.deepEqual(
    future.rolePhases.map(item => [item.ordinal, item.role, item.priorRemoteRole, item.mayAuthorize, item.mustBeRemoteBeforeNext, item.scienceAndAccessLocks]),
    ROLE_PHASES,
  );
  assert.equal(future.decisionToStartImmutableBytesRule, 'START_MUST_EMBED_BYTE_IDENTICAL_FULL_CANONICAL_DECISION_AND_REMOTE_RECEIPT_ARTIFACT_WITH_NO_DECISION_FIELD_MUTATION_AUTHORIZATION_EXISTS_ONLY_IN_SEPARATE_START_ENVELOPE');
  assert.equal(future.failureToMaterializeAnyCurrentPhaseObligationDisposition, 'HOLD_NO_START_NO_SOURCE_ACCESS');
});

structural('T1 exact-five direct-child topology', () => {
  const repo = contract.staticPolicy.repository;
  assert.equal(repo.baseCommit, TAG922);
  assert.equal(repo.remoteRef, REMOTE_REF);
  assert.deepEqual(repo.expectedIntroductionPaths, OWNED_PATHS);
  assert.equal(new Set(repo.expectedIntroductionPaths).size, 5);
  assert.equal(repo.introductionMustBeExactFiveAdditionsDirectChildOfBase, true);
  assert.equal(repo.foreignUntrackedPathsIgnoredButNeverIntroduced, true);
  for (const fragment of [
    'parent==repo["baseCommit"]',
    'delta==[("A",x) for x in OWNED_PATHS]',
    'decision_time<=commit_dt',
  ]) assert.ok(scriptText.includes(fragment), `missing topology guard: ${fragment}`);
});

structural('T2 raw bytes LF BOM and Git-filter identity', () => {
  const repo = contract.staticPolicy.repository;
  for (let index = 0; index < OWNED_FILES.length; index += 1) {
    const raw = fs.readFileSync(OWNED_FILES[index]);
    assert.notDeepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf], `${OWNED_PATHS[index]} has UTF-8 BOM`);
    assert.equal(raw.includes(0x0d), false, `${OWNED_PATHS[index]} is not LF-only`);
    assert.equal(raw.at(-1), 0x0a, `${OWNED_PATHS[index]} lacks final LF`);
    const rawOid = runGit(repo, ['hash-object', '--no-filters', '--', OWNED_PATHS[index]]);
    const filteredOid = runGit(repo, ['hash-object', `--path=${OWNED_PATHS[index]}`, '--', OWNED_PATHS[index]]);
    assert.equal(filteredOid, rawOid, `${OWNED_PATHS[index]} changes through Git filters`);
  }
});

structural('J1 duplicate extra and non-finite JSON rejection', () => {
  exactKeys(contract, TOP_KEYS, 'contract');
  exactKeys(contract.staticPolicy, STATIC_POLICY_KEYS, 'static policy');
  assert.throws(() => rejectDuplicateKeys('{"startAuthorized":true,"startAuthorized":false}'), /duplicate JSON key/);
  assert.throws(() => rejectDuplicateKeys('{"x":NaN}'), /invalid JSON token/);
  assert.equal(contract.hashPolicy.duplicateJsonKeysForbidden, true);
  assert.equal(contract.hashPolicy.nonFiniteJsonNumbersForbidden, true);
});

structural('J2 independent static time hash-policy and implementation literal pins', () => {
  assertIndependentLiteralPins(contract, event, state);
});

structural('D1 exact DMV7 carry adapter', () => {
  const carried = contract.staticPolicy.tag914CarriedFrameBinding;
  assert.equal(carried.sourceRows.length, 7);
  assert.deepEqual(carried.sourceRows.map(row => row.populationRowId), DMV_ROW_ORDER);
  assert.equal(canonicalBytes(carried.sourceRows).length, 2592);
  assert.equal(canonicalSha(carried.sourceRows), DMV_ROWS_SHA256);
  assert.equal(carried.sourceRowsCanonicalBytes, 2592);
  assert.equal(carried.sourceRowsCanonicalSha256, DMV_ROWS_SHA256);
  const eligible = carried.sourceRows.filter(row => row.signalEligible);
  const holds = carried.sourceRows.filter(row => !row.signalEligible);
  assert.deepEqual(eligible.map(row => row.populationRowId), ['DMV2015-TESLA']);
  assert.equal(eligible[0].identityStatus, 'PIT_EXACT_SINGLE_LISTING_RESOLVED');
  assert.equal(eligible[0].identityKnownAtUtc, '2015-03-23T03:47:35Z');
  assert.equal(holds.length, 6);
  for (const row of holds) {
    assert.equal(row.identityStatus, 'REJECTED_HOLD');
    assert.equal(row.identityHoldReason, 'EXACT_PIT_LISTED_PARENT_OR_PRIMARY_LISTING_UNRESOLVED');
    assert.deepEqual([row.entityId, row.listingId, row.signalEligible], [null, null, false]);
  }
  assert.deepEqual(
    [carried.populationCount, carried.eligibleRowCountN, carried.identityHoldRowCount, carried.newDiscoveryRequestCount, carried.newSourceRequestCount],
    [7, 1, 6, 0, 0],
  );
});

structural('P1 K>=3 N>=1 symmetry budget and control HOLD', () => {
  const frame = contract.staticPolicy.framePolicy;
  assert.equal(frame.minimumEligibleCompleteThemesK, 3);
  assert.equal(frame.eligibleCompleteThemeRule, 'COMPLETE_OFFICIAL_REGISTER_MANIFEST_AND_ELIGIBLE_ROW_COUNT_N_AT_LEAST_1');
  assert.equal(frame.zeroRowCompleteFramesRemainVisibleAndContribute_ONE_SHARED_T_ONLY_BUT_NOT_K, true);
  assert.equal(frame.operationalManifestStageTarget, 'K_ELIGIBLE_COMPLETE_THEME_COUNT_GTE3');
  assert.equal(frame.operationalManifestStageStatusIfMet, 'ALL_15_DISCOVERY_TERMINAL_AVAILABLE_OFFICIAL_REGISTER_MANIFEST_STAGE_COMPLETE_UNCODED_NO_CREDIT_WITH_TYPED_HOLDS_VISIBLE');
  assert.equal(frame.all15TerminalBeforeCaptureDecision, true);
  assert.equal(frame.routeDiscoveryCaps, 'SAME_POSITIVE_NUMERIC_CAP_FOR_EACH_UNRESOLVED_THEME_NO_TRANSFER_NO_RETRY_NO_EARLY_STOP');
  assert.equal(frame.unresolved14DiscoveryAsymmetryForbidden, true);
  assert.equal(frame.allCompleteFrameCaptureAsymmetryForbidden, true);
  assert.equal(frame.unitCountFormula, 'U=SUM_OVER_ALL_COMPLETE_THEMES(1+2*N_i)');
  assert.equal(frame.captureScheduledSlotCapFormula, '3*U');
  assert.equal(frame.captureNetworkRequestCapFormula, 'NETWORK_REQUESTS<=3*U');
  assert.equal(frame.captureAcceptedPayloadCapFormula, 'ACCEPTED_PAYLOAD_CAP=2*U');
  assert.equal(frame.terminalHoldRuleForInsufficientEligibleCompleteThemes, ELIGIBLE_COMPLETE_HOLD_RULE);
  assert.equal(frame.controlsStatus, 'HOLD_CONTROL_FRAME_NOT_FROZEN');
  assert.equal(frame.controlsBlockCandidateSignalTelTimeCapsuleScienceAndFinalSymmetricStudyCorpus, true);
  assert.equal(contract.staticPolicy.terminalHoldCodes.filter(code => code === ELIGIBLE_COMPLETE_HOLD).length, 1);
  assert.equal(contract.staticPolicy.terminalHoldCodes.includes('HOLD_FEWER_THAN_THREE_COMPLETE_OFFICIAL_FRAMES'), false);
  assert.ok(contract.staticPolicy.terminalHoldCodes.includes('HOLD_CONTROL_FRAME_NOT_FROZEN'));
});

structural('P2 exact phase-specific obligations', () => {
  const future = contract.staticPolicy.futureGovernance;
  assert.deepEqual([future.crossPhaseObligationCount, future.crossPhaseObligationsExact], [9, CROSS_PHASE_OBLIGATIONS]);
  assert.deepEqual([future.tag924RouteOnlyObligationCount, future.tag924RouteOnlyObligationsExact], [10, ROUTE_ONLY_OBLIGATIONS]);
  assert.deepEqual([future.censusDecisionAfterRouteTerminalObligationCount, future.censusDecisionAfterRouteTerminalObligationsExact], [5, CENSUS_OBLIGATIONS]);
  assert.deepEqual([future.captureDecisionAfterCensusTerminalAndTermFreezeObligationCount, future.captureDecisionAfterCensusTerminalAndTermFreezeObligationsExact], [8, CAPTURE_OBLIGATIONS]);
  for (const values of [CROSS_PHASE_OBLIGATIONS, ROUTE_ONLY_OBLIGATIONS, CENSUS_OBLIGATIONS, CAPTURE_OBLIGATIONS]) {
    assert.equal(new Set(values).size, values.length, 'duplicate phase obligation');
  }
});

const literalCascadeMutationRejections = [];
function rejectLiteralCascadeMutation(name, mutate) {
  const candidate = structuredClone(contract);
  const candidateEvent = structuredClone(event);
  const candidateState = structuredClone(state);
  mutate(candidate, candidateEvent, candidateState);
  coherentContractEventStateRebind(candidate, candidateEvent, candidateState);
  assertCoherentContractEventStateCascade(candidate, candidateEvent, candidateState);
  assert.throws(() => assertIndependentLiteralPins(candidate, candidateEvent, candidateState), assert.AssertionError);
  literalCascadeMutationRejections.push(name);
}

structural('J3 coherent contract-event-state literal mutation rejection', () => {
  rejectLiteralCascadeMutation('static-policy-cutoff', candidate => {
    candidate.staticPolicy.framePolicy.commonEraEndUtc = '2021-12-31T23:59:59Z';
  });
  rejectLiteralCascadeMutation('fully-backdated-policy-event-state-time', (candidate, candidateEvent, candidateState) => {
    const backdated = '2026-08-14T10:00:00.0000000Z';
    candidate.finalPolicyMaterializedAtUtc = backdated;
    candidate.staticPolicy.decision.finalPolicyMaterializedAtUtc = backdated;
    candidateEvent.createdAtUtc = backdated;
    candidateState.materializedAtUtc = backdated;
  });
  rejectLiteralCascadeMutation('hash-policy', candidate => {
    candidate.hashPolicy.canonicalJson = 'CALLER_CHOOSES';
  });
  for (const [key, replacement] of [
    ['controllerPath', OWNED_PATHS[4]],
    ['eventsPath', OWNED_PATHS[3]],
    ['statePath', OWNED_PATHS[2]],
    ['testPath', OWNED_PATHS[1]],
  ]) {
    rejectLiteralCascadeMutation(`implementation-${key}`, candidate => {
      candidate.implementation[key] = replacement;
    });
  }
  rejectLiteralCascadeMutation('eligible-complete-hold', candidate => {
    candidate.staticPolicy.framePolicy.terminalHoldRuleForInsufficientEligibleCompleteThemes = 'HOLD_FEWER_THAN_THREE_COMPLETE_OFFICIAL_FRAMES';
    candidate.staticPolicy.terminalHoldCodes[12] = 'HOLD_FEWER_THAN_THREE_COMPLETE_OFFICIAL_FRAMES';
  });
  assert.equal(literalCascadeMutationRejections.length, 8);
  assert.equal(new Set(literalCascadeMutationRejections).size, 8);
});

assert.equal(structuralChecks.length, 22);
assert.equal(new Set(structuralChecks).size, 22);

if (process.env.SC005_STRUCTURAL_ONLY === '1') {
  console.log(JSON.stringify({
    status: 'PASS',
    mode: 'STRUCTURAL_ONLY_NO_CONTROLLER_NO_ARTIFACT_PIN',
    structuralChecks: structuralChecks.length,
    literalCascadeMutationRejections: literalCascadeMutationRejections.length,
    runtimeSchemaCount: 0,
    rolePhaseCount: 10,
  }));
  process.exit(0);
}

assert.equal(contract.schema, 'q010-sc005-pre2021-all15-decision-governance-contract/v1');
assert.equal(contract.purpose, 'DECISION_ONLY_ALL15_PRE2021_OFFICIAL_REGISTER_FRAME_NO_START_NO_ACCESS_NO_CREDIT');
assert.equal(contract.frozenStaticPolicySha256, FROZEN_STATIC_POLICY_SHA256);
assert.equal(contract.frozenStaticPolicySha256, canonicalSha(contract.staticPolicy));
assert.equal(contract.contractCoreSha256, contractCoreHash(contract));
assert.equal(contract.contractSelfSha256, selfHash(contract, 'contractSelfSha256'));
assert.equal(contract.implementation.controllerRawSha256, sha256(scriptRaw));
assert.equal(contract.implementation.eventsRawSha256, sha256(eventRaw));
assert.equal(contract.implementation.stateRawSha256, sha256(stateRaw));
assert.equal(contract.implementation.testRawSha256, sha256(testRaw));
assert.equal(contract.implementation.controllerExecutesPredecessorControllers, false);
assert.deepEqual(
  [
    contract.implementation.sourceRequestsDuringBootstrapVerifySelfTest,
    contract.implementation.routeDiscoveryRequestsDuringBootstrapVerifySelfTest,
    contract.implementation.censusRequestsDuringBootstrapVerifySelfTest,
    contract.implementation.captureRequestsDuringBootstrapVerifySelfTest,
    contract.implementation.aiRunsDuringBootstrapVerifySelfTest,
  ],
  [0, 0, 0, 0, 0],
);

for (const optimized of [false, true]) {
  const self = runController(['self-test'], optimized);
  assert.deepEqual(
    [self.status, self.runtimeSchemaCount, self.rolePhaseCount, self.semanticMutationRejections, self.gitConfigAttackRejections, self.fullFiveCascadeMutationClaimed],
    ['PASS', 0, 10, 46, 2, false],
  );
  assert.deepEqual([self.sourceRequests, self.routeDiscoveryRequests, self.censusRequests, self.captureRequests, self.aiRuns], [0, 0, 0, 0, 0]);
}

const bootstrapNormal = runController(['bootstrap']);
const bootstrapOptimized = runController(['bootstrap'], true);
assert.deepEqual(bootstrapOptimized, bootstrapNormal);
assert.deepEqual(
  [bootstrapNormal.status, bootstrapNormal.mode, bootstrapNormal.runtimeSchemaCount],
  ['PASS', 'READ_ONLY_NO_SOURCE_NO_RUN', 0],
);
assert.deepEqual(
  [bootstrapNormal.sourceRequests, bootstrapNormal.routeDiscoveryRequests, bootstrapNormal.censusRequests, bootstrapNormal.captureRequests, bootstrapNormal.aiRuns],
  [0, 0, 0, 0, 0],
);

const verifyNormal = runController(['verify']);
const verifyOptimized = runController(['verify'], true);
assert.deepEqual(verifyOptimized, verifyNormal);
assert.ok(['PRE', 'POST'].includes(verifyNormal.phase));
assert.equal(verifyNormal.nextDecisionId, NEXT);
assert.equal(verifyNormal.nextDecisionConstructionAuthorized, verifyNormal.phase === 'POST');
for (const key of [
  'startAuthorized', 'sourceAccessAuthorized', 'routeDiscoveryAuthorized',
  'censusDiscoveryAuthorized', 'captureAuthorized', 'codingAuthorized',
  'aggregationAuthorized', 'aiRunAuthorized',
]) assert.equal(verifyNormal[key], false, `verify.${key} opened`);
assert.deepEqual(
  [verifyNormal.sourceRequests, verifyNormal.routeDiscoveryRequests, verifyNormal.censusRequests, verifyNormal.captureRequests, verifyNormal.aiRuns],
  [0, 0, 0, 0, 0],
);
assert.equal(verifyNormal.scientificCredit, 'NONE');
assert.deepEqual([verifyNormal.runtimeSchemaCount, verifyNormal.rolePhaseCount], [0, 10]);

const poisonedEnv = {
  ...process.env,
  GIT_DIR: 'redirected.git',
  Git_Work_Tree: 'redirected-worktree',
  GIT_COMMON_DIR: 'redirected-common',
  GIT_INDEX_FILE: 'redirected-index',
  GIT_OBJECT_DIRECTORY: 'redirected-objects',
  GIT_ALTERNATE_OBJECT_DIRECTORIES: 'redirected-alternates',
  GIT_REPLACE_REF_BASE: 'refs/evil/',
  GIT_NO_REPLACE_OBJECTS: '0',
  GIT_CONFIG_NOSYSTEM: '0',
  GIT_CONFIG_GLOBAL: 'C:\\nonexistent\\malicious.gitconfig',
  GIT_CONFIG_COUNT: '2',
  GIT_CONFIG_KEY_0: 'core.fsmonitor',
  GIT_CONFIG_VALUE_0: 'C:\\nonexistent\\SC005_SHOULD_NOT_RUN.exe',
  GIT_CONFIG_KEY_1: 'credential.helper',
  GIT_CONFIG_VALUE_1: '!C:\\nonexistent\\SC005_HELPER_SHOULD_NOT_RUN.exe',
};
const poisonedVerify = runController(['verify'], false, true, poisonedEnv);
assert.deepEqual(poisonedVerify, verifyNormal);

if (verifyNormal.phase === 'PRE') {
  runController(['next'], false, false);
  runController(['next'], true, false);
} else {
  const nextNormal = runController(['next']);
  const nextOptimized = runController(['next'], true);
  assert.deepEqual(nextOptimized, nextNormal);
  assert.equal(nextNormal.nextDecisionConstructionAuthorized, true);
}

for (const command of FORBIDDEN_COMMANDS) {
  runController([command], false, false);
  runController([command], true, false);
}

console.log(JSON.stringify({
  status: 'PASS',
  structuralChecks: structuralChecks.length,
  literalCascadeMutationRejections: literalCascadeMutationRejections.length,
  semanticMutationRejectionsNormal: 46,
  semanticMutationRejectionsOptimized: 46,
  gitConfigAttackRejectionsNormal: 2,
  gitConfigAttackRejectionsOptimized: 2,
  fullFiveCascadeMutationClaimed: false,
  runtimeSchemaCount: 0,
  rolePhaseCount: 10,
  phase: verifyNormal.phase,
  nextDecisionConstructionAuthorized: verifyNormal.nextDecisionConstructionAuthorized,
  sourceRequests: 0,
  routeDiscoveryRequests: 0,
  censusRequests: 0,
  captureRequests: 0,
  aiRuns: 0,
  scientificCredit: 'NONE',
}));
