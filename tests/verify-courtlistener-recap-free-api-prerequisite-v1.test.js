#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'verify-courtlistener-recap-free-api-prerequisite-v1.py');
const contract = path.join(root, 'research', 'early-detection-v4', 'courtlistener-recap-free-api-prerequisite-contract-v1.json');
const EXPECTED_RAW_SHA256 = 'c84d6a17faebc48a3d5170669cc176755db9fe4a8031b3100a1ea0722a2198c2';

function sha(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

assert.equal(sha(fs.readFileSync(contract)), EXPECTED_RAW_SHA256);

for (const optimized of [false, true]) {
  const prefix = optimized ? ['-O', '-B', script] : ['-B', script];
  let run = spawnSync(process.env.PYTHON || 'python', [...prefix, 'verify'], {
    cwd: root, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  let result = JSON.parse(run.stdout.trim());
  assert.equal(result.status, 'PASS');
  assert.equal(result.disposition, 'FREE_ACCOUNT_REQUIRED_EXISTING_RECAP_READ_PILOT_CANDIDATE');
  assert.equal(result.productionRequestsAuthorized, false);
  assert.equal(result.pacerPurchasesAllowed, false);
  assert.equal(result.terminalPaymentVerified, false);
  assert.equal(result.networkRequests, 0);
  assert.equal(result.filesWritten, 0);
  assert.equal(result.outcomesAccessed, false);

  run = spawnSync(process.env.PYTHON || 'python', [...prefix, 'self-test'], {
    cwd: root, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  result = JSON.parse(run.stdout.trim());
  assert.equal(result.status, 'PASS');
  assert.deepEqual(new Set(Object.values(result.mutationsRejected)), new Set([true]));
  assert.equal(result.networkRequests, 0);
  assert.equal(result.filesWritten, 0);
  assert.equal(result.outcomesAccessed, false);
}

const source = fs.readFileSync(script, 'utf8');
assert.doesNotMatch(source, /urllib|requests\.|http\.client|socket\.|aiohttp|fetch\(/);
assert.doesNotMatch(source, /os\.environ|os\.getenv|keyring|win32cred|CredentialManager|CLIENT_SECRET|Authorization:\s*(Token|Bearer)/i);

console.log('verify-courtlistener-recap-free-api-prerequisite-v1.test.js: PASS');
