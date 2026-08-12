#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'finalize-finra-q004-historical-v3.py');
const contract = path.join(root, 'research', 'early-detection-v4', 'finra-q004-historical-finalization-contract-v3.json');
const output = path.join(root, 'reports', 'early-detection', 'finra-q004-historical-crawl-manifest-v3.json');
const EXPECTED_CONTRACT_RAW_SHA256 = '99fc6b21ab671f898823756392c7736c6b8a8117e851921d854b3f1d769fea69';

function sha(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

assert.equal(sha(fs.readFileSync(contract)), EXPECTED_CONTRACT_RAW_SHA256);

for (const optimized of [false, true]) {
  const prefix = optimized ? ['-O', '-B', script] : ['-B', script];
  for (const command of ['verify-contract', 'self-test']) {
    const run = spawnSync(process.env.PYTHON || 'python', [...prefix, command], {
      cwd: root, encoding: 'utf8', windowsHide: true,
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const result = JSON.parse(run.stdout.trim());
    assert.equal(result.status, 'PASS');
    assert.equal(result.outcomesAccessed, false);
    if (command === 'self-test') {
      assert.deepEqual(new Set(Object.values(result.kills)), new Set([true]));
    }
  }
}

assert.equal(fs.existsSync(output), false, 'pre-output test must not inherit a result');
const source = fs.readFileSync(script, 'utf8');
assert.doesNotMatch(source, /urllib|requests\.|http\.client|socket\.|aiohttp|fetch\(/);
assert.doesNotMatch(source, /Credential|keyring|os\.environ|os\.getenv|Authorization/i);

console.log('finalize-finra-q004-historical-v3.test.js: PASS');
