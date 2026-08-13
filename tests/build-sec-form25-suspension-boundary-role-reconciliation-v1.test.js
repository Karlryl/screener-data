#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = 'scripts/build-sec-form25-suspension-boundary-role-reconciliation-v1.py';
const CONTRACT = path.join(ROOT, 'research', 'early-detection-v4',
  'sec-form25-suspension-boundary-role-reconciliation-contract-v1.json');

function sha(raw) { return crypto.createHash('sha256').update(raw).digest('hex'); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
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
assert.equal(contract.contractSha256, sha(Buffer.from(canonical(body))));
assert.equal(sha(normalizedBuilder(fs.readFileSync(path.join(ROOT, SCRIPT)))),
  contract.implementationContract.builderNormalizedSha256);
assert.equal(sha(fs.readFileSync(__filename)), contract.implementationContract.testRawSha256);
assert.equal(contract.expectedRebuild.boundaryRoleProjectionRows, 12727);
assert.equal(contract.expectedRebuild.uniqueSuspensionEvents, 6366);
assert.equal(contract.expectedRebuild.modernPairedEvents, 6361);
assert.equal(contract.expectedRebuild.legacySingleFilerEvents, 5);
assert.equal(contract.expectedRebuild.secOriginalBlobsVerified, 6366);
assert.deepEqual(new Set(Object.values(contract.claimLocks)), new Set([false]));

const modeReports = [];
for (const prefix of [['-B'], ['-O', '-B']]) {
  const noRemote = run(prefix, 'dry-run', false);
  assert.notEqual(noRemote.status, 0);
  assert.match(noRemote.stderr, /live remote verification is mandatory/);
  const verified = parsed(run(prefix, 'verify-contract'));
  assert.equal(verified.status, 'PASS');
  assert.equal(verified.remoteVerified, true);
  const selfTest = parsed(run(prefix, 'self-test'));
  assert.equal(selfTest.status, 'PASS');
  assert.ok(Object.keys(selfTest.mutationKills).length >= 30);
  assert.deepEqual(new Set(Object.values(selfTest.mutationKills)), new Set([true]));
  const first = parsed(run(prefix, 'dry-run'));
  const second = parsed(run(prefix, 'dry-run'));
  assert.deepEqual(first, second);
  assert.equal(first.population.boundaryRoleProjectionRows, 12727);
  assert.equal(first.population.uniqueSuspensionEvents, 6366);
  assert.equal(first.population.modernPairedEvents, 6361);
  assert.equal(first.population.legacySingleFilerEvents, 5);
  assert.equal(first.population.secOriginalBlobsVerified, 6366);
  assert.equal(first.population.queueRowsStillUnresolved, 12727);
  assert.equal(first.publicOutputCreated, false);
  assert.equal(first.identityResolved, false);
  assert.equal(first.pricesAccessed, false);
  assert.equal(first.returnsAccessed, false);
  assert.equal(first.outcomesAccessed, false);
  modeReports.push(first);
}
assert.deepEqual(modeReports[0], modeReports[1]);

console.log(JSON.stringify({
  status: 'PASS',
  modes: ['normal', 'optimized'],
  uniqueSuspensionEvents: 6366,
  modernPairedEvents: 6361,
  legacySingleFilerEvents: 5,
  boundaryRoleProjectionRows: 12727,
  identityResolved: false,
  outcomesAccessed: false,
}));
