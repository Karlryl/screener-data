#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'build-sec-same-sentence-effective-fixed-cash-v5.py');
const contract = path.join(root, 'research', 'early-detection-v4', 'sec-same-sentence-effective-fixed-cash-contract-v5.json');
const output = path.join(root, 'reports', 'early-detection', 'sec-same-sentence-effective-fixed-cash-v5.json');
const EXPECTED_CONTRACT_RAW = '7908ac392ace079b8a28fc3dafb72cd588721dfa016e03891c469edef1010e6b';
function sha(raw) { return crypto.createHash('sha256').update(raw).digest('hex'); }

assert.equal(sha(fs.readFileSync(contract)), EXPECTED_CONTRACT_RAW);
for (const optimized of [false, true]) {
  const prefix = optimized ? ['-O', '-B', script] : ['-B', script];
  for (const command of ['verify-contract', 'self-test']) {
    const run = spawnSync(process.env.PYTHON || 'python', [...prefix, command], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 120000 });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const value = JSON.parse(run.stdout.trim());
    assert.equal(value.status, 'PASS');
    assert.equal(value.scopeLimit, 'NO_GENERAL_PARSER_OR_UNSEEN_SENTENCE_CLAIM');
    assert.equal(value.outcomesAccessed, false);
    if (command === 'self-test') {
      assert.deepEqual(new Set(Object.values(value.kills)), new Set([true]));
      for (const key of ['sentenceChangedAndRehashed', 'amountNormalizedChanged', 'amountRawTextChanged', 'amountStartChanged', 'amountEndChanged', 'ratioAdded', 'duplicateFrozenAccession', 'scopeExpanded']) assert.equal(value.kills[key], true);
    }
  }
}
if (fs.existsSync(output)) {
  for (const optimized of [false, true]) {
    const prefix = optimized ? ['-O', '-B', script] : ['-B', script];
    const run = spawnSync(process.env.PYTHON || 'python', [...prefix, 'verify-output'], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 120000 });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const value = JSON.parse(run.stdout.trim());
    assert.equal(value.status, 'PASS');
    assert.equal(value.sourceRebuildVerified, true);
    assert.equal(value.verifiedRows, 11);
    assert.equal(value.scopeLimit, 'NO_GENERAL_PARSER_OR_UNSEEN_SENTENCE_CLAIM');
    assert.equal(value.outcomesAccessed, false);
  }
}
console.log('build-sec-same-sentence-effective-fixed-cash-v5.test.js: PASS');
