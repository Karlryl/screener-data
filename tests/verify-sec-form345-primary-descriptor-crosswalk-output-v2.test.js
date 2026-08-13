#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT_REL = 'scripts/verify-sec-form345-primary-descriptor-crosswalk-output-v2.py';
const CONTRACT_REL = 'research/early-detection-v4/sec-form345-primary-descriptor-crosswalk-output-seal-contract-v2.json';
const TEST_REL = 'tests/verify-sec-form345-primary-descriptor-crosswalk-output-v2.test.js';
const SOURCE_SCRIPT_REL = 'scripts/build-sec-form345-primary-descriptor-crosswalk-v1.py';
const OUTPUT_REL = 'reports/early-detection/sec-form345-primary-descriptor-crosswalk-v1.json';
const SCRIPT = path.join(ROOT, SCRIPT_REL);
const CONTRACT = path.join(ROOT, CONTRACT_REL);
const OUTPUT = path.join(ROOT, OUTPUT_REL);
const MINIMUM = '5622b794b0a435c5389707a6777161a33f8a79f7';
const EXPECTED_CONTRACT_RAW = 'c6d02d12c07eaeeac95bb4518691773fb724deb6b73f29afa721a5ff938e8449';
const EXPECTED_CONTRACT_SELF = '8efedf9455bca90c5716ab56c44b1db6b9b5d005b98b27703f323435f90af520';
const EXPECTED_SCRIPT_RAW = '8c3d6b910a4d5337c83a791db40feec370813340c00587692832090966489628';
const EXPECTED_OUTPUT_RAW = '041383521506c7315078954824cabb2f11f46c4135ce83e80cf22621ae811ed5';
const EXPECTED_OUTPUT_SELF = 'b22597d08c176388973cfc3a9547d51344090ad8f35d0ca831b7ef06615a8dc1';
const OWN_PATHS = [CONTRACT_REL, SCRIPT_REL, TEST_REL];

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

function git(...args) {
  const run = spawnSync('git', args, {
    cwd: ROOT, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return run.stdout.trim();
}

function treeExists(commit, relative) {
  return spawnSync('git', ['cat-file', '-e', `${commit}:${relative}`], {
    cwd: ROOT, encoding: 'utf8', windowsHide: true,
  }).status === 0;
}

function assertLinearDescendant(commit) {
  assert.equal(spawnSync('git', ['merge-base', '--is-ancestor', MINIMUM, commit], {
    cwd: ROOT, windowsHide: true,
  }).status, 0);
  const commits = git('rev-list', '--ancestry-path', '--reverse', `${MINIMUM}..${commit}`).split(/\r?\n/).filter(Boolean);
  let parent = MINIMUM;
  for (const item of commits) {
    assert.deepEqual(git('show', '-s', '--format=%P', item).split(/\s+/), [parent]);
    parent = item;
  }
}

function invoke(optimized, command) {
  const args = optimized ? ['-O', '-B', SCRIPT_REL, command] : ['-B', SCRIPT_REL, command];
  const run = spawnSync(process.env.PYTHON || 'python', args, {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    timeout: 300000,
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(run.status, 0, `${optimized ? '-O ' : ''}${command} failed:\n${run.stdout}\n${run.stderr}`);
  return JSON.parse(run.stdout.trim());
}

function assertLegacyCliRejectsPostOutput() {
  const run = spawnSync(process.env.PYTHON || 'python', ['-B', SOURCE_SCRIPT_REL, 'verify-output'], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    timeout: 300000,
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.notEqual(run.status, 0, 'legacy V1 CLI unexpectedly accepted the post-output Git state');
  assert.match(`${run.stdout}\n${run.stderr}`, /future output entered implementation Git history/);
}

assert.equal(sha(fs.readFileSync(CONTRACT)), EXPECTED_CONTRACT_RAW);
assert.equal(sha(fs.readFileSync(SCRIPT)), EXPECTED_SCRIPT_RAW);
assert.equal(sha(fs.readFileSync(OUTPUT)), EXPECTED_OUTPUT_RAW);

const contract = JSON.parse(fs.readFileSync(CONTRACT, 'utf8'));
const contractBody = { ...contract };
delete contractBody.contractSha256;
assert.equal(contract.contractSha256, EXPECTED_CONTRACT_SELF);
assert.equal(sha(Buffer.from(canonical(contractBody), 'utf8')), EXPECTED_CONTRACT_SELF);
assert.equal(contract.sourceBase.minimumAncestor, MINIMUM);
assert.equal(contract.sourceBase.futureSealIntroductionDirectChildOfMinimumAncestorRequired, false);
assert.deepEqual(contract.sourceBase.authorizedPaths, OWN_PATHS);
assert.deepEqual(new Set(Object.values(contract.claimLocks)), new Set([false]));

const output = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'));
const outputBody = { ...output };
delete outputBody.reportSha256;
assert.equal(output.reportSha256, EXPECTED_OUTPUT_SELF);
assert.equal(sha(Buffer.from(canonical(outputBody), 'utf8')), EXPECTED_OUTPUT_SELF);
assert.equal(output.population.rows, 656);
assert.equal(output.population.pointStatusCounts.CONFLICTING_LATEST_LITERALS, 2);
assert.equal(output.population.archiveComparisonCounts.EXACT_LITERAL_MATCH, 157);
assert.equal(output.population.archiveComparisonCounts.EXACT_LITERAL_MISMATCH, 13);
assert.deepEqual(new Set(Object.values(output.claimLocks)), new Set([false]));
assert.equal(output.outcomesAccessed, false);

const initialHead = git('rev-parse', 'HEAD');
assertLinearDescendant(initialHead);
assert.equal(git('rev-parse', '@{upstream}'), initialHead);
if (!treeExists(initialHead, CONTRACT_REL)) {
  for (const relative of OWN_PATHS) {
    assert.equal(treeExists(initialHead, relative), false, `${relative} unexpectedly exists in the pre-introduction HEAD`);
    assert.equal(fs.existsSync(path.join(ROOT, relative)), true, `${relative} is absent from the worktree`);
  }
} else {
  const introductions = new Set(OWN_PATHS.map((relative) => git('log', '--diff-filter=A', '-1', '--format=%H', '--', relative)));
  assert.equal(introductions.size, 1);
  const introduction = [...introductions][0];
  const changes = git('diff-tree', '--no-commit-id', '--name-status', '-r', introduction).split(/\r?\n/).filter(Boolean);
  assert.deepEqual(new Set(changes), new Set(OWN_PATHS.map((relative) => `A\t${relative}`)));
}

assertLegacyCliRejectsPostOutput();
const rebuiltHashes = [];
for (const optimized of [false, true]) {
  const self = invoke(optimized, 'self-test');
  assert.equal(self.status, 'PASS');
  assert.equal(self.verifiedRows, 656);
  assert.deepEqual(new Set(Object.values(self.contractKills)), new Set([true]));
  assert.deepEqual(new Set(Object.values(self.outputKills)), new Set([true]));
  assert.equal(self.outcomesAccessed, false);

  const verified = invoke(optimized, 'verify');
  assert.equal(verified.status, 'PASS');
  assert.ok(['PRE_INTRODUCTION', 'POST_INTRODUCTION'].includes(verified.phase));
  assertLinearDescendant(verified.head);
  assert.equal(verified.verifiedRows, 656);
  assert.equal(verified.outputRawSha256, EXPECTED_OUTPUT_RAW);
  assert.equal(verified.outputReportSha256, EXPECTED_OUTPUT_SELF);
  assert.equal(verified.rebuiltRawSha256, EXPECTED_OUTPUT_RAW);
  assert.equal(verified.sourceDerivedFullRebuild, true);
  assert.equal(verified.sourceRebuildByteExact, true);
  assert.equal(verified.rowSelfHashesVerified, true);
  assert.equal(verified.rawLiteralsRemainUnsplitAndUnnormalized, true);
  assert.equal(verified.futurePointsRemainCountOnly, true);
  assert.equal(verified.historicalPublicKnownAtRemainsNull, true);
  assert.equal(verified.legacyCliPostOutputRejectionObserved, true);
  assert.equal(verified.remoteVerified, true);
  assert.equal(verified.resolutionCreditGranted, false);
  assert.equal(verified.outcomesAccessed, false);
  rebuiltHashes.push(verified.rebuiltRawSha256);
}
assert.equal(new Set(rebuiltHashes).size, 1, 'normal and optimized full source rebuilds differ');

const finalHead = git('rev-parse', 'HEAD');
assertLinearDescendant(finalHead);
assert.equal(git('rev-parse', '@{upstream}'), finalHead);
assert.equal(sha(fs.readFileSync(OUTPUT)), EXPECTED_OUTPUT_RAW, 'verification changed the sealed output');
console.log(JSON.stringify({
  status: 'PASS',
  minimumAncestor: MINIMUM,
  currentHead: finalHead,
  verifiedRows: 656,
  modes: ['normal', 'optimized'],
  legacyCliPostOutputRejectionObserved: true,
  sourceDerivedFullRebuild: true,
  sourceRebuildByteExact: true,
  resolutionCreditGranted: false,
  outcomesAccessed: false,
}));
