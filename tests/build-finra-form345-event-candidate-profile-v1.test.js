#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'build-finra-form345-event-candidate-profile-v1.py');
const contractPath = path.join(root, 'research', 'early-detection-v4', 'finra-form345-event-candidate-profile-contract-v1.json');
const output = path.join(root, 'reports', 'early-detection', 'finra-form345-event-candidate-profile-v1.json');
const EXPECTED_CONTRACT_RAW = '5ce36408ab6faae88d9b0f23804f1ff51d3ae499f638a379e577b435f3d09a15';

function sha(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function run(optimized, command) {
  const args = optimized ? ['-O', '-B', script, command] : ['-B', script, command];
  const result = spawnSync(process.env.PYTHON || 'python', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 600000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const value = JSON.parse(result.stdout.trim());
  assert.equal(value.status, 'PASS');
  assert.equal(value.outcomesAccessed, false);
  return value;
}

assert.equal(fs.existsSync(output), false, 'production output must remain absent before this pre-output test');
assert.equal(sha(fs.readFileSync(contractPath)), EXPECTED_CONTRACT_RAW);
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
assert.equal(contract.sourceBase.commit, '6d69e42eb377b6345f7392e57e693d924b366cc3');
assert.equal(contract.expectedPopulation.candidateEvents, 8);
assert.equal(contract.expectedPopulation.candidateCiks, 5);
assert.equal(contract.expectedPopulation.matchedGapRows, 0);
assert.equal(contract.privacyContract.publicAggregateOnly, true);
assert.equal(contract.privacyContract.privateRowLevelLedgersEmitted, false);
assert.equal(contract.privacyContract.identifiersSymbolsNamesDescriptionsAccessionsAndRawRowsIncluded, false);
assert.deepEqual(new Set(Object.values(contract.claimLocks)), new Set([false]));

for (const optimized of [false, true]) {
  const verified = run(optimized, 'verify-contract');
  assert.equal(verified.sourceBaseCommit, contract.sourceBase.commit);
  const tested = run(optimized, 'self-test');
  assert.deepEqual(new Set(Object.values(tested.selectionKills)), new Set([true]));
  assert.deepEqual(new Set(Object.values(tested.reportKills)), new Set([true]));
}

const rebuilt = run(false, 'rebuild-digest');
assert.equal(rebuilt.aggregateSha256, 'f4617a5801e9596c15d56bdeb55becc723da60e18764044ea71a27db48fed7d3');
assert.equal(rebuilt.candidateEvents, 8);
assert.equal(rebuilt.candidateCiks, 5);
assert.equal(rebuilt.matchedGapRows, 0);
assert.equal(rebuilt.twoIndependentFullRebuilds, true);

const source = fs.readFileSync(script, 'utf8');
assert.doesNotMatch(source, /urllib|requests\.|http\.client|socket\.|aiohttp|fetch\(/);
assert.equal(fs.existsSync(output), false, 'pre-output tests must not write the production output');
console.log('build-finra-form345-event-candidate-profile-v1.test.js: PASS');
