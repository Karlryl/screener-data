#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = 'scripts/verify-sec-frozen-terminal-distribution-receipt-evidence-output-v3.py';
const CONTRACT = path.join(ROOT, 'research', 'early-detection-v4', 'sec-frozen-terminal-distribution-receipt-evidence-output-seal-contract-v3.json');
const VERIFIER = path.join(ROOT, SCRIPT);
const OUTPUT = path.join(ROOT, 'reports', 'early-detection', 'sec-frozen-terminal-distribution-receipt-evidence-v2.json');
const CONTRACT_RAW = 'bd70e619527de52a7569a858a6f0610e8689fc27a9845ac8b83b364990283843';
const CONTRACT_SELF = '451338df79abdb766e3950a26aee5e4421a960bea7b62671b57ddc5b41f0b3f2';
const VERIFIER_RAW = '695f67d5ade3f41a6529e0d0946e0eff6fc7ce458dc572fe3d0c7e7ae92c85b2';
const OUTPUT_RAW = 'bfd0b4e4582e1267a311e5d79a63a19339e3a9967980f542148c9173c97d13dc';
const REPORT_SELF = '7967bd2ed2634568a785a5ec4e76d209db7ae10dc9ec9b1d72681144f5200104';
const TAG849 = '3460af91b083b6e4a142479a7dcb376ef37c2df6';
const TAG850 = 'ee21b932abbb31c24c97fab093d8b98b62f7c3e9';
const PRE_SEAL_PARENT = '2a5ea8234c424c8b7398c54fde8e985d73039a37';

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

function run(optimized, command, extra = []) {
  const prefix = optimized ? ['-O', '-B'] : ['-B'];
  const result = spawnSync(process.env.PYTHON || 'python', [...prefix, SCRIPT, command, ...extra], {
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

const contractRaw = fs.readFileSync(CONTRACT);
assert.equal(sha(contractRaw), CONTRACT_RAW);
assert.equal(sha(fs.readFileSync(VERIFIER)), VERIFIER_RAW);
const outputBefore = fs.readFileSync(OUTPUT);
assert.equal(sha(outputBefore), OUTPUT_RAW);
const contract = JSON.parse(contractRaw);
const contractBody = { ...contract };
delete contractBody.contractSha256;
assert.equal(contract.contractSha256, CONTRACT_SELF);
assert.equal(sha(Buffer.from(canonical(contractBody), 'utf8')), CONTRACT_SELF);
assert.equal(contract.v2ImplementationBinding.introductionCommit, TAG849);
assert.equal(contract.outputBinding.introductionCommit, TAG850);
assert.equal(contract.outputBinding.introductionParent, TAG849);
assert.equal(contract.outputBinding.reportSha256, REPORT_SELF);
assert.equal(contract.expectedCases.length, 5);
assert.equal(new Set(contract.expectedCases.map((row) => row.rowCanonicalSha256)).size, 5);
assert.deepEqual(new Set(Object.values(contract.claimLocks)), new Set([false]));

const head = git('rev-parse', 'HEAD');
const phase = head === PRE_SEAL_PARENT ? 'PRE_INTRODUCTION' : 'SEALED';
if (phase === 'SEALED') {
  assert.equal(git('rev-list', '--parents', '-n', '1', head), `${head} ${PRE_SEAL_PARENT}`);
  assert.deepEqual(new Set(git('diff-tree', '--no-commit-id', '--name-status', '-r', head).split(/\r?\n/)), new Set([
    'A\tresearch/early-detection-v4/sec-frozen-terminal-distribution-receipt-evidence-output-seal-contract-v3.json',
    'A\tscripts/verify-sec-frozen-terminal-distribution-receipt-evidence-output-v3.py',
    'A\ttests/verify-sec-frozen-terminal-distribution-receipt-evidence-output-v3.test.js',
  ]));
}

for (const optimized of [false, true]) {
  const selfTest = run(optimized, 'self-test');
  assert.equal(selfTest.status, 'PASS');
  assert.equal(selfTest.verifiedRows, 5);
  assert.equal(selfTest.claimLocksFalse, 13);
  assert.equal(selfTest.filesWritten, 0);
  assert.equal(selfTest.outcomesAccessed, false);
  assert.deepEqual(new Set(Object.values(selfTest.mutationKills)), new Set([true]));
  for (const mutation of [
    'rowLoss', 'rowReorder', 'sourceHash', 'reportHash', 'claimRaised', 'outcomeRaised',
    'topologyV2Parent', 'topologyOutputParent', 'topologyOutputExtraPath', 'topologySealParent',
  ]) assert.equal(selfTest.mutationKills[mutation], true, mutation);

  const verified = run(optimized, 'verify', ['--remote']);
  assert.equal(verified.status, 'PASS');
  assert.equal(verified.phase, phase);
  assert.equal(verified.currentHead, head);
  assert.equal(verified.v2ImplementationIntroduction, TAG849);
  assert.equal(verified.outputIntroduction, TAG850);
  assert.equal(verified.outputRawSha256, OUTPUT_RAW);
  assert.equal(verified.reportSha256, REPORT_SELF);
  assert.equal(verified.sourceRebuildByteExact, true);
  assert.equal(verified.verifiedRows, 5);
  assert.equal(verified.claimLocksFalse, 13);
  assert.equal(verified.outcomesAccessed, false);
}

assert.equal(sha(fs.readFileSync(OUTPUT)), sha(outputBefore), 'output verifier mutated the sealed output');
console.log(JSON.stringify({
  status: 'PASS',
  modes: ['normal', 'optimized'],
  phase,
  currentHead: head,
  v2ImplementationIntroduction: TAG849,
  outputIntroduction: TAG850,
  outputRawSha256: OUTPUT_RAW,
  reportSha256: REPORT_SELF,
  sourceRebuildByteExact: true,
  verifiedRows: 5,
  outcomesAccessed: false,
}));
