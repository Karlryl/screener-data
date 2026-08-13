#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CONTRACT_PATH = path.join(ROOT, 'research', 'early-detection-v4', 'sec-form345-issuer-symbol-point-contract-v3.json');
const BUILDER_PATH = path.join(ROOT, 'scripts', 'build-sec-form345-issuer-symbol-point-v3.py');
const V2_PATHS = [
  path.join(ROOT, 'research', 'early-detection-v4', 'sec-form345-issuer-symbol-point-contract-v2.json'),
  path.join(ROOT, 'scripts', 'build-sec-form345-issuer-symbol-point-v2.py'),
  path.join(ROOT, 'tests', 'build-sec-form345-issuer-symbol-point-v2.test.js'),
];
const OUTPUT_PATHS = [
  path.join(ROOT, 'reports', 'early-detection', 'sec-form345-issuer-symbol-point-v2.json'),
  path.join(ROOT, 'reports', 'early-detection', 'sec-form345-issuer-symbol-point-v3.json'),
];
const PARENT = 'c07279bdabf4e4b7f70b0aae7c32ab5da2c1c1f5';
const V2_INTRODUCTION = '6d69e42eb377b6345f7392e57e693d924b366cc3';
const CONTRACT_RAW_SHA256 = 'fe3ab39b615bd78da92acc3da64575dbb3b66103adccdd9ad9460b2a7631df50';
const CONTRACT_SHA256 = 'f4f14ca6c91a06d989e0681d070224d0cb33a2bf929065ce3c37367ce5c1f38f';
const BUILDER_RAW_SHA256 = '12466af13e1960275deda4a9f879cdace4e41f7bc3b5a1e13726b2e477d714a7';
const V2_RAW_SHA256 = [
  'b3d7a6ab30999cac316e7e92b159a2ecf1b6339531c6c8a11dbe93a2003e26c4',
  'ebe692a2532a1aab62bffd4a5b17631bf99c9467828c18585899dfbe551521e7',
  '72881db9ebe7da649a5a9c489739855a0fe2d4f06895d7663d1073abbf5e9ab1',
];

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
  assert.equal(
    result.status,
    0,
    `${optimized ? 'optimized' : 'normal'} ${command} failed:\n${result.stdout}\n${result.stderr}`
  );
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  assert(lines.length > 0, `${command} returned no JSON`);
  return JSON.parse(lines.at(-1));
}

const contractRaw = fs.readFileSync(CONTRACT_PATH);
assert.equal(sha256(contractRaw), CONTRACT_RAW_SHA256, 'V3 contract raw hash drift');
const contract = JSON.parse(contractRaw.toString('utf8'));
const body = { ...contract };
delete body.contractSha256;
assert.equal(sha256(Buffer.from(canonical(body), 'utf8')), CONTRACT_SHA256, 'V3 contract self hash drift');
assert.equal(contract.contractSha256, CONTRACT_SHA256);
assert.equal(contract.remoteBinding.parentRemoteCommit, PARENT);
assert.equal(contract.remoteBinding.parentTag, 839);
assert.equal(contract.remoteBinding.introductionCommitMustAddExactlyOwnThreePaths, true);
assert.equal(contract.immutableV2Base.introductionCommit, V2_INTRODUCTION);
assert.equal(contract.immutableV2Base.v2RemainsUnmodified, true);
assert.equal(contract.immutableV2Base.v2SemanticsFullyInherited, true);
assert.equal(contract.immutableV2Base.v2ProductionTopologyExpired, true);
assert.equal(contract.semanticInheritance.nullableSourceField, 'ISSUERNAME');
assert.equal(contract.semanticInheritance.issuerNameImputationAllowed, false);
assert.equal(contract.semanticInheritance.blankCoreFieldDisposition, 'FAIL_CLOSED');
assert.equal(contract.semanticInheritance.tickerOnlyJoinAllowed, false);
assert.deepEqual(contract.semanticInheritance.expectedCounts, {
  allRows: 3352003,
  targetRows: 164675,
  blankIssuerNameAllRows: 1188,
  blankIssuerNameTargetRows: 23,
});
assert(Object.values(contract.claimLocks).every((value) => value === false), 'a V3 claim lock was promoted');

assert.equal(sha256(fs.readFileSync(BUILDER_PATH)), BUILDER_RAW_SHA256, 'V3 builder raw hash drift');
V2_PATHS.forEach((artifact, index) => {
  assert.equal(sha256(fs.readFileSync(artifact)), V2_RAW_SHA256[index], `V2 artifact ${index} drift`);
});
const source = fs.readFileSync(BUILDER_PATH, 'utf8');
assert(source.includes(`CONTRACT_RAW_SHA256 = "${CONTRACT_RAW_SHA256}"`));
assert(source.includes(`PARENT_REMOTE_COMMIT = "${PARENT}"`));
assert(source.includes(`V2_INTRODUCTION_COMMIT = "${V2_INTRODUCTION}"`));
assert(!source.includes('__CONTRACT_RAW_SHA256__'), 'unsealed V3 contract placeholder');
assert(!source.includes('urllib.request'), 'V3 unexpectedly contains a provider network client');
assert(!source.includes('commands.add_parser("capture")'), 'V3 unexpectedly exposes capture');
assert(source.includes('payload = v2.build(private_root_arg)'), 'V3 does not reuse the exact bound V2 build semantics');
assert(source.includes('v2.validate_public_output(shadow'), 'V3 output does not pass through the bound V2 validator');

const outputBefore = OUTPUT_PATHS.map((artifact) => (
  fs.existsSync(artifact) ? sha256(fs.readFileSync(artifact)) : null
));
for (const optimized of [false, true]) {
  const verify = runPython(optimized, 'verify-contract');
  assert.equal(verify.status, 'PASS');
  assert.equal(verify.head, PARENT);
  assert.equal(verify.v2IntroductionCommit, V2_INTRODUCTION);
  assert.equal(verify.v2FilesGitBound, 3);
  assert.equal(verify.networkRequests, 0);
  assert.equal(verify.filesWritten, 0);
  assert.equal(verify.outcomesAccessed, false);

  const dry = runPython(optimized, 'dry-run');
  assert.equal(dry.status, 'PASS');
  assert.equal(dry.head, PARENT);
  assert.equal(dry.quarters, 64);
  assert.equal(dry.expectedAllRows, 3352003);
  assert.equal(dry.expectedTargetRows, 164675);
  assert.equal(dry.expectedMissingIssuerNameAllRows, 1188);
  assert.equal(dry.expectedMissingIssuerNameTargetRows, 23);
  assert.equal(dry.networkRequests, 0);
  assert.equal(dry.filesWritten, 0);
  assert.equal(dry.outcomesAccessed, false);

  const selfTest = runPython(optimized, 'self-test');
  assert.equal(selfTest.status, 'PASS');
  assert.equal(selfTest.v2FilesGitBound, 3);
  assert.equal(selfTest.v2SemanticSelfTestPassed, true);
  assert.equal(selfTest.blankNameAcceptedExplicitly, true);
  assert.equal(selfTest.inventedMissingNameRejected, true);
  assert.equal(selfTest.unknownNameStateRejected, true);
  assert.equal(selfTest.outcomeFieldRejected, true);
  assert.equal(selfTest.allRowsBound, true);
  assert.equal(selfTest.targetRowsBound, true);
  assert.equal(selfTest.blankIssuerNameAllRowsBound, true);
  assert.equal(selfTest.blankIssuerNameTargetRowsBound, true);
  assert.equal(selfTest.productionAtParentRejected, true);
  assert.equal(selfTest.remoteDriftRejected, true);
  assert.equal(selfTest.networkRequests, 0);
  assert.equal(selfTest.filesWritten, 0);
  assert.equal(selfTest.outcomesAccessed, false);
}
const outputAfter = OUTPUT_PATHS.map((artifact) => (
  fs.existsSync(artifact) ? sha256(fs.readFileSync(artifact)) : null
));
assert.deepEqual(outputAfter, outputBefore, 'offline V3 tests changed a production output');

console.log(JSON.stringify({
  status: 'PASS',
  contractRawSha256: CONTRACT_RAW_SHA256,
  contractSha256: CONTRACT_SHA256,
  builderRawSha256: BUILDER_RAW_SHA256,
  v2IntroductionCommit: V2_INTRODUCTION,
  v2FilesGitBound: 3,
  counts: [3352003, 164675, 1188, 23],
  modes: ['normal', 'optimized'],
  networkRequests: 0,
  productionOutputChanged: false,
  outcomesAccessed: false,
}));
