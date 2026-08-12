#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'build-sec-terminal-wealth-original-inventory-v1.py');

for (const optimized of [false, true]) {
  const args = optimized ? ['-O', '-B', script, '--self-test'] : ['-B', script, '--self-test'];
  const run = spawnSync(process.env.PYTHON || 'python', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout);
  assert.equal(result.status, 'PASS');
  assert.equal(result.contractRawBound, true);
  assert.equal(result.documentPresenceNeverPromotedToTerminalWealth, true);
  assert.equal(result.ambiguousAccessionsRemainAmbiguous, true);
  assert.equal(result.outcomesAccessed, false);
}

console.log('build-sec-terminal-wealth-original-inventory-v1.test.js: PASS');
