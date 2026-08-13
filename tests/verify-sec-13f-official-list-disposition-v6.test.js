'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'verify-sec-13f-official-list-disposition-v6.py');
const OWN_REL = [
  'research/early-detection-v4/sec-13f-official-list-disposition-contract-v6.json',
  'scripts/verify-sec-13f-official-list-disposition-v6.py',
  'tests/verify-sec-13f-official-list-disposition-v6.test.js',
];
const CONTRACT_REL = OWN_REL[0];
const BUILD_BASE = '6d69e42eb377b6345f7392e57e693d924b366cc3';
const V5_INTRODUCTION = 'c172b73a36e7b3001797520514c790925f258784';

function execute(prefix, command) {
  return spawnSync('python', [...prefix, SCRIPT, command], { cwd: ROOT, encoding: 'utf8' });
}

function parsed(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function rawSha256(relative) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative))).digest('hex');
}

const expectedLocalOwnHashes = Object.fromEntries(OWN_REL.map((relative) => [relative, rawSha256(relative)]));
for (const prefix of [['-B'], ['-O', '-B']]) {
  const tested = parsed(execute(prefix, 'self-test'));
  assert.equal(tested.status, 'PASS');
  assert.equal(tested.semanticMutationsRejected, 7);
  assert.equal(tested.authoritativeNodeMustRunVerifyNormalAndOptimized, true);
  assert.equal(tested.localDependenciesHashed, 12);
  assert.equal(tested.localV4FilesHashed, 3);
  assert.equal(tested.localV5FilesHashed, 3);
  assert.equal(tested.localOwnBytesBound, 3);
  assert.deepEqual(tested.localOwnRawSha256, expectedLocalOwnHashes);
  assert.equal(tested.studyCredit, 'ZERO');
  assert.equal(tested.wholeTreeAbsenceNotClaimed, true);
  assert.equal(tested.networkRequests, 0);
  assert.equal(tested.filesWritten, 0);
  assert.equal(tested.outcomesAccessed, false);
}

const introduced = spawnSync('git', ['cat-file', '-e', `HEAD:${CONTRACT_REL}`], {
  cwd: ROOT,
  encoding: 'utf8',
}).status === 0;

const verifyResults = [execute(['-B'], 'verify'), execute(['-O', '-B'], 'verify')];

if (!introduced) {
  for (const result of verifyResults) {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /one introduction commit/);
  }
  console.log(JSON.stringify({
    status: 'PASS',
    phase: 'PRE_INTRODUCTION_FINAL_BYTES_BOUND_FAIL_CLOSED',
    verifyNormalExecuted: true,
    verifyOptimizedExecuted: true,
    localOwnBytesBound: 3,
    postIntroductionRerunRequired: true,
  }));
} else {
  const verified = verifyResults.map(parsed);
  assert.deepEqual(verified[0], verified[1]);
  for (const item of verified) {
    assert.equal(item.status, 'PASS');
    assert.equal(item.dependenciesGitBound, 12);
    assert.equal(item.v4FilesGitBound, 3);
    assert.equal(item.v5FilesGitBound, 3);
    assert.equal(item.v6OwnFilesGitBound, 3);
    assert.equal(item.v5IntroductionCommit, V5_INTRODUCTION);
    assert.equal(item.buildBaseCommit, BUILD_BASE);
    assert.match(item.introductionCommit, /^[0-9a-f]{40}$/);
    assert.equal(item.introductionDirectChildOfBuildBase, true);
    assert.equal(item.wholeTreeAbsenceClaimed, false);
    assert.equal(item.studyCredit, 'ZERO');
    assert.equal(item.networkRequests, 0);
    assert.equal(item.filesWritten, 0);
    assert.equal(item.outcomesAccessed, false);
  }
  console.log(JSON.stringify({
    status: 'PASS',
    phase: 'POST_INTRODUCTION_VERIFIED',
    verifyNormalExecuted: true,
    verifyOptimizedExecuted: true,
    dependenciesGitBound: 12,
    v5IntroductionCommit: V5_INTRODUCTION,
    studyCredit: 'ZERO',
  }));
}
