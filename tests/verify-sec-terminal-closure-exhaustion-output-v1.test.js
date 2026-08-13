#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'verify-sec-terminal-closure-exhaustion-output-v1.py');
const EXPECTED_CONTRACT_RAW = 'd306cb9000947b24c94807054fce86cdd66a8377d31e2c9f2cc8a7743d961e9f';
const EXPECTED_CONTRACT_SELF = 'a2d1dee502ec5d4c5a55a542b37bd5d87d6e1e35308ac3f07c33b64c63c7bd79';
const EXPECTED_VERIFIER_NORMALIZED = '645b53fb5c01251a3c07b99f54212658b2ff1cd6ae181a387746017e0c0113b8';
const EXPECTED_TEST_NORMALIZED = 'a35100fac7d75b86e75af7f9a676d89c5eea621d0023585f9c9d27fee794260d';

function run(command, optimized = false) {
  const argv = optimized ? ['-O', '-B', script, command, '--remote'] : ['-B', script, command, '--remote'];
  const result = spawnSync('python', argv, { cwd: root, encoding: 'utf8', timeout: 180000 });
  if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout.trim());
}

for (const optimized of [false, true]) {
  const self = run('self-test', optimized);
  assert.equal(self.status, 'PASS');
  assert(Object.values(self.contractMutationsKilled).every(Boolean));
  const verified = run('verify', optimized);
  assert.equal(verified.status, 'PASS');
  assert.equal(verified.sourceDerivedFullRebuild, true);
  assert.equal(verified.rows, 23);
  assert.equal(verified.rawSha256, '68d1002e6aa0836a39fc29d982bd1a91001ab626976f0472a74c69bf133d12ed');
  assert.equal(verified.reportSha256, '9d0f7377952821796c5c709dc9baf9bd62aab74058277c7a98780b14f23daf7a');
  assert.equal(verified.outcomesAccessed, false);
}

console.log(JSON.stringify({ status: 'PASS', modes: ['normal', 'optimized'], sourceDerivedFullRebuild: true, rows: 23, outcomesAccessed: false }));
