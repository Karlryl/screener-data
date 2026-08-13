#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'capture-sec-liquidation-downstream-filings-v1.py');

function run(args, optimized = false) {
  const result = spawnSync('python', [...(optimized ? ['-O'] : []), '-B', script, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

const normalVerify = run(['verify-contract', '--remote']);
const optimizedVerify = run(['verify-contract', '--remote'], true);
assert.deepStrictEqual(optimizedVerify, normalVerify);
assert.strictEqual(normalVerify.status, 'PASS');
assert.strictEqual(normalVerify.candidateFilings, 115);
assert.strictEqual(normalVerify.caseCandidateLinks, 469);

const normalDry = run(['dry-run', '--remote']);
const optimizedDry = run(['dry-run', '--remote'], true);
assert.deepStrictEqual(optimizedDry, normalDry);
assert.strictEqual(normalDry.networkRequests, 0);
assert.strictEqual(normalDry.writes, 0);
assert.strictEqual(normalDry.outcomesAccessed, false);

const normalSelf = run(['self-test', '--remote']);
const optimizedSelf = run(['self-test', '--remote'], true);
assert.deepStrictEqual(optimizedSelf, normalSelf);
assert.strictEqual(normalSelf.status, 'PASS');
assert.ok(Object.values(normalSelf.mutationKills).every(Boolean));
assert.ok(Object.keys(normalSelf.mutationKills).length >= 25);

for (const optimized of [false, true]) {
  const result = spawnSync('python', [...(optimized ? ['-O'] : []), '-B', script, 'verify-contract'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.notStrictEqual(result.status, 0, 'verification without --remote must fail');
}

console.log(JSON.stringify({
  status: 'PASS',
  phase: normalVerify.phase,
  captureAuthorized: normalVerify.captureAuthorized,
  candidateFilings: normalVerify.candidateFilings,
  mutationKills: Object.keys(normalSelf.mutationKills).length,
  outcomesAccessed: false,
}));
