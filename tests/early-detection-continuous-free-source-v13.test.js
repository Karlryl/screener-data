#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'early-detection-continuous-free-source-v13.py');

function run(args, optimized = false) {
  const command = optimized ? ['-O', '-B', script, ...args] : ['-B', script, ...args];
  const result = spawnSync('python', command, { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

for (const optimized of [false, true]) {
  const verified = run(['verify', '--remote'], optimized);
  assert.equal(verified.status, 'PASS');
  assert.equal(verified.tasksConserved, 10);
  assert.equal(verified.resolvedTasks, 0);
  assert.equal(verified.nextTaskId, 'Q003-SEC-TERMINAL-WEALTH-QUEUE');
  assert.equal(verified.q002AutoNext, false);
  assert.equal(verified.originalV4GreenOfficialGates, 2);
  assert.equal(verified.originalV4OfficialGateCount, 13);
  assert.equal(verified.outcomesAccessed, false);

  const next = run(['next', '--remote'], optimized);
  assert.equal(next.nextTaskId, 'Q003-SEC-TERMINAL-WEALTH-QUEUE');
  assert.equal(next.q002AutoNext, false);
  assert.equal(next.outcomesAccessed, false);

  const tested = run(['self-test'], optimized);
  assert.equal(tested.status, 'PASS');
  assert.equal(tested.killCount, 9);
  assert.ok(Object.values(tested.kills).every(Boolean));
  assert.equal(tested.outcomesAccessed, false);
}

console.log('early-detection-continuous-free-source-v13.test.js: PASS');
