#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CONTRACT_RELATIVE = 'research/early-detection-v4/sec-frozen-noncash-share-receipt-evidence-contract-v3.json';
const VERIFIER_RELATIVE = 'scripts/verify-sec-frozen-noncash-share-receipt-evidence-v3.py';
const TEST_RELATIVE = 'tests/verify-sec-frozen-noncash-share-receipt-evidence-v3.test.js';
const CONTRACT = path.join(ROOT, ...CONTRACT_RELATIVE.split('/'));
const VERIFIER = path.join(ROOT, ...VERIFIER_RELATIVE.split('/'));
const SCRIPT = VERIFIER_RELATIVE;
const EXPECTED_CONTRACT_BYTES = 19763;
const EXPECTED_CONTRACT_RAW = 'd1e0ff5188332c4840a33e2218c9a54baf743d0327d229ceea363488813d271f';
const EXPECTED_CONTRACT_SELF = '7974876c527b1157aa6fefb98c5b643fc43841cbbc3beb3e2621702472ef12d5';
const EXPECTED_VERIFIER_RAW = '4d70c0bfe412a45bb676a0fc8dce9ef1ce40f3a72100423cbb6366f23a84140b';
const EXPECTED_DERIVED_SHA = 'a68f2e51f25f0462381dd86b9cfb429e0c98d063f4712de050ce5311878add0b';
const REMOTE_URL = 'https://github.com/Karlryl/screener-data.git';
const REMOTE_REF = 'refs/heads/codex/early-detection-v4-gates-20260810';
const MINIMUM_ANCESTOR = '5622b794b0a435c5389707a6777161a33f8a79f7';
const APTIV_CASE = 'NONCASH-RECEIPT-004';
const OWN_PATHS = [CONTRACT_RELATIVE, VERIFIER_RELATIVE, TEST_RELATIVE];
const LEGACY_KEYS = new Set(['surrenderedSecurityText', 'surrenderedUnits']);

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
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function gitExists(commit, relative) {
  const result = spawnSync('git', ['cat-file', '-e', `${commit}:${relative}`], {
    cwd: ROOT, encoding: 'utf8', windowsHide: true,
  });
  return result.status === 0;
}

function invoke(command, optimized, remote) {
  const args = [];
  if (optimized) args.push('-O');
  args.push('-B', SCRIPT, command);
  if (remote) args.push('--remote');
  return spawnSync(process.env.PYTHON || 'python', args, {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    timeout: 180000,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function parseSuccess(command, optimized) {
  const result = invoke(command, optimized, true);
  assert.equal(result.status, 0, `${command} failed:\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout.trim());
}

function assertLegacyKeysAbsent(value) {
  if (Array.isArray(value)) {
    for (const item of value) assertLegacyKeysAbsent(item);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      assert.equal(LEGACY_KEYS.has(key), false, `legacy key survived: ${key}`);
      assertLegacyKeysAbsent(item);
    }
  }
}

const contractRaw = fs.readFileSync(CONTRACT);
assert.equal(contractRaw.length, EXPECTED_CONTRACT_BYTES);
assert.equal(sha(contractRaw), EXPECTED_CONTRACT_RAW);
assert.equal(sha(fs.readFileSync(VERIFIER)), EXPECTED_VERIFIER_RAW);
const contract = JSON.parse(contractRaw);
const contractBody = { ...contract };
delete contractBody.contractSha256;
assert.equal(contract.contractSha256, EXPECTED_CONTRACT_SELF);
assert.equal(sha(Buffer.from(canonical(contractBody), 'utf8')), EXPECTED_CONTRACT_SELF);
assert.equal(contract.derivedViewSha256, EXPECTED_DERIVED_SHA);
assert.equal(sha(Buffer.from(canonical(contract.derivedView), 'utf8')), EXPECTED_DERIVED_SHA);
assert.deepEqual(contract.sourceBase.authorizedPaths, OWN_PATHS);
assert.equal(contract.sourceBase.minimumAncestor, MINIMUM_ANCESTOR);
assert.equal(contract.materialization.mode, 'CONTRACT_EMBEDDED_EXACT_DERIVED_VIEW');
assert.equal(contract.materialization.newOutputRequired, false);
assert.equal(contract.materialization.newOutputPath, null);
assert.equal(contract.derivedView.rows.length, 6);
assert.equal(contract.derivedView.rows.flatMap((row) => row.ratios).length, 8);
assertLegacyKeysAbsent(contract.derivedView);
assert.deepEqual(
  contract.derivedView.rows.filter((row) => row.denominatorSurrenderOrCancellationVerified).map((row) => row.caseId),
  [APTIV_CASE],
);
for (const row of contract.derivedView.rows) {
  for (const ratio of row.ratios) {
    assert.equal(typeof ratio.denominatorSecurityText, 'string');
    assert.match(ratio.denominatorUnits, /^[1-9][0-9]*$/);
  }
}

const head = git('rev-parse', 'HEAD');
assert.equal(git('rev-parse', '@{upstream}'), head);
assert.equal(git('remote', 'get-url', 'origin'), REMOTE_URL);
assert.equal(git('ls-remote', '--refs', 'origin', REMOTE_REF).split(/\s+/)[0], head);
assert.ok(git('rev-list', '--first-parent', head).split(/\r?\n/).includes(MINIMUM_ANCESTOR));
const ownCommitted = OWN_PATHS.map((relative) => gitExists(head, relative));
assert.equal(new Set(ownCommitted).size, 1, 'V3 paths must be all committed or all uncommitted');
const expectedPhase = ownCommitted[0] ? 'POST_INTRODUCTION' : 'PRE_INTRODUCTION';
if (expectedPhase === 'POST_INTRODUCTION') {
  const introductions = new Set(OWN_PATHS.map((relative) => git('log', '--diff-filter=A', '-1', '--format=%H', '--', relative)));
  assert.equal(introductions.size, 1);
  const introduction = [...introductions][0];
  const parents = git('show', '-s', '--format=%P', introduction).split(/\s+/);
  assert.equal(parents.length, 1);
  assert.ok(git('rev-list', '--first-parent', parents[0]).split(/\r?\n/).includes(MINIMUM_ANCESTOR));
  const changes = git('diff-tree', '--root', '--no-commit-id', '--name-status', '-r', introduction).split(/\r?\n/);
  assert.deepEqual(new Set(changes), new Set(OWN_PATHS.map((relative) => `A\t${relative}`)));
}

for (const binding of Object.values(contract.sourceBindings.repoFiles)) {
  const absolute = path.join(ROOT, ...binding.path.split('/'));
  const raw = fs.readFileSync(absolute);
  assert.equal(raw.length, binding.bytes);
  assert.equal(sha(raw), binding.rawSha256);
  assert.equal(git('rev-parse', `HEAD:${binding.path}`), binding.gitBlob);
  assert.equal(git('log', '--diff-filter=A', '-1', '--format=%H', '--', binding.path), binding.introductionCommit);
}

const modeResults = [];
for (const optimized of [false, true]) {
  const self = parseSuccess('self-test', optimized);
  assert.equal(self.status, 'PASS');
  assert.equal(self.phase, expectedPhase);
  assert.equal(self.head, head);
  assert.equal(self.remoteVerified, true);
  assert.equal(self.derivedViewSha256, EXPECTED_DERIVED_SHA);
  assert.equal(Object.keys(self.kills).length, 11);
  assert.deepEqual(new Set(Object.values(self.kills)), new Set([true]));
  for (const required of [
    'contractPathRedirect', 'authorizedPathsChanged', 'populationChanged', 'lockKeyRenamed',
    'secPathRedirect', 'nonAptivSurrenderOverclaim', 'aptivCancellationCreditRemoved',
    'legacySurrenderedFieldRestored', 'ratioDirectionReversed', 'rowRemoved', 'noRemoteVerify',
  ]) assert.equal(self.kills[required], true);

  const verified = parseSuccess('verify', optimized);
  assert.equal(verified.status, 'PASS');
  assert.equal(verified.phase, expectedPhase);
  assert.equal(verified.head, head);
  assert.equal(verified.remoteVerified, true);
  assert.equal(verified.contractRawVerifiedBeforeParse, true);
  assert.equal(verified.sourceRebuildByteExact, true);
  assert.equal(verified.derivedViewSha256, EXPECTED_DERIVED_SHA);
  assert.deepEqual(verified.denominatorSurrenderOrCancellationVerifiedCaseIds, [APTIV_CASE]);
  assert.equal(verified.outcomesAccessed, false);
  modeResults.push(verified);

  const localOnly = invoke('verify', optimized, false);
  assert.notEqual(localOnly.status, 0, 'verify without --remote must fail closed');
  assert.equal(localOnly.stdout.trim(), '');
  const failure = JSON.parse(localOnly.stderr.trim());
  assert.equal(failure.status, 'FAIL');
  assert.match(failure.error, /requires --remote/);
  assert.equal(failure.outcomesAccessed, false);
}
assert.deepEqual(modeResults[1], modeResults[0], 'normal and optimized remote verification must match exactly');

console.log(JSON.stringify({
  status: 'PASS',
  phase: expectedPhase,
  head,
  modes: ['normal', 'optimized'],
  remoteVerifiedPerMode: true,
  noRemoteKilledPerMode: true,
  correctedRows: 6,
  ratioRows: 8,
  derivedViewSha256: EXPECTED_DERIVED_SHA,
  contractRawSha256: EXPECTED_CONTRACT_RAW,
  verifierRawSha256: EXPECTED_VERIFIER_RAW,
  outcomesAccessed: false,
}));
