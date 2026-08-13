#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'verify-continuous-free-source-operational-resume-v4.py');
const contract = path.join(root, 'research', 'early-detection-v4', 'continuous-free-source-operational-resume-contract-v4.json');
const ownedPaths = [
  'research/early-detection-v4/continuous-free-source-operational-resume-contract-v4.json',
  'scripts/verify-continuous-free-source-operational-resume-v4.py',
  'tests/verify-continuous-free-source-operational-resume-v4.test.js',
];

function sha(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function git(...args) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
}

const raw = fs.readFileSync(contract);
const value = JSON.parse(raw);
assert.equal(sha(raw), /EXPECTED_CONTRACT_RAW = "([0-9a-f]{64})"/.exec(fs.readFileSync(script, 'utf8'))[1]);
const claim = value.resumeSha256;
delete value.resumeSha256;
assert.equal(sha(Buffer.from(canonical(value), 'utf8')), claim);
assert.ok(Date.parse(value.createdAt) <= Date.now(), 'createdAt must not be in the future');
assert.equal(sha(fs.readFileSync(__filename)), value.ownedBindings.test.rawSha256);

assert.equal(value.legacyMaterializedStatePointer.operationalPointerStatus, 'STALE_MATERIALIZED_STATE_PRESERVED_NOT_SUPERSEDED');
assert.equal(value.legacyMaterializedStatePointer.resumeViewStatus, 'RECOVERY_VIEW_ONLY_NOT_MATERIALIZED_STATE');
assert.equal(value.legacyMaterializedStatePointer.mayReplaceControllerState, false);
assert.equal(value.legacyMaterializedStatePointer.legacyControllerBlockedUntilV13, true);
assert.equal(value.legacyMaterializedStatePointer.v13MaterializationPolicy.appendOnlyHashChainedEventRequired, true);
assert.equal(value.legacyMaterializedStatePointer.v13MaterializationPolicy.controllerResumeRequiresRemoteVerifiedV13, true);
assert.equal(value.legacyMaterializedStatePointer.taskCounts.RESOLVED, 0);
assert.deepEqual(value.legacyQueueConservation.map((row) => row.legacyTaskId), [
  'Q001-QUANTCONNECT-TERMS-ACCOUNT',
  'Q002-QUANTCONNECT-50-CASE-CONTRACT',
  'Q003-SEC-TERMINAL-WEALTH-QUEUE',
  'Q004-FINRA-OTC-CATALOG',
  'Q005-US-EXCHANGE-PUBLIC-CATALOGS',
  'Q006-TIINGO-FREE-ENTITLEMENT',
  'Q007-OPENFIGI-ANONYMOUS-HANDSHAKE',
  'Q008-BUSINESS-QUANT-FREE-HANDSHAKE',
  'Q009-ALPHA-VANTAGE-NEGATIVE-CONTROL',
  'Q010-RESEARCH-ARCHIVE-DISCOVERY',
]);
assert.ok(value.nextQueue.some((row) => row.workId === 'RESEARCH-ARCHIVE-DISCOVERY-CONTINUATION'));
assert.ok(value.nextQueue.some((row) => row.workId === 'US-EXCHANGE-NASDAQ-GAPS-NYSE-NYSE-AMERICAN-CBOE-RECONCILIATION'));
assert.ok(!value.nextQueue.some((row) => /Q002|QUANTCONNECT/.test(row.workId)));
assert.ok(value.externalDeferred.some((row) => row.workId === 'ALPHA-VANTAGE-NEGATIVE-CONTROL' && row.autonomous === false));
assert.equal(value.milestones[0].facts.cells, 384);
assert.equal(value.milestones[0].facts.monthsWithNoSnapshot, 124);
assert.equal(value.milestones[1].facts.completedNoncashShareReceiptRows, 6);
assert.equal(value.milestones[1].facts.ratioRows, 8);
assert.equal(value.milestones[2].facts.proposalExecutionAuthorized, false);
assert.equal(value.milestones[3].facts.rows, 656);
assert.deepEqual(value.sealStates, {
  authorizationSeal: 'CLOSED', endpointSeal: 'CLOSED', resultSeal: 'CLOSED',
  outcomeSeal: 'CLOSED', fullDataSeal: 'CLOSED', fullDataAiProtocolSeal: 'CLOSED',
});
assert.equal(value.scientificLocks.originalV4GreenOfficialGates, 2);
assert.equal(value.scientificLocks.originalV4OfficialGateCount, 13);
assert.equal(value.scientificLocks.outcomesAccessed, false);

const present = ownedPaths.map((item) => git('cat-file', '-e', `HEAD:${item}`).status === 0);
assert.ok(present.every(Boolean) || present.every((item) => !item), 'owned paths must not be partially introduced');
const expectedVerifyPhase = present.every(Boolean) ? 'POST_INTRODUCTION' : 'PRE_INTRODUCTION';
const expectedKills = [
  'bindingHash', 'constructionHead', 'controllerBeforeV13', 'dropAlphaVantageDeferred',
  'dropLegacyQ007', 'dropLegacyQ010', 'dropQ010AutonomousRemainder', 'externalAutonomous',
  'falseStateSupersession', 'fullDataSealOpened', 'hypothesisCredit', 'hypothesisExecutable',
  'identityResolutionCredit', 'identityRows', 'legacyReadyCount', 'legacyResolvedOverclaim',
  'legacyScienceReinterpreted', 'lineageTag', 'minimumAncestor', 'narrowQ005ToNasdaqOnly',
  'nasdaqCells', 'nasdaqCredit', 'noncashDenominatorOverclaim', 'noncashRows',
  'originalV4Count', 'originalV4GateCredit', 'outcomeSealOpened', 'outcomesAccess',
  'ownedPathOrder', 'predecessorCredit', 'q002AutonomousNext', 'queueOrder',
  'recoveryViewClaimsMaterializedState', 'recoveryViewReplacesController', 'reservedPeriodOpened',
  'resultComputation', 'resultSealOpened', 'resumeSelf', 'terminalWealthOverclaim',
  'testBinding', 'userActionInNextQueue', 'verifierBinding',
  'v13BreaksStateHashChain',
].sort();

for (const optimized of [false, true]) {
  const prefix = optimized ? ['-O', '-B', script] : ['-B', script];
  for (const command of ['verify', 'self-test']) {
    const run = spawnSync(process.env.PYTHON || 'python', [...prefix, command, '--remote'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const result = JSON.parse(run.stdout.trim());
    assert.equal(result.status, 'PASS');
    assert.equal(result.outcomesAccessed, false);
    if (command === 'verify') {
      assert.equal(result.phase, expectedVerifyPhase);
      assert.equal(result.milestones, 4);
      assert.equal(result.autonomousNextActions, 6);
      assert.equal(result.externalDeferred, 5);
      assert.equal(result.legacyTasksConserved, 10);
      assert.equal(result.recoveryViewOnly, true);
      assert.equal(result.legacyControllerBlockedUntilV13, true);
      assert.equal(result.q002Autonomous, false);
    } else {
      assert.equal(result.phase, 'IN_MEMORY');
      assert.equal(result.killCount, expectedKills.length);
      assert.deepEqual(Object.keys(result.kills).sort(), expectedKills);
      assert.deepEqual(new Set(Object.values(result.kills)), new Set([true]));
    }
  }
}

console.log('verify-continuous-free-source-operational-resume-v4.test.js: PASS');
