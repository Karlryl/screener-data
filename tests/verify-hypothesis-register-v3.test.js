'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'verify-hypothesis-register-v3.py');
const contractPath = path.join(root, 'research', 'early-detection-v4', 'hypothesis-register-contract-v3.json');

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function runPython(optimized, command, remote = false) {
  const args = [];
  if (optimized) args.push('-O');
  args.push('-B', script, command);
  if (remote) args.push('--remote');
  const result = spawnSync('python', args, { cwd: root, encoding: 'utf8', timeout: 120000 });
  assert.strictEqual(result.status, 0, `${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  assert(lines.length > 0, 'Python verifier emitted no JSON');
  return JSON.parse(lines.at(-1));
}

const raw = fs.readFileSync(contractPath);
const contract = JSON.parse(raw);
const body = { ...contract };
delete body.contractSha256;
assert.strictEqual(sha(Buffer.from(canonical(body), 'utf8')), contract.contractSha256);
assert.strictEqual(contract.schema, 'early-detection-hypothesis-register-contract/v3');
assert.strictEqual(contract.track, 'ADDON_PROPOSALS_ONLY');
assert.strictEqual(contract.sourceBase.buildBase, '996fd2eeb7f2193cfc6352ca15ab544d3f09ae4c');
assert.strictEqual(contract.sourceBase.constructionHead, '5622b794b0a435c5389707a6777161a33f8a79f7');
assert.strictEqual(contract.sourceBase.interveningLinearCommitsBeforeIntroductionAllowed, true);
assert.strictEqual(contract.priorRegister.path, 'research/early-detection-v4/hypothesis-register-contract-v2.json');
assert.strictEqual(contract.priorRegister.rawSha256, '6c12b139edf61757dc9c457d75a4647974bb13da8473dc1b0e4fd5d3c31e24f4');
assert.strictEqual(contract.priorRegister.historicalDefinitionsOrStatusesMutated, false);
assert.strictEqual(contract.operationalResume.harnessV3.introductionCommit, '996fd2eeb7f2193cfc6352ca15ab544d3f09ae4c');
assert.strictEqual(contract.evidenceSources.length, 1);
assert.strictEqual(contract.evidenceSources[0].maximumObservedDate, '2020-12-31');
assert.strictEqual(contract.evidenceSources[0].allowedGenerationFields[4], 'roles.*.candidates.*.coverage.*.taxonomyVersion');
assert.strictEqual(contract.evidenceSources[0].sourceValueContract.coverageRowCount, 904);
assert.strictEqual(contract.evidenceSources[0].sourceValueContract.maximumAcceptedUtc, '2020-12-31T21:23:00Z');
assert.strictEqual(contract.proposals.length, 1);
assert.strictEqual(Object.hasOwn(contract.proposals[0], 'status'), false);
assert.strictEqual(typeof contract.proposals[0].primaryClaim, 'string');
assert.strictEqual(contract.proposals[0].generationProvenance.sourcePathsResolved, true);
assert.strictEqual(contract.proposals[0].generationProvenance.sourceValuesValidated, true);
assert.strictEqual(contract.events.length, 1);
assert.strictEqual(contract.events[0].eventType, 'PROPOSAL_CREATED');
assert.strictEqual(contract.events[0].statusAfter, 'PROPOSAL');
assert.strictEqual(contract.events[0].protocolBinding, null);
assert.strictEqual(contract.scientificLocks.proposalExecutionAuthorized, false);
assert.strictEqual(contract.scientificLocks.resultComputationAllowed, false);
assert.strictEqual(contract.scientificLocks.studyCredit, 'NONE');
assert.strictEqual(contract.scientificLocks.originalV4GateCredit, false);
assert.strictEqual(contract.scientificLocks.outcomesAccessed, false);

for (const optimized of [false, true]) {
  const verification = runPython(optimized, 'verify', true);
  assert.strictEqual(verification.schema, 'early-detection-hypothesis-register-verification/v3');
  assert.strictEqual(verification.status, 'PASS');
  assert(['PRE_INTRODUCTION', 'POST_INTRODUCTION'].includes(verification.phase));
  assert.strictEqual(verification.proposals, 1);
  assert.strictEqual(verification.events, 1);
  assert.strictEqual(verification.eligibleSources, 1);
  assert.strictEqual(verification.derivedStatus, 'PROPOSAL');
  assert.strictEqual(verification.proposalExecutionAuthorized, false);
  assert.strictEqual(verification.studyCredit, 'NONE');
  assert.strictEqual(verification.maximumObservedDate, '2020-12-31');
  assert.strictEqual(verification.outcomesAccessed, false);

  const selfTest = runPython(optimized, 'self-test');
  assert.strictEqual(selfTest.schema, 'early-detection-hypothesis-register-self-test/v3');
  assert.strictEqual(selfTest.status, 'PASS');
  assert.strictEqual(selfTest.outcomesAccessed, false);
  assert.strictEqual(selfTest.killCount, Object.keys(selfTest.kills).length);
  assert(Object.values(selfTest.kills).every((value) => value === true));
  const expectedKills = [
    'artificialPendingProposal', 'authorizedPathOrder', 'buildBase', 'contractSelf',
    'constructionHead', 'deferredFieldDropped', 'directChildLie', 'duplicateEvent', 'eventChain',
    'eventHash', 'eventProtocolBinding', 'eventTypeTested', 'executionAuthorized',
    'forbiddenClaimsOnlyException',
    'forbiddenBestCutoff', 'forbiddenHFem', 'forbiddenHLate', 'forbiddenOriginalV4',
    'forbiddenNestedKeyAnalysisLedger', 'forbiddenNestedKeyHFem', 'forbiddenNestedKeyHLate',
    'forbiddenNestedKeyOriginalV4Result', 'forbiddenNestedKeySecCik', 'forbiddenNestedKeyStockReturn',
    'forbiddenReturn', 'forbiddenSecCik', 'generationProvenanceMissing', 'harnessBlob', 'harnessRaw',
    'humanAttestation', 'nonStringPrimaryClaim', 'nonexistentAllowlistPath', 'omittedCoverageLevel',
    'originalV4Credit', 'preOutcomeStatement', 'proposalHash',
    'proposalStatusInjected', 'protocolFieldInjected', 'receiptHash', 'receiptSchema', 'reservedPeriodOpened',
    'reservedProposalDate', 'resultComputation', 'resumeBlob', 'resumeRaw', 'secCikGeneration',
    'selectorChanged', 'sourceBlob', 'sourceIntroduction', 'sourcePath', 'sourcePathsUnresolved',
    'sourceQuarterCount', 'sourceRaw', 'sourceReservedDate', 'sourceValueContract',
    'sourceValueContractHash', 'sourceValuesUnvalidated',
    'studyCredit', 'testBinding', 'unapprovedInspectedField', 'unknownSource',
    'v2Blob', 'v2Mutable', 'v2Raw', 'verifierBinding',
  ];
  assert.deepStrictEqual(Object.keys(selfTest.kills).sort(), expectedKills.sort());
}

console.log('verify-hypothesis-register-v3.test.js: PASS');
