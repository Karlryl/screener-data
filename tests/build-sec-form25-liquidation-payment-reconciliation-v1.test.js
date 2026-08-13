#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = 'scripts/build-sec-form25-liquidation-payment-reconciliation-v1.py';
const CONTRACT = path.join(ROOT, 'research', 'early-detection-v4', 'sec-form25-liquidation-payment-reconciliation-contract-v1.json');

function sha(raw) { return crypto.createHash('sha256').update(raw).digest('hex'); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function normalizedBuilder(raw) {
  let text = raw.toString('utf8').replaceAll('\r\n', '\n');
  for (const name of ['CONTRACT_RAW', 'CONTRACT_SELF']) {
    const expression = new RegExp(`^${name} = "[0-9a-fA-Z_]+"$`, 'm');
    assert.equal((text.match(expression) || []).length, 1);
    text = text.replace(expression, `${name} = "${'0'.repeat(64)}"`);
  }
  return Buffer.from(text);
}
function run(prefix, command, remote = true) {
  const args = [...prefix, SCRIPT, command];
  if (remote) args.push('--remote');
  return spawnSync(process.env.PYTHON || 'python', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, timeout: 240000, maxBuffer: 16 * 1024 * 1024 });
}
function parsed(result) { assert.equal(result.status, 0, result.stderr || result.stdout); return JSON.parse(result.stdout.trim()); }

const contractRaw = fs.readFileSync(CONTRACT);
const contract = JSON.parse(contractRaw.toString('utf8'));
const body = { ...contract }; delete body.contractSha256;
assert.equal(contract.contractSha256, sha(Buffer.from(canonical(body))));
assert.equal(sha(normalizedBuilder(fs.readFileSync(path.join(ROOT, SCRIPT)))), contract.implementationContract.builderNormalizedSha256);
assert.equal(sha(fs.readFileSync(__filename)), contract.implementationContract.testRawSha256);
assert.equal(contract.expectedRebuild.liquidationRows, 17);
assert.equal(contract.expectedRebuild.uniqueBoundaryEventProvenances, 17);
assert.equal(contract.expectedRebuild.boundaryRoleProjectionRows, 34);
assert.equal(contract.expectedRebuild.queueRoleProjectionRows, 34);
assert.equal(contract.expectedRebuild.duplicateBoundaryRoleProjectionPairs, 17);
assert.equal(contract.expectedRebuild.secHeaderSubjectVerifiedEvents, 17);
assert.equal(contract.expectedRebuild.secHeaderFiledByVerifiedEvents, 17);
assert.equal(contract.expectedRebuild.sourceBlobBytesVerified, 17);
assert.equal(contract.expectedRebuild.uniqueSecurityTriples, 17);
assert.equal(contract.expectedRebuild.recipientExplicitRows, 4);
assert.equal(contract.expectedRebuild.currencyResolvedRows, 0);
assert.deepEqual(new Set(Object.values(contract.claimLocks)), new Set([false]));

for (const prefix of [['-B'], ['-O', '-B']]) {
  const noRemote = run(prefix, 'dry-run', false);
  assert.notEqual(noRemote.status, 0);
  assert.match(noRemote.stderr, /live remote verification is mandatory/);
  const checked = parsed(run(prefix, 'verify-contract'));
  assert.equal(checked.status, 'PASS');
  assert.equal(checked.remoteVerified, true);
  const selfTest = parsed(run(prefix, 'self-test'));
  assert.equal(selfTest.status, 'PASS');
  assert.ok(Object.keys(selfTest.mutationKills).length >= 28);
  assert.deepEqual(new Set(Object.values(selfTest.mutationKills)), new Set([true]));
  const first = parsed(run(prefix, 'dry-run'));
  const second = parsed(run(prefix, 'dry-run'));
  assert.deepEqual(first, second);
  assert.equal(first.population.liquidationRows, 17);
  assert.equal(first.population.uniqueBoundaryEventProvenances, 17);
  assert.equal(first.population.boundaryRoleProjectionRows, 34);
  assert.equal(first.population.queueRoleProjectionRows, 34);
  assert.equal(first.population.duplicateBoundaryRoleProjectionPairs, 17);
  assert.equal(first.population.secHeaderSubjectVerifiedEvents, 17);
  assert.equal(first.population.secHeaderFiledByVerifiedEvents, 17);
  assert.equal(first.population.sourceBlobBytesVerified, 17);
  assert.equal(first.population.uniqueSecurityTriples, 17);
  assert.equal(first.population.recipientExplicitRows, 4);
  assert.equal(first.population.currencyResolvedRows, 0);
  assert.equal(first.publicOutputCreated, false);
  assert.equal(first.pricesAccessed, false);
  assert.equal(first.returnsAccessed, false);
  assert.equal(first.outcomesAccessed, false);
}

console.log(JSON.stringify({ status: 'PASS', modes: ['normal', 'optimized'], uniqueBoundaryEvents: 17,
  boundaryRoleProjections: 34, queueRoleProjections: 34, secHeadersVerified: 17,
  recipientExplicitRows: 4, currencyResolvedRows: 0, outcomesAccessed: false }));
