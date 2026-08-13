#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = 'scripts/build-sec-frozen-terminal-distribution-receipt-evidence-v2.py';
const CONTRACT = path.join(ROOT, 'research', 'early-detection-v4', 'sec-frozen-terminal-distribution-receipt-evidence-contract-v2.json');
const BUILDER = path.join(ROOT, 'scripts', 'build-sec-frozen-terminal-distribution-receipt-evidence-v2.py');
const OUTPUT = path.join(ROOT, 'reports', 'early-detection', 'sec-frozen-terminal-distribution-receipt-evidence-v2.json');
const EXPECTED_CONTRACT_RAW = '2e0027632ccc934a1a6ce997dd8fea4355a89aba71b971d856916ce86f25747c';
const EXPECTED_CONTRACT_SELF = '90b5a9ee9914bfb4c7badf88336267af13a532422666e022023e5136d33fb15e';
const EXPECTED_BUILDER_RAW = 'befd0072df14728a4399c8556f3702c3d2f5f41271856010b0c52b7f646186a4';
const PRE_PARENT = '3dafd784e3fcfe6da053c710d0b5a5d4b002939b';
const EXPECTED_SCOPE = 'EXACT_FIVE_FROZEN_PRIMARY_SEC_SENTENCES_ONLY_NO_GENERAL_SELECTOR';
const EXPECTED_ACCESSIONS = [
  '0000891377-11-000008',
  '0000903423-11-000138',
  '0000903423-11-000139',
  '0000903423-11-000140',
  '0000950157-22-000333',
];

function sha(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function git(...args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function run(optimized, command) {
  const prefix = optimized ? ['-O', '-B'] : ['-B'];
  const result = spawnSync(process.env.PYTHON || 'python', [...prefix, SCRIPT, command], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    timeout: 180000,
    maxBuffer: 10 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `${command} failed:\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout.trim());
}

assert.equal(sha(fs.readFileSync(CONTRACT)), EXPECTED_CONTRACT_RAW);
assert.equal(sha(fs.readFileSync(BUILDER)), EXPECTED_BUILDER_RAW);
assert.equal(fs.existsSync(OUTPUT), false, 'V2 output must remain absent before implementation promotion');
const contract = JSON.parse(fs.readFileSync(CONTRACT, 'utf8'));
const body = { ...contract };
delete body.contractSha256;
assert.equal(contract.contractSha256, EXPECTED_CONTRACT_SELF);
assert.equal(sha(Buffer.from(canonical(body), 'utf8')), EXPECTED_CONTRACT_SELF);
assert.equal(contract.implementationContract.preImplementationParentCommit, PRE_PARENT);
assert.equal(contract.implementationContract.preImplementationParentTag, 848);
assert.equal(contract.immutableV1Base.introductionCommit, '34d7b2be658c95666b6f31be8bdc4cfd2f580875');
assert.equal(contract.immutableV1Base.contract.gitRawSha256, 'ac6e7fb337c897b1c7b6829c9beb0136e5a1d902e38d6f9e9bac261421edb9f4');
assert.equal(contract.immutableV1Base.builder.gitRawSha256, 'ebf99fb25e3f3972e23b8d59c3676f8d44cf00cdbad61719372f458fa80e9176');
assert.equal(contract.immutableV1Base.test.gitRawSha256, '16c5157bc7cff6795037d8115f19d7537dd3b2d20f7f4258d1bab09c84a9a73b');
assert.equal(contract.inputs.originalInventoryV4.builderGitRawSha256, '369bb7b808aaf2cfb00cb7ffa8b3a4254a74d7938f2f8aac5839b15186bcb2e2');
assert.equal(contract.inputs.originalInventoryV4.testGitRawSha256, '0dc290c7a6792e724e1859faf64b4d1d1dcebdb5b18a9736cd843ff1a8a38085');
assert.equal(contract.inputs.originalInventoryV4.supersededV1BuilderWorktreeCrLfSha256, 'cb46d6d97d7da4433f9436ca20c18cf02ddfdeee1a7851618c3d719377ae2178');
assert.equal(contract.inputs.originalInventoryV4.supersededV1TestWorktreeCrLfSha256, '28d799c9961bcd4f0f33d6833d8d73aa52b75c9bd8ad621de826630fb8bcf080');
assert.deepEqual(contract.frozenCaseBindings.map((row) => row.accession), EXPECTED_ACCESSIONS);
assert.equal(new Set(contract.frozenCaseBindings.map((row) => row.v1FrozenRowCanonicalSha256)).size, 5);
assert.equal(contract.policy.scopeLimit, EXPECTED_SCOPE);
assert.equal(contract.policy.expectedRows, 5);
assert.deepEqual(new Set(Object.values(contract.claimLocks)), new Set([false]));
const head = git('rev-parse', 'HEAD');
const expectedPhase = head === PRE_PARENT ? 'PRE_IMPLEMENTATION' : 'IMPLEMENTED_NO_OUTPUT';
if (expectedPhase === 'IMPLEMENTED_NO_OUTPUT') {
  assert.equal(git('rev-list', '--parents', '-n', '1', head), `${head} ${PRE_PARENT}`);
  const changes = git('diff-tree', '--no-commit-id', '--name-status', '-r', head).split(/\r?\n/);
  assert.deepEqual(new Set(changes), new Set([
    'A\tresearch/early-detection-v4/sec-frozen-terminal-distribution-receipt-evidence-contract-v2.json',
    'A\tscripts/build-sec-frozen-terminal-distribution-receipt-evidence-v2.py',
    'A\ttests/build-sec-frozen-terminal-distribution-receipt-evidence-v2.test.js',
  ]));
}

for (const optimized of [false, true]) {
  const verified = run(optimized, 'verify-contract');
  assert.equal(verified.status, 'PASS');
  assert.equal(verified.phase, expectedPhase);
  assert.equal(verified.baseCommit, head);
  assert.equal(verified.verifiedRows, 5);
  assert.equal(verified.scopeLimit, EXPECTED_SCOPE);
  assert.equal(verified.inventoryBuilderGitRawSha256, '369bb7b808aaf2cfb00cb7ffa8b3a4254a74d7938f2f8aac5839b15186bcb2e2');
  assert.equal(verified.inventoryTestGitRawSha256, '0dc290c7a6792e724e1859faf64b4d1d1dcebdb5b18a9736cd843ff1a8a38085');
  assert.equal(verified.outcomesAccessed, false);

  const selfTest = run(optimized, 'self-test');
  assert.equal(selfTest.status, 'PASS');
  assert.equal(selfTest.verifiedRows, 5);
  assert.ok(selfTest.v1MutationKills >= 29);
  assert.deepEqual(new Set(Object.values(selfTest.v2MutationKills)), new Set([true]));
  assert.equal(selfTest.outcomesAccessed, false);

  const dryRun = run(optimized, 'dry-run');
  assert.equal(dryRun.status, 'PASS');
  assert.equal(dryRun.phase, expectedPhase);
  assert.equal(dryRun.baseCommit, head);
  assert.equal(dryRun.verifiedRows, 5);
  assert.match(dryRun.reportSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(dryRun.population, {
    frozenEvidenceRows: 5,
    uniqueAccessions: 5,
    datedFinalDistributionStatementRows: 3,
    actualFirstLiquidatingDistributionByChecksStatementRows: 1,
    actualDefaultMixedConsiderationReceiptStatementRows: 1,
    finalLiquidatingDistributionVerifiedRows: 0,
    noFurtherDistributionsVerifiedRows: 0,
    postClosingRecoveryVerifiedRows: 0,
    terminalWealthCompleteRows: 0,
  });
  assert.equal(dryRun.scopeLimit, EXPECTED_SCOPE);
  assert.equal(dryRun.outcomesAccessed, false);
}

assert.equal(fs.existsSync(OUTPUT), false, 'V2 validation must not create output');
console.log(JSON.stringify({
  status: 'PASS',
  modes: ['normal', 'optimized'],
  verifiedRows: 5,
  preImplementationParent: PRE_PARENT,
  inventoryBuilderGitRawSha256: contract.inputs.originalInventoryV4.builderGitRawSha256,
  inventoryTestGitRawSha256: contract.inputs.originalInventoryV4.testGitRawSha256,
  outputCreated: false,
  outcomesAccessed: false,
}));
