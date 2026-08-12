#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'build-sec-terminal-wealth-original-inventory-v4.py');
const parserKills = [
  'arbitrary', 'noAccession', 'duplicateAccession', 'secondMalformedAccession',
  'secondEmptyAccession', 'secondTrailingExtraAccession', 'sequentialHeaders',
  'nestedHeader', 'orphanClose', 'closeBeforeStart', 'accessionOutside',
];
const mutationKills = [
  'rowSwap', 'rowSource', 'contract', 'queue', 'tree', 'track', 'task', 'implementation',
];

for (const optimized of [false, true]) {
  const args = optimized ? ['-O', '-B', script, '--self-test'] : ['-B', script, '--self-test'];
  const run = spawnSync(process.env.PYTHON || 'python', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout);
  assert.equal(result.status, 'PASS');
  assert.equal(result.contractRawBound, true);
  assert.equal(result.exactlyOneBalancedHeaderAccepted, true);
  assert.deepEqual(Object.keys(result.parserKillFixturesRejected).sort(), parserKills.sort());
  assert.ok(Object.values(result.parserKillFixturesRejected).every((value) => value === true));
  assert.deepEqual(Object.keys(result.rowAndTopLevelMutationFixturesRejected).sort(), mutationKills.sort());
  assert.ok(Object.values(result.rowAndTopLevelMutationFixturesRejected).every((value) => value === true));
  assert.equal(result.documentPresenceNeverPromotedToTerminalWealth, true);
  assert.equal(result.outcomesAccessed, false);
}

console.log('build-sec-terminal-wealth-original-inventory-v4.test.js: PASS');
