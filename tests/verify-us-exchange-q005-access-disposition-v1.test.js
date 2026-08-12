#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'verify-us-exchange-q005-access-disposition-v1.py');
const contractPath = path.join(root, 'research', 'early-detection-v4', 'us-exchange-q005-access-disposition-contract-v1.json');
const EXPECTED_CONTRACT_RAW_SHA256 = '731011e4e990b1a0fd8e790937e69e007e543f6062104457168f4a93050ae340';

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
  assert.equal(result.sourceFamilies, 4);
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
  assert.deepEqual(new Set(Object.values(result.mutationsRejected)), new Set([true]));
  assert.equal(result.networkRequests, 0);
  assert.equal(result.filesWritten, 0);
  assert.equal(result.outcomesAccessed, false);
}

const source = fs.readFileSync(script, 'utf8');
assert.doesNotMatch(source, /urllib|requests\.|http\.client|socket\.|aiohttp|fetch\(/);
assert.doesNotMatch(source, /os\.environ|os\.getenv|API[_-]?KEY|CLIENT[_-]?SECRET|BEARER/i);

console.log('verify-us-exchange-q005-access-disposition-v1.test.js: PASS');
