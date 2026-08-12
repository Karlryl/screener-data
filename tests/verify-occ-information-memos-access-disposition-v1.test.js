#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'verify-occ-information-memos-access-disposition-v1.py');
const contract = path.join(root, 'research', 'early-detection-v4', 'occ-information-memos-access-disposition-contract-v1.json');
const EXPECTED_RAW_SHA256 = '3588d5ff1ca8eec4a496b11647ae0f02cd514ec50fdd25f6cad901228a31f835';

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
  assert.equal(result.disposition, 'MANUAL_PRIMARY_DOCUMENT_COUNTERCHECK_ONLY_AUTOMATION_PROHIBITED');
  assert.equal(result.automatedAccessAuthorized, false);
  assert.equal(result.terminalWealthComplete, false);
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
assert.doesNotMatch(source, /subprocess|Start-Process|Invoke-WebRequest|curl|wget/i);

console.log('verify-occ-information-memos-access-disposition-v1.test.js: PASS');
