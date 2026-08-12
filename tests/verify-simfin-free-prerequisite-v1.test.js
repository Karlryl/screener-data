#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'verify-simfin-free-prerequisite-v1.py');
const contract = path.join(root, 'research', 'early-detection-v4', 'simfin-free-prerequisite-contract-v1.json');
const EXPECTED_RAW_SHA256 = '680e23d40679e11b5405639b24b8e8d01fd9419cc609e74854535762b47a9c77';

function sha(raw) { return crypto.createHash('sha256').update(raw).digest('hex'); }
assert.equal(sha(fs.readFileSync(contract)), EXPECTED_RAW_SHA256);

for (const optimized of [false, true]) {
  const prefix = optimized ? ['-O', '-B', script] : ['-B', script];
  for (const command of ['verify', 'self-test']) {
    const run = spawnSync(process.env.PYTHON || 'python', [...prefix, command], { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const result = JSON.parse(run.stdout.trim());
    assert.equal(result.status, 'PASS');
    assert.equal(result.networkRequests, 0);
    assert.equal(result.accountsCreated, 0);
    assert.equal(result.filesWritten, 0);
    assert.equal(result.providerRowsCaptured, false);
    assert.equal(result.outcomesAccessed, false);
    if (command === 'self-test') {
      assert.deepEqual(new Set(Object.values(result.mutationsRejected)), new Set([true]));
    } else {
      assert.equal(result.monthlyFeeUsd, 0);
      assert.equal(result.priceHistoryMaximumYears, 5);
      assert.equal(result.durableEvidenceEligible, false);
      assert.equal(result.productionRequestsAuthorized, false);
    }
  }
}

const source = fs.readFileSync(script, 'utf8');
assert.doesNotMatch(source, /urllib|requests\.|http\.client|socket\.|aiohttp|fetch\(/);
assert.doesNotMatch(source, /os\.environ|os\.getenv|keyring|win32cred|CredentialManager|Authorization:\s*(Token|Bearer)/i);
console.log('verify-simfin-free-prerequisite-v1.test.js: PASS');
