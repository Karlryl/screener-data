'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'verify-consolidated-adjusted-ohlcv-zero-cost-source-decision-v1.py');
const CONTRACT = path.join(ROOT, 'research', 'early-detection-v4', 'consolidated-adjusted-ohlcv-zero-cost-source-decision-contract-v1.json');
const EXPECTED_CONTRACT_RAW = 'dbcbd44a5acbd5b30334f2a3047ed37515a02eb15de5a19fc3aec98629f40d1b';
const EXPECTED_VERIFIER_NORMALIZED = 'c5c71520078e30ebad46106f1b2eff0e9ab883a9eab0a628932c24dd98df05e8';
const EXPECTED_TEST_NORMALIZED = '5eb8a964b5d3c887775582c05513562d6929da018639d79615fc831d087b2ad0';

function sha(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function normalizedVerifier(raw) {
  let text = raw.toString('utf8').replace(/\r\n/g, '\n');
  for (const name of ['CONTRACT_RAW', 'CONTRACT_SELF', 'VERIFIER_NORMALIZED', 'TEST_NORMALIZED']) {
    const pattern = new RegExp(`^${name} = "[0-9a-fA-Z_]+"$`, 'gm');
    assert.strictEqual((text.match(pattern) || []).length, 1);
    text = text.replace(pattern, `${name} = "${'0'.repeat(64)}"`);
  }
  return Buffer.from(text, 'utf8');
}

function normalizedTest(raw) {
  let text = raw.toString('utf8').replace(/\r\n/g, '\n');
  for (const name of ['EXPECTED_CONTRACT_RAW', 'EXPECTED_VERIFIER_NORMALIZED', 'EXPECTED_TEST_NORMALIZED']) {
    const pattern = new RegExp(`^const ${name} = '[0-9a-fA-Z_]+';$`, 'gm');
    assert.strictEqual((text.match(pattern) || []).length, 1);
    text = text.replace(pattern, `const ${name} = '${'0'.repeat(64)}';`);
  }
  return Buffer.from(text, 'utf8');
}

function run(command, optimized = false, remote = false) {
  const args = [];
  if (optimized) args.push('-O');
  args.push('-B', SCRIPT, command);
  if (remote) args.push('--remote');
  return spawnSync('python', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

assert.strictEqual(sha(fs.readFileSync(CONTRACT)), EXPECTED_CONTRACT_RAW);
assert.strictEqual(sha(normalizedVerifier(fs.readFileSync(SCRIPT))), EXPECTED_VERIFIER_NORMALIZED);
assert.strictEqual(sha(normalizedTest(fs.readFileSync(__filename))), EXPECTED_TEST_NORMALIZED);

for (const optimized of [false, true]) {
  const selfResult = run('self-test', optimized, false);
  assert.strictEqual(selfResult.status, 0, selfResult.stderr);
  const selfJson = JSON.parse(selfResult.stdout);
  assert.strictEqual(selfJson.status, 'PASS');
  assert.ok(selfJson.mutationKillCount >= 24);
  assert.ok(Object.values(selfJson.mutationKills).every(Boolean));
  assert.strictEqual(selfJson.outcomesAccessed, false);

  const noRemote = run('verify', optimized, false);
  assert.notStrictEqual(noRemote.status, 0, 'verify without --remote must fail');

  const verifyResult = run('verify', optimized, true);
  assert.strictEqual(verifyResult.status, 0, verifyResult.stderr);
  const verifyJson = JSON.parse(verifyResult.stdout);
  assert.strictEqual(verifyJson.status, 'PASS');
  assert.ok(['PRE_INTRODUCTION', 'POST_INTRODUCTION'].includes(verifyJson.phase));
  assert.strictEqual(verifyJson.remoteVerified, true);
  assert.strictEqual(verifyJson.sourceGroupsReviewed, 7);
  assert.strictEqual(verifyJson.independentBlockerChecks, 3);
  assert.strictEqual(verifyJson.tiingoThreeCasePilotEligibleAfterAccountGate, true);
  assert.strictEqual(verifyJson.fullUniverseAcquisitionAuthorized, false);
  assert.strictEqual(verifyJson.consolidatedAdjustedOhlcvResolved, false);
  assert.strictEqual(verifyJson.pricesAccessed, false);
  assert.strictEqual(verifyJson.returnsAccessed, false);
  assert.strictEqual(verifyJson.outcomesAccessed, false);
}

console.log(JSON.stringify({ status: 'PASS', modes: ['normal', 'optimized'], remoteVerified: true, sourceGroupsReviewed: 7, independentBlockerChecks: 3, fullUniverseAcquisitionAuthorized: false, outcomesAccessed: false }));
