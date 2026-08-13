#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const runner = path.join(root, 'scripts', 'capture-sec-liquidation-downstream-filings-v2.py');
const privateRoot = 'C:\\Users\\Anwender\\Documents\\GrowthScreenerResearchData\\early-detection-v4\\liquidation-downstream-sec-originals-v1';
const v1Manifest = path.join(privateRoot, 'manifest.json');
const v1ManifestRaw = '68d0c28537762321028aa638b5b2e83b071bae656d2bb82726f8f8e1cd8981dd';

function sha256(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function run(args, optimized = false, expected = 0) {
  const command = optimized ? ['-O', '-B', runner, ...args] : ['-B', runner, ...args];
  const result = spawnSync('python', command, { cwd: root, encoding: 'utf8' });
  assert.strictEqual(result.status, expected, `${command.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result;
}

const before = fs.readFileSync(v1Manifest);
assert.strictEqual(sha256(before), v1ManifestRaw);

for (const optimized of [false, true]) {
  const verify = JSON.parse(run(['verify-contract', '--remote'], optimized).stdout);
  assert.strictEqual(verify.status, 'PASS');
  assert.strictEqual(verify.remoteVerified, true);
  assert.strictEqual(verify.checkpointCaptured, 72);
  assert.strictEqual(verify.candidateFilings, 115);
  assert.ok(['PRE_INTRODUCTION', 'POST_INTRODUCTION'].includes(verify.phase));
  assert.strictEqual(verify.resumeAuthorized, verify.phase === 'POST_INTRODUCTION');

  const dry = JSON.parse(run(['dry-run', '--remote'], optimized).stdout);
  assert.strictEqual(dry.status, 'PASS');
  assert.strictEqual(dry.networkRequests, 0);
  assert.strictEqual(dry.writes, 0);
  assert.strictEqual(dry.checkpointCaptured, 72);
  assert.ok(dry.currentCaptured >= 72 && dry.currentCaptured <= 115);
  assert.strictEqual(dry.remainingCandidates, 115 - dry.currentCaptured);
  assert.ok(dry.historicalDeferredEvents >= 1);
  assert.ok(dry.maximumRequestSequence >= 73);
  assert.match(dry.currentManifestSha256, /^[0-9a-f]{64}$/);
  assert.strictEqual(dry.outcomesAccessed, false);

  const self = JSON.parse(run(['self-test', '--remote'], optimized).stdout);
  assert.strictEqual(self.status, 'PASS');
  assert.strictEqual(Object.keys(self.mutationKills).length, 23);
  assert.ok(Object.values(self.mutationKills).every(Boolean));
  assert.strictEqual(self.outcomesAccessed, false);

  run(['verify-contract'], optimized, 2);
}

const after = fs.readFileSync(v1Manifest);
assert.strictEqual(sha256(after), v1ManifestRaw);
assert.deepStrictEqual(after, before);
console.log(JSON.stringify({ status: 'PASS', v1ManifestPreserved: true, networkRequests: 0, writes: 0, outcomesAccessed: false }));
