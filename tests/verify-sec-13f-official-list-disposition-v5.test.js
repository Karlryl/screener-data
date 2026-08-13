'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'verify-sec-13f-official-list-disposition-v5.py');
const CONTRACT_REL = 'research/early-detection-v4/sec-13f-official-list-disposition-contract-v5.json';
const BUILD_BASE = 'a37df2107ae9837939e036a33c6ef152934c6cfc';
const V4_INTRODUCTION = '95b10fe726557c75dc1bcc828f595214fb77c8e2';

function execute(prefix, command) {
  return spawnSync('python', [...prefix, SCRIPT, command], { cwd: ROOT, encoding: 'utf8' });
}

function parsed(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

for (const prefix of [[], ['-O', '-B']]) {
  const tested = parsed(execute(prefix, 'self-test'));
  assert.equal(tested.status, 'PASS');
  assert.equal(tested.mutationsRejected, 6);
  assert.equal(tested.authoritativeNodeMustRunVerifyNormalAndOptimized, true);
  assert.equal(tested.localDependenciesHashed, 12);
  assert.equal(tested.localV4FilesHashed, 3);
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

const verifyResults = [execute([], 'verify'), execute(['-O', '-B'], 'verify')];

if (!introduced) {
  for (const result of verifyResults) {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /one introduction commit/);
  }
  console.log(JSON.stringify({
    status: 'PASS',
    phase: 'PRE_INTRODUCTION_FAIL_CLOSED',
    verifyNormalExecuted: true,
    verifyOptimizedExecuted: true,
    postIntroductionRerunRequired: true,
  }));
} else {
  const verified = verifyResults.map(parsed);
  assert.deepEqual(verified[0], verified[1]);
  for (const item of verified) {
    assert.equal(item.status, 'PASS');
    assert.equal(item.dependenciesGitBound, 12);
    assert.equal(item.v4FilesGitBound, 3);
    assert.equal(item.v5OwnFilesGitBound, 3);
    assert.equal(item.v4IntroductionCommit, V4_INTRODUCTION);
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
    v4IntroductionCommit: V4_INTRODUCTION,
    studyCredit: 'ZERO',
  }));
}
