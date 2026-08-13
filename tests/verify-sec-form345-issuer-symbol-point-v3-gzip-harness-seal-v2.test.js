#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = 'scripts/verify-sec-form345-issuer-symbol-point-v3-gzip-harness-seal-v2.py';
const CONTRACT = path.join(ROOT, 'research', 'early-detection-v4', 'sec-form345-issuer-symbol-point-v3-gzip-harness-seal-contract-v2.json');
const EXPECTED_CONTRACT_RAW = '68a528b933698305caff19b23ab6c5e93f1d59315dc97b2b6e16a5c7e7e53e52';
const EXPECTED_CONTRACT_SELF = '7d8f5b21b749be317b817dac1f0ab76218252e97e81aca1a94ae5817265934bd';
const BUILD_BASE = 'ee21b932abbb31c24c97fab093d8b98b62f7c3e9';
const GZIP_INTRODUCTION = '036ba9e53623f47fe8ab0f3b926c5033b629dc2c';
const RECEIPT_STDOUT = '4a5c934af0a9fa3f05b9929772851e01a08b41f47eb244152b0f3dc1dd592c19';

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

function execute(optimized, command, extra = []) {
  const prefix = optimized ? ['-O', '-B'] : ['-B'];
  return spawnSync('python', [...prefix, SCRIPT, command, ...extra], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    maxBuffer: 10 * 1024 * 1024,
  });
}

function parsed(result, label) {
  assert.equal(result.status, 0, `${label} failed:\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout.trim());
}

const raw = fs.readFileSync(CONTRACT);
assert.equal(sha256(raw), EXPECTED_CONTRACT_RAW, 'V2 contract raw hash changed');
const contract = JSON.parse(raw);
const body = { ...contract };
delete body.contractSha256;
assert.equal(contract.contractSha256, EXPECTED_CONTRACT_SELF, 'V2 claimed self hash changed');
assert.equal(sha256(Buffer.from(canonical(body), 'utf8')), EXPECTED_CONTRACT_SELF, 'V2 computed self hash changed');

for (const optimized of [false, true]) {
  const mode = optimized ? 'optimized' : 'normal';
  const selfTest = parsed(execute(optimized, 'self-test'), `${mode} self-test`);
  assert.equal(selfTest.status, 'PASS');
  assert.equal(selfTest.filesWritten, 0);
  assert.equal(selfTest.humanAttestation, false);
  assert.equal(selfTest.outcomesAccessed, false);
  assert.deepEqual(selfTest.mutationKills, {
    humanAttestation: true,
    lineageParent: true,
    normalCommandDropsSourceRebuild: true,
    optimizedResultDropsSourceRebuild: true,
    ownedVerifierHash: true,
    rootVerifierHash: true,
    stdoutHash: true,
  });

  const verified = parsed(execute(optimized, 'verify', ['--remote']), `${mode} verify`);
  assert.equal(verified.status, 'PASS');
  assert.equal(verified.promotionIntroduction, GZIP_INTRODUCTION);
  assert.equal(verified.currentHead.length, 40);
  assert(['PRE_SEAL', 'POST_SEAL'].includes(verified.sealPhase));
  if (verified.sealPhase === 'PRE_SEAL') {
    assert.equal(verified.currentHead, BUILD_BASE);
    assert.equal(verified.harnessSealIntroduction, null);
  } else {
    assert.equal(verified.harnessSealIntroduction.length, 40);
  }
  assert.equal(verified.priorArtifactsBound, 5);
  assert.equal(verified.ownedArtifactsBound, 3);
  assert.deepEqual(verified.sourceRebuildReceiptsBound, ['NORMAL', 'OPTIMIZED']);
  assert.equal(verified.receiptStdoutSha256, RECEIPT_STDOUT);
  assert.equal(verified.exactTimestampsRecorded, false);
  assert.equal(verified.humanAttestation, false);
  assert.equal(verified.outcomesAccessed, false);
}

const missingRemote = execute(false, 'verify');
assert.notEqual(missingRemote.status, 0, 'verify without mandatory live-remote check must fail');
assert.match(missingRemote.stderr, /live remote verification is mandatory/);

console.log(JSON.stringify({
  status: 'PASS',
  modes: ['normal', 'optimized'],
  negativeFixtures: 8,
  priorArtifactsBound: 5,
  ownedArtifactsBound: 3,
  sourceRebuildReceiptsBound: ['NORMAL', 'OPTIMIZED'],
  receiptStdoutSha256: RECEIPT_STDOUT,
  exactTimestampsRecorded: false,
  humanAttestation: false,
  outcomesAccessed: false,
}));
