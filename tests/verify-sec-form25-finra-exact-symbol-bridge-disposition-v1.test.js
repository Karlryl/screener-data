#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = 'scripts/verify-sec-form25-finra-exact-symbol-bridge-disposition-v1.py';
const CONTRACT = path.join(ROOT, 'research', 'early-detection-v4', 'sec-form25-finra-exact-symbol-bridge-disposition-contract-v1.json');
const OWNED = [
  'research/early-detection-v4/sec-form25-finra-exact-symbol-bridge-disposition-contract-v1.json',
  SCRIPT,
  'tests/verify-sec-form25-finra-exact-symbol-bridge-disposition-v1.test.js',
];

function sha(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizedVerifier(raw) {
  let text = raw.toString('utf8').replaceAll('\r\n', '\n');
  for (const name of ['CONTRACT_RAW', 'CONTRACT_SELF']) {
    const expression = new RegExp(`^${name} = "[0-9a-fA-Z_]+"$`, 'm');
    assert.equal((text.match(expression) || []).length, 1, `${name} normalization structure changed`);
    text = text.replace(expression, `${name} = "${'0'.repeat(64)}"`);
  }
  return Buffer.from(text, 'utf8');
}

function execute(prefix, command, remote = true) {
  const args = [...prefix, SCRIPT, command];
  if (remote) args.push('--remote');
  return spawnSync(process.env.PYTHON || 'python', args, {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    timeout: 240000,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function parsed(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim());
}

const contractRaw = fs.readFileSync(CONTRACT);
const contract = JSON.parse(contractRaw.toString('utf8'));
const body = { ...contract };
delete body.contractSha256;
assert.equal(contract.contractSha256, sha(Buffer.from(canonical(body), 'utf8')));
assert.equal(contract.disposition.status, 'NO_GO_CURRENT_BOUND_SOURCES_FOR_TIMELY_EXACT_SYMBOL_BRIDGE');
assert.equal(contract.disposition.studyCredit, 'ZERO');
assert.equal(contract.expectedRebuild.primaryLatestPoint.candidatePairs, 0);
assert.equal(contract.expectedRebuild.primaryLatestPoint.boundaries, 560);
assert.equal(contract.expectedRebuild.primaryLatestPoint.symbols, 226);
assert.equal(contract.expectedRebuild.recentPointDiagnostic.candidatePairs, 0);
assert.equal(contract.expectedRebuild.allHistoryPositiveControl.candidatePairs, 48);
assert.equal(contract.expectedRebuild.allHistoryPositiveControl.minimumPointAgeDays, 3908);
assert.deepEqual(new Set(Object.values(contract.claimLocks)), new Set([false]));
assert.equal(sha(normalizedVerifier(fs.readFileSync(path.join(ROOT, SCRIPT)))), contract.implementationContract.verifierNormalizedSha256);
assert.equal(sha(fs.readFileSync(__filename)), contract.implementationContract.testRawSha256);

for (const prefix of [['-B'], ['-O', '-B']]) {
  const noRemote = execute(prefix, 'verify', false);
  assert.notEqual(noRemote.status, 0);
  assert.match(noRemote.stderr, /live remote verification is mandatory/);

  const checked = parsed(execute(prefix, 'verify-contract'));
  assert.equal(checked.status, 'PASS');
  assert.equal(checked.remoteVerified, true);
  assert.equal(checked.studyCredit, 'ZERO');
  assert.equal(checked.outcomesAccessed, false);

  const selfTest = parsed(execute(prefix, 'self-test'));
  assert.equal(selfTest.status, 'PASS');
  assert.ok(Object.keys(selfTest.mutationKills).length >= 22);
  assert.deepEqual(new Set(Object.values(selfTest.mutationKills)), new Set([true]));
  assert.equal(selfTest.privateRowsPrinted, false);
  assert.equal(selfTest.privateRowsWritten, false);
  assert.equal(selfTest.outcomesAccessed, false);

  const verified = parsed(execute(prefix, 'verify'));
  assert.equal(verified.status, 'PASS');
  assert.equal(verified.remoteVerified, true);
  assert.equal(verified.disposition, 'NO_GO_CURRENT_BOUND_SOURCES_FOR_TIMELY_EXACT_SYMBOL_BRIDGE');
  assert.equal(verified.studyCredit, 'ZERO');
  assert.equal(verified.rebuild.boundaryRows, 12727);
  assert.equal(verified.rebuild.boundaryRowsInFinraCoverage, 8246);
  assert.equal(verified.rebuild.form345PlaceholderObservationOccurrencesExcluded, 205);
  assert.equal(verified.rebuild.primaryLatestPoint.candidatePairs, 0);
  assert.equal(verified.rebuild.primaryLatestPoint.boundaries, 560);
  assert.equal(verified.rebuild.primaryLatestPoint.symbols, 226);
  assert.equal(verified.rebuild.recentPointDiagnostic.candidatePairs, 0);
  assert.equal(verified.rebuild.allHistoryPositiveControl.candidatePairs, 48);
  assert.equal(verified.rebuild.allHistoryPositiveControl.candidateBoundaries, 2);
  assert.equal(verified.rebuild.allHistoryPositiveControl.minimumPointAgeDays, 3908);
  assert.equal(verified.rebuild.allHistoryPositiveControl.maximumPointAgeDays, 5670);
  assert.equal(verified.privateRowsPrinted, false);
  assert.equal(verified.privateRowsWritten, false);
  assert.equal(verified.publicOutputCreated, false);
  assert.equal(verified.pricesAccessed, false);
  assert.equal(verified.returnsAccessed, false);
  assert.equal(verified.outcomesAccessed, false);
}

const introduced = spawnSync('git', ['log', '--format=%H', '--diff-filter=A', '--', OWNED[0]], {
  cwd: ROOT,
  encoding: 'utf8',
  windowsHide: true,
});
assert.equal(introduced.status, 0, introduced.stderr);
console.log(JSON.stringify({
  status: 'PASS',
  modes: ['normal', 'optimized'],
  phase: introduced.stdout.trim() ? 'POST_INTRODUCTION' : 'PRE_INTRODUCTION',
  primaryCandidatePairs: 0,
  recentCandidatePairs: 0,
  allHistoryPositiveControlPairs: 48,
  studyCredit: 'ZERO',
  outcomesAccessed: false,
}));
