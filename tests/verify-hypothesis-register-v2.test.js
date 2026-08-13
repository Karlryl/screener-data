'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'verify-hypothesis-register-v2.py');
const contractPath = path.join(root, 'research', 'early-detection-v4', 'hypothesis-register-contract-v2.json');

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
assert.strictEqual(contract.schema, 'early-detection-hypothesis-register-contract/v2');
assert.strictEqual(contract.track, 'ADDON_PROPOSALS_ONLY');
assert.strictEqual(contract.sourceBase.buildBase, '996fd2eeb7f2193cfc6352ca15ab544d3f09ae4c');
assert.strictEqual(contract.sourceBase.interveningLinearCommitsBeforeIntroductionAllowed, true);
assert.strictEqual(contract.priorRegister.rawSha256, '3ffb1a62d2467faa1ae79cd1db1e220757259353003b663c45ec1b55a584ddd8');
assert.strictEqual(contract.operationalResume.harnessV3.introductionCommit, '996fd2eeb7f2193cfc6352ca15ab544d3f09ae4c');
assert.strictEqual(contract.evidenceSources.length, 1);
assert.strictEqual(contract.evidenceSources[0].maximumObservedDate, '2020-12-31');
assert.strictEqual(contract.proposals.length, 1);
assert.strictEqual(Object.hasOwn(contract.proposals[0], 'status'), false);
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
  assert.strictEqual(verification.schema, 'early-detection-hypothesis-register-verification/v2');
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
  assert.strictEqual(selfTest.schema, 'early-detection-hypothesis-register-self-test/v2');
  assert.strictEqual(selfTest.status, 'PASS');
  assert.strictEqual(selfTest.outcomesAccessed, false);
  assert.strictEqual(selfTest.killCount, Object.keys(selfTest.kills).length);
  assert(Object.values(selfTest.kills).every((value) => value === true));
  const expectedKills = [
    'artificialPendingProposal', 'authorizedPathOrder', 'buildBase', 'contractSelf',
    'deferredFieldDropped', 'directChildLie', 'duplicateEvent', 'eventChain',
    'eventHash', 'eventProtocolBinding', 'eventTypeTested', 'executionAuthorized',
    'forbiddenBestCutoff', 'forbiddenHFem', 'forbiddenHLate', 'forbiddenOriginalV4',
    'forbiddenReturn', 'forbiddenSecCik', 'generationProvenanceMissing', 'harnessBlob', 'harnessRaw',
    'humanAttestation', 'originalV4Credit', 'preOutcomeStatement', 'proposalHash',
    'proposalStatusInjected', 'protocolFieldInjected', 'receiptHash', 'reservedPeriodOpened',
    'reservedProposalDate', 'resultComputation', 'resumeBlob', 'resumeRaw', 'secCikGeneration',
    'selectorChanged', 'sourceBlob', 'sourceIntroduction', 'sourcePath', 'sourceQuarterCount', 'sourceRaw', 'sourceReservedDate',
    'studyCredit', 'testBinding', 'unapprovedInspectedField', 'unknownSource',
    'v1Blob', 'v1Mutable', 'v1Raw', 'verifierBinding',
  ];
  assert.deepStrictEqual(Object.keys(selfTest.kills).sort(), expectedKills.sort());
}

console.log('verify-hypothesis-register-v2.test.js: PASS');
