#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CONTRACT_PATH = path.join(
  ROOT, 'research', 'early-detection-v4', 'sec-form345-issuer-symbol-point-contract-v2.json'
);
const BUILDER_PATH = path.join(ROOT, 'scripts', 'build-sec-form345-issuer-symbol-point-v2.py');
const OUTPUT_PATH = path.join(ROOT, 'reports', 'early-detection', 'sec-form345-issuer-symbol-point-v2.json');
const PARENT = 'c172b73a36e7b3001797520514c790925f258784';
const V1_INTRODUCTION = 'b33ebca4a60155dd3f31e8c7e40696a293be1dd0';
const CONTRACT_RAW_SHA256 = 'b3d7a6ab30999cac316e7e92b159a2ecf1b6339531c6c8a11dbe93a2003e26c4';
const CONTRACT_SHA256 = '5c721cca043ea68366a67fa4ffd44c81ce6f3f7d6e582373d7c9e3c918a61e5a';
const MANIFEST_RAW_SHA256 = '0f0b52999baa558b48e83696fcbcf7e8ab8613af34d88f55a9a529d2e88586e1';
const MANIFEST_SHA256 = 'deb91244154b3093acda0235b0cb6ad443374c21b691cf0bf178c8a641465152';

function sha256(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function runPython(optimized, command) {
  const args = optimized
    ? ['-O', '-B', BUILDER_PATH, command]
    : ['-B', BUILDER_PATH, command];
  const result = spawnSync('python', args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.strictEqual(
    result.status,
    0,
    `${optimized ? 'optimized' : 'normal'} ${command} failed:\n${result.stdout}\n${result.stderr}`
  );
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  assert(lines.length > 0, `${command} returned no JSON`);
  return JSON.parse(lines.at(-1));
}

const contractRaw = fs.readFileSync(CONTRACT_PATH);
assert.strictEqual(sha256(contractRaw), CONTRACT_RAW_SHA256, 'V2 contract raw hash drift');
const contract = JSON.parse(contractRaw.toString('utf8'));
const contractBody = { ...contract };
delete contractBody.contractSha256;
assert.strictEqual(sha256(Buffer.from(canonical(contractBody), 'utf8')), CONTRACT_SHA256, 'V2 contract self hash drift');
assert.strictEqual(contract.contractSha256, CONTRACT_SHA256);
assert.strictEqual(contract.remoteBinding.parentRemoteCommit, PARENT);
assert.strictEqual(contract.remoteBinding.parentTag, 837);
assert.strictEqual(contract.immutableV1Base.introductionCommit, V1_INTRODUCTION);
assert.strictEqual(contract.immutableV1Base.v1RemainsUnmodified, true);
assert.strictEqual(contract.immutableV1Base.v1FailedOutputMayNotBePromoted, true);
assert.strictEqual(contract.privateCapture.manifestRawSha256, MANIFEST_RAW_SHA256);
assert.strictEqual(contract.privateCapture.manifestSelfSha256, MANIFEST_SHA256);
assert.strictEqual(contract.privateCapture.readOnly, true);
assert.strictEqual(contract.privateCapture.redownloadAllowed, false);
assert.strictEqual(contract.privateCapture.mutationAllowed, false);
assert.deepStrictEqual(contract.missingnessPolicy.requiredNonblankSourceFields, [
  'ACCESSION_NUMBER', 'FILING_DATE', 'DOCUMENT_TYPE', 'ISSUERCIK', 'ISSUERTRADINGSYMBOL',
]);
assert.strictEqual(contract.missingnessPolicy.nullableSourceField, 'ISSUERNAME');
assert.deepStrictEqual(contract.missingnessPolicy.missingEncoding, {
  issuerName: null,
  issuerNameState: 'MISSING_SOURCE_VALUE',
});
assert.strictEqual(contract.missingnessPolicy.inventedImputedOrBackfilledIssuerNameAllowed, false);
assert.deepStrictEqual(contract.v1FailureObservation, {
  status: 'V1_FAIL_CLOSED_ON_OBSERVED_SOURCE_MISSINGNESS',
  allRows: 3352003,
  targetRows: 164675,
  blankIssuerNameAllRows: 1188,
  blankIssuerNameTargetRows: 23,
  otherSelectedFieldBlankAllRows: 0,
  credit: 'DIAGNOSTIC_ONLY_NO_STUDY_CREDIT',
});
assert(Object.values(contract.claimLocks).every((value) => value === false), 'a V2 claim lock was promoted');

const source = fs.readFileSync(BUILDER_PATH, 'utf8');
assert(source.includes(`CONTRACT_RAW_SHA256 = "${CONTRACT_RAW_SHA256}"`));
assert(source.includes(`PARENT_REMOTE_COMMIT = "${PARENT}"`));
assert(source.includes(`V1_INTRODUCTION_COMMIT = "${V1_INTRODUCTION}"`));
assert(!source.includes('__CONTRACT_RAW_SHA256__'), 'unsealed V2 contract placeholder');
assert(!source.includes('urllib.request'), 'V2 unexpectedly contains a network client');
assert(!source.includes('SEC_CONTACT'), 'V2 unexpectedly asks for network credentials');
assert(!source.includes('commands.add_parser("capture")'), 'V2 unexpectedly exposes capture');
assert(source.includes('v1.read_submission_member(zip_raw)'), 'V2 does not use the V1 SUBMISSION-only reader');
assert.strictEqual((source.match(/read_submission_member\(/g) || []).length, 1, 'unexpected additional ZIP read path');
assert(source.includes('issuer_name = values["ISSUERNAME"] or None'), 'nullable issuer-name source mapping missing');
assert(source.includes('"MISSING_SOURCE_VALUE" if issuer_name is None'), 'explicit missing-name state missing');
assert(source.includes('if blank_core:'), 'blank core fail-closed gate missing');

const outputBefore = fs.existsSync(OUTPUT_PATH) ? sha256(fs.readFileSync(OUTPUT_PATH)) : null;
for (const optimized of [false, true]) {
  const verify = runPython(optimized, 'verify-contract');
  assert.strictEqual(verify.status, 'PASS');
  assert.strictEqual(verify.head, PARENT);
  assert.strictEqual(verify.v1IntroductionCommit, V1_INTRODUCTION);
  assert.strictEqual(verify.networkRequests, 0);
  assert.strictEqual(verify.filesWritten, 0);
  assert.strictEqual(verify.outcomesAccessed, false);

  const dry = runPython(optimized, 'dry-run');
  assert.strictEqual(dry.status, 'PASS');
  assert.strictEqual(dry.manifestRawSha256, MANIFEST_RAW_SHA256);
  assert.strictEqual(dry.manifestSha256, MANIFEST_SHA256);
  assert.strictEqual(dry.quarters, 64);
  assert.strictEqual(dry.expectedAllRows, 3352003);
  assert.strictEqual(dry.expectedTargetRows, 164675);
  assert.strictEqual(dry.expectedMissingIssuerNameTargetRows, 23);
  assert.strictEqual(dry.networkRequests, 0);
  assert.strictEqual(dry.filesWritten, 0);
  assert.strictEqual(dry.outcomesAccessed, false);

  const selfTest = runPython(optimized, 'self-test');
  assert.strictEqual(selfTest.status, 'PASS');
  assert.strictEqual(selfTest.blankNameAcceptedExplicitly, true);
  assert.strictEqual(selfTest.presentNameTrimmed, true);
  for (const field of [
    'ACCESSION_NUMBER', 'FILING_DATE', 'DOCUMENT_TYPE', 'ISSUERCIK', 'ISSUERTRADINGSYMBOL',
  ]) {
    assert.strictEqual(selfTest[`blankCoreRejected_${field}`], true, `blank ${field} was accepted`);
  }
  assert.strictEqual(selfTest.inventedMissingNameRejected, true);
  assert.strictEqual(selfTest.unknownNameStateRejected, true);
  assert.strictEqual(selfTest.outcomeFieldRejected, true);
  assert.strictEqual(selfTest.networkRequests, 0);
  assert.strictEqual(selfTest.filesWritten, 0);
  assert.strictEqual(selfTest.outcomesAccessed, false);
}
const outputAfter = fs.existsSync(OUTPUT_PATH) ? sha256(fs.readFileSync(OUTPUT_PATH)) : null;
assert.strictEqual(outputAfter, outputBefore, 'offline V2 tests changed production output');

console.log(JSON.stringify({
  status: 'PASS',
  contractRawSha256: CONTRACT_RAW_SHA256,
  contractSha256: CONTRACT_SHA256,
  v1IntroductionCommit: V1_INTRODUCTION,
  manifestRawSha256: MANIFEST_RAW_SHA256,
  manifestSha256: MANIFEST_SHA256,
  modes: ['normal', 'optimized'],
  networkRequests: 0,
  productionOutputChanged: false,
  outcomesAccessed: false,
}));
