#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'build-sec-terminal-closure-exhaustion-v1.py');
const output = path.join(root, 'reports', 'early-detection', 'sec-terminal-closure-exhaustion-v1.json');

function run(args, optimized = false) {
  const argv = optimized ? ['-O', '-B', script, ...args] : ['-B', script, ...args];
  const result = spawnSync('python', argv, { cwd: root, encoding: 'utf8', timeout: 180000 });
  if (result.status !== 0) throw new Error(`command failed: ${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout.trim());
}

for (const optimized of [false, true]) {
  const contract = run(['verify-contract', '--remote'], optimized);
  assert.equal(contract.status, 'PASS');
  const self = run(['self-test', '--remote'], optimized);
  assert.equal(self.status, 'PASS');
  assert.equal(self.verifiedRows, 23);
  assert.equal(self.outcomesAccessed, false);
  assert(Object.values(self.mutationsKilled).every(Boolean));
  assert(Object.values(self.contractMutationsKilled).every(Boolean));
  const first = run(['dry-run', '--remote'], optimized);
  const second = run(['dry-run', '--remote'], optimized);
  assert.deepEqual(first, second);
  assert.equal(first.rows, 23);
  assert.equal(first.scanSummary.blobCount, 27438);
  assert.equal(first.scanSummary.documentsScanned, 40818);
  assert.equal(first.scanSummary.sentencesScanned, 1022061);
  assert.equal(first.scanSummary.qualifiedNoFurtherDistributionRows, 0);
  assert.equal(first.scanSummary.qualifiedActualPostClosingRecoveryRowsFilterA, 0);
  assert.equal(first.scanSummary.qualifiedActualPostClosingRecoveryRowsFilterB, 0);
  assert.equal(first.outcomesAccessed, false);
}

assert.equal(fs.existsSync(output), false, 'pre-output test must not create output');
console.log(JSON.stringify({ status: 'PASS', modes: ['normal', 'optimized'], verifiedRows: 23, outcomesAccessed: false }));
