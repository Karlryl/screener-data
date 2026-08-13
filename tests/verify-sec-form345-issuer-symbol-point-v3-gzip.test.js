#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = 'scripts/verify-sec-form345-issuer-symbol-point-v3-gzip.py';
const RAW = path.join(ROOT, 'reports', 'early-detection', 'sec-form345-issuer-symbol-point-v3.json');
const EXPECTED_RAW = '81e748f609cbf8e73de2f5ea91166ce178c71c1df4fa0398ab9821f30459e0f4';
const EXPECTED_GZIP = 'fe75233db21467dbec453cd8f20e5b25a8a4d4db16317d6b2fc78eaa7c97f484';
const EXPECTED_REPORT = 'b27c9a9197088cbf29d0532a0d73c15a35e41c5300bacb12a7fb7f81076c7ef3';
const PARENT = '34d7b2be658c95666b6f31be8bdc4cfd2f580875';

function sha256(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
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

const rawBefore = fs.existsSync(RAW) ? sha256(fs.readFileSync(RAW)) : null;
if (rawBefore !== null) assert.equal(rawBefore, EXPECTED_RAW, 'local raw JSON drift');

for (const optimized of [false, true]) {
  const mode = optimized ? 'optimized' : 'normal';
  const selfTest = parsed(execute(optimized, 'self-test'), `${mode} self-test`);
  assert.equal(selfTest.status, 'PASS');
  assert.equal(selfTest.gzipDeterministic, true);
  assert.equal(selfTest.claimLocksFalse, 13);
  assert.equal(selfTest.filesWritten, 0);
  assert.equal(selfTest.outcomesAccessed, false);
  assert.deepEqual(selfTest.mutationKills, {
    claimLock: true,
    count: true,
    imputation: true,
    outcomeField: true,
    rowLoss: true,
  });

  const verified = parsed(execute(optimized, 'verify'), `${mode} verify`);
  assert.equal(verified.status, 'PASS');
  assert.equal(verified.phase, 'PRE_PROMOTION');
  assert.equal(verified.head, PARENT);
  assert.equal(verified.promotionBlobCount, 5);
  assert(verified.maximumBlobBytes < 100000000);
  assert.equal(verified.rows, 656);
  assert.equal(verified.sourceAllRows, 3352003);
  assert.equal(verified.sourceTargetPoints, 164675);
  assert.equal(verified.issuerNameMissingAllRows, 1188);
  assert.equal(verified.issuerNameMissingTargetPoints, 23);
  assert.equal(verified.issuerNamePresentAllRows, 3350815);
  assert.equal(verified.issuerNamePresentTargetPoints, 164652);
  assert.equal(verified.gzipSha256, EXPECTED_GZIP);
  assert.equal(verified.decompressedSha256, EXPECTED_RAW);
  assert.equal(verified.reportSha256, EXPECTED_REPORT);
  assert.equal(verified.sourceDerivedFullRebuild, false);
  assert.equal(verified.claimLocksFalse, 13);
  assert.equal(verified.outcomesAccessed, false);
}

const rawAfter = fs.existsSync(RAW) ? sha256(fs.readFileSync(RAW)) : null;
assert.equal(rawAfter, rawBefore, 'promotion tests mutated local raw JSON');

console.log(JSON.stringify({
  status: 'PASS',
  modes: ['normal', 'optimized'],
  rows: 656,
  sourceTargetPoints: 164675,
  issuerNameMissingTargetPoints: 23,
  gzipSha256: EXPECTED_GZIP,
  decompressedSha256: EXPECTED_RAW,
  reportSha256: EXPECTED_REPORT,
  promotionBlobCount: 5,
  rawJsonChanged: false,
  outcomesAccessed: false,
}));
