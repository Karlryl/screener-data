#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = 'scripts/build-sec-frozen-noncash-share-receipt-evidence-v1.py';
const CONTRACT = path.join(ROOT, 'research', 'early-detection-v4', 'sec-frozen-noncash-share-receipt-evidence-contract-v1.json');
const BUILDER = path.join(ROOT, SCRIPT);
const TEST = path.join(ROOT, 'tests', 'build-sec-frozen-noncash-share-receipt-evidence-v1.test.js');
const OUTPUT = path.join(ROOT, 'reports', 'early-detection', 'sec-frozen-noncash-share-receipt-evidence-v1.json');
const EXPECTED_CONTRACT_RAW = '9451a82d6a7e51d7d531b6a035fdc9afb1d3794fd117e677c1021d6a68fa83b2';
const EXPECTED_CONTRACT_SELF = '5dc2eb5bb282203c03cafa5cef44e4329c5082d850b0faf57c1512aefff96131';
const EXPECTED_BUILDER_RAW = 'de7c05e430af3ad50b51e13232e1fe81bf6c29cb962b55de10f94147e883d4e1';
const BASE_COMMIT = '996fd2eeb7f2193cfc6352ca15ab544d3f09ae4c';
const REMOTE_REF = 'refs/heads/codex/early-detection-v4-gates-20260810';
const EXPECTED_SCOPE = 'EXACT_SIX_FROZEN_PRIMARY_SEC_SENTENCES_ONLY_NO_GENERAL_SELECTOR';
const EXPECTED_CEILING = 'EXACT_SIX_COMPLETED_NONCASH_SHARE_RECEIPTS_WITH_EXPLICIT_RATIOS';
const EXPECTED_ACCESSIONS = [
  '0000950103-18-000919',
  '0000950103-18-003297',
  '0000950103-20-021106',
  '0001193125-24-286219',
  '0001213900-23-091028',
  '0001213900-24-111979',
];
const OWN_PATHS = [
  'research/early-detection-v4/sec-frozen-noncash-share-receipt-evidence-contract-v1.json',
  SCRIPT,
  'tests/build-sec-frozen-noncash-share-receipt-evidence-v1.test.js',
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

function run(optimized, command) {
  const prefix = optimized ? ['-O', '-B'] : ['-B'];
  const result = spawnSync(process.env.PYTHON || 'python', [...prefix, SCRIPT, command], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    timeout: 180000,
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `${command} failed:\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout.trim());
}

assert.equal(sha(fs.readFileSync(CONTRACT)), EXPECTED_CONTRACT_RAW);
assert.equal(sha(fs.readFileSync(BUILDER)), EXPECTED_BUILDER_RAW);
assert.equal(fs.existsSync(TEST), true);
assert.equal(fs.existsSync(OUTPUT), false, 'future noncash output must remain absent');

const contract = JSON.parse(fs.readFileSync(CONTRACT, 'utf8'));
const contractBody = { ...contract };
delete contractBody.contractSha256;
assert.equal(contract.contractSha256, EXPECTED_CONTRACT_SELF);
assert.equal(sha(Buffer.from(canonical(contractBody), 'utf8')), EXPECTED_CONTRACT_SELF);
assert.equal(contract.baseSeal.baseCommit, BASE_COMMIT);
assert.equal(contract.baseSeal.baseTag, 854);
assert.equal(contract.baseSeal.implementationIntroductionMayFollowLinearIntermediateCommits, true);
assert.deepEqual(contract.implementationContract.implementationPaths, OWN_PATHS);
assert.equal(contract.evidencePolicy.scopeLimit, EXPECTED_SCOPE);
assert.equal(contract.evidencePolicy.semanticCeiling, EXPECTED_CEILING);
assert.equal(contract.evidencePolicy.expectedRows, 6);
assert.equal(contract.evidencePolicy.expectedRatioRows, 8);
assert.equal(contract.evidencePolicy.expectedDualRatioRows, 2);
assert.deepEqual(contract.frozenCases.map((row) => row.accession), EXPECTED_ACCESSIONS);
assert.deepEqual(contract.frozenCases.map((row) => row.ratios.length), [1, 1, 1, 1, 2, 2]);
assert.equal(new Set(contract.frozenCases.map((row) => row.evidenceSentenceSha256)).size, 6);
assert.equal(new Set(contract.frozenCases.map((row) => row.blobSha256)).size, 6);
assert.equal(new Set(contract.frozenCases.map((row) => row.sourceOccurrenceId)).size, 6);
assert.deepEqual(new Set(Object.values(contract.claimLocks)), new Set([false]));
assert.deepEqual(contract.deduplicationContract.expectedIntersectionCountByDimension, {
  ACCESSION: 0,
  ACCESSION_BLOB_DOCUMENT_SENTENCE_PROVENANCE: 0,
  BLOB_SHA256: 0,
  EVIDENCE_SENTENCE_SHA256: 0,
});

const head = git('rev-parse', 'HEAD');
assert.ok(git('rev-list', '--first-parent', head).split(/\r?\n/).includes(BASE_COMMIT));
assert.equal(git('ls-remote', '--refs', 'origin', REMOTE_REF).split(/\s+/)[0], head);
const committed = OWN_PATHS.map((relative) => gitExists(head, relative));
assert.equal(new Set(committed).size, 1, 'implementation paths must be all committed or all uncommitted');
const expectedPhase = committed[0] ? 'IMPLEMENTED_NO_OUTPUT' : 'PRE_IMPLEMENTATION';
if (expectedPhase === 'IMPLEMENTED_NO_OUTPUT') {
  const introductions = new Set(OWN_PATHS.map((relative) => git('log', '--diff-filter=A', '-1', '--format=%H', '--', relative)));
  assert.equal(introductions.size, 1);
  const introduction = [...introductions][0];
  const parentRow = git('rev-list', '--parents', '-n', '1', introduction).split(/\s+/);
  assert.equal(parentRow.length, 2);
  assert.ok(git('rev-list', '--first-parent', parentRow[1]).split(/\r?\n/).includes(BASE_COMMIT));
  assert.ok(git('rev-list', '--first-parent', head).split(/\r?\n/).includes(introduction));
  const changes = git('diff-tree', '--no-commit-id', '--name-status', '-r', introduction).split(/\r?\n/);
  assert.deepEqual(new Set(changes), new Set(OWN_PATHS.map((relative) => `A\t${relative}`)));
}

const modeDryRuns = [];
for (const optimized of [false, true]) {
  const verified = run(optimized, 'verify-contract');
  assert.equal(verified.status, 'PASS');
  assert.equal(verified.phase, expectedPhase);
  assert.equal(verified.baseSealCommit, BASE_COMMIT);
  assert.equal(verified.currentCommit, head);
  assert.equal(verified.verifiedRows, 6);
  assert.equal(verified.ratioRows, 8);
  assert.equal(verified.scopeLimit, EXPECTED_SCOPE);
  assert.equal(verified.outcomesAccessed, false);

  const selfTest = run(optimized, 'self-test');
  assert.equal(selfTest.status, 'PASS');
  assert.equal(selfTest.verifiedRows, 6);
  assert.equal(selfTest.ratioRows, 8);
  assert.equal(Object.keys(selfTest.mutationKills).length, 24);
  assert.deepEqual(new Set(Object.values(selfTest.mutationKills)), new Set([true]));
  for (const required of [
    'receiptEvidenceHashChanged', 'ratioUnitChanged', 'ratioDualCollapsed',
    'sourceBlobChanged', 'sourceContextChanged', 'sourceCandidateChanged',
    'dedupAccessionOverlap', 'dedupBlobOverlap', 'dedupEvidenceOverlap',
    'dedupProvenanceOverlap', 'claimCashRaised', 'claimTerminalRaised',
    'topologyBaseChanged', 'topologyIntroductionChanged', 'implementationBytesChanged',
  ]) assert.equal(selfTest.mutationKills[required], true);
  assert.equal(selfTest.outcomesAccessed, false);

  const dryRun1 = run(optimized, 'dry-run');
  const dryRun2 = run(optimized, 'dry-run');
  assert.deepEqual(dryRun2, dryRun1, 'same-mode dry-run must be byte-equivalent JSON');
  assert.equal(dryRun1.status, 'PASS');
  assert.equal(dryRun1.phase, expectedPhase);
  assert.equal(dryRun1.baseSealCommit, BASE_COMMIT);
  assert.equal(dryRun1.currentCommit, head);
  assert.deepEqual(dryRun1.population, {
    actualNoncashShareReceiptStatementRows: 6,
    dualRatioRows: 2,
    frozenEvidenceRows: 6,
    ratioRows: 8,
    uniqueAccessions: 6,
  });
  assert.match(dryRun1.rawSha256, /^[0-9a-f]{64}$/);
  assert.match(dryRun1.reportSha256, /^[0-9a-f]{64}$/);
  assert.equal(dryRun1.scopeLimit, EXPECTED_SCOPE);
  assert.equal(dryRun1.semanticCeiling, EXPECTED_CEILING);
  assert.equal(dryRun1.outcomesAccessed, false);
  modeDryRuns.push(dryRun1);
}

assert.deepEqual(modeDryRuns[1], modeDryRuns[0], 'normal and optimized dry-runs must be byte-equivalent JSON');
assert.equal(fs.existsSync(OUTPUT), false, 'validation must not create future output');
console.log(JSON.stringify({
  status: 'PASS',
  modes: ['normal', 'optimized'],
  dryRunsPerMode: 2,
  verifiedRows: 6,
  ratioRows: 8,
  dualRatioRows: 2,
  baseSealCommit: BASE_COMMIT,
  currentCommit: head,
  phase: expectedPhase,
  contractRawSha256: EXPECTED_CONTRACT_RAW,
  builderRawSha256: EXPECTED_BUILDER_RAW,
  outputCreated: false,
  outcomesAccessed: false,
}));
