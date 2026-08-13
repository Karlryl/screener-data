#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'build-sec-liquidation-downstream-filing-discovery-v1.py');

function run(python, args) {
  const result = spawnSync(python, ['-B', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function runOptimized(args) {
  const result = spawnSync('python', ['-O', '-B', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

const normalContract = run('python', [script, 'verify-contract', '--remote']);
const optimizedContract = runOptimized([script, 'verify-contract', '--remote']);
assert.strictEqual(normalContract.status, 'PASS');
assert.deepStrictEqual(optimizedContract, normalContract);

const normalDry = run('python', [script, 'dry-run', '--remote']);
const optimizedDry = runOptimized([script, 'dry-run', '--remote']);
assert.deepStrictEqual(optimizedDry, normalDry);
assert.strictEqual(normalDry.status, 'PASS');
assert.strictEqual(normalDry.population.seedCases, 17);
assert.strictEqual(normalDry.population.issuerCiks, 4);
assert.strictEqual(normalDry.population.candidateFilings, 115);
assert.strictEqual(normalDry.population.candidateAccessions, 115);
assert.strictEqual(normalDry.population.caseCandidateLinks, 469);
assert.strictEqual(normalDry.population.minimumCandidateDayOffset, 1);
assert.strictEqual(normalDry.population.maximumCandidateDayOffset, 88);
assert.strictEqual(normalDry.networkRequests, 0);
assert.strictEqual(normalDry.writes, 0);
assert.strictEqual(normalDry.pricesAccessed, false);
assert.strictEqual(normalDry.returnsAccessed, false);
assert.strictEqual(normalDry.outcomesAccessed, false);

const normalSelf = run('python', [script, 'self-test', '--remote']);
const optimizedSelf = runOptimized([script, 'self-test', '--remote']);
assert.deepStrictEqual(optimizedSelf, normalSelf);
assert.strictEqual(normalSelf.status, 'PASS');
assert.ok(Object.values(normalSelf.mutationKills).every(Boolean));
assert.ok(Object.keys(normalSelf.mutationKills).length >= 25);
assert.strictEqual(normalSelf.outcomesAccessed, false);

for (const optimization of [[], ['-O']]) {
  const result = spawnSync('python', [...optimization, '-B', script, 'verify-contract'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.notStrictEqual(result.status, 0, 'verification without --remote must fail');
}

console.log(JSON.stringify({
  status: 'PASS',
  phase: normalDry.phase,
  candidateFilings: normalDry.population.candidateFilings,
  caseCandidateLinks: normalDry.population.caseCandidateLinks,
  mutationKills: Object.keys(normalSelf.mutationKills).length,
  outcomesAccessed: false,
}));
