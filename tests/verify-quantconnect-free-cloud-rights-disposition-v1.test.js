#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'verify-quantconnect-free-cloud-rights-disposition-v1.py');
const contractPath = path.join(root, 'research', 'early-detection-v4', 'quantconnect-free-cloud-rights-disposition-contract-v1.json');
const EXPECTED_CONTRACT_RAW_SHA256 = '0676fa88d4ad76f8a4a5eb951d2a3d529e25840acf11a7cdb484adc309d39c8e';

function sha(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

assert.equal(sha(fs.readFileSync(contractPath)), EXPECTED_CONTRACT_RAW_SHA256);

for (const optimized of [false, true]) {
  const prefix = optimized ? ['-O', '-B', script] : ['-B', script];
  let run = spawnSync(process.env.PYTHON || 'python', [...prefix, 'verify'], {
    cwd: root, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  let result = JSON.parse(run.stdout.trim());
  assert.equal(result.status, 'PASS');
  assert.equal(result.disposition, 'QUARANTINED_LOG_EXPORT_NOT_PERMITTED');
  assert.equal(result.futureMetadataLoggingAuthorized, false);
  assert.equal(result.dataSemanticsEligibleForStudy, false);
  assert.equal(result.networkRequests, 0);
  assert.equal(result.filesWritten, 0);
  assert.equal(result.outcomesAccessed, false);

  run = spawnSync(process.env.PYTHON || 'python', [...prefix, 'self-test'], {
    cwd: root, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  result = JSON.parse(run.stdout.trim());
  assert.equal(result.status, 'PASS');
  assert.equal(result.contractRawBound, true);
  assert.equal(result.v6PredecessorRawBound, true);
  assert.deepEqual(new Set(Object.values(result.mutationsRejected)), new Set([true]));
  assert.equal(result.networkRequests, 0);
  assert.equal(result.filesWritten, 0);
  assert.equal(result.outcomesAccessed, false);
}

const source = fs.readFileSync(script, 'utf8');
assert.doesNotMatch(source, /urllib|requests\.|http\.client|socket\.|aiohttp|fetch\(/);
assert.doesNotMatch(source, /os\.environ|os\.getenv|API[_-]?KEY|CLIENT[_-]?SECRET|BEARER/i);

console.log('verify-quantconnect-free-cloud-rights-disposition-v1.test.js: PASS');
