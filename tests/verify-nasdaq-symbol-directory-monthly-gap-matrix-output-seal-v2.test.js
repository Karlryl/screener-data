'use strict';
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'verify-nasdaq-symbol-directory-monthly-gap-matrix-output-seal-v2.py');

function invoke(extra, optimized = false) {
  const args = [];
  if (optimized) args.push('-O');
  args.push('-B', script, ...extra);
  const result = spawnSync('python', args, { cwd: root, encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

for (const optimized of [false, true]) {
  const self = invoke(['self-test'], optimized);
  assert.strictEqual(self.status, 'PASS');
  assert.strictEqual(Object.values(self.kills).every(Boolean), true);
  assert.strictEqual(self.outcomesAccessed, false);

  const verified = invoke(['verify'], optimized);
  assert.strictEqual(verified.status, 'PASS');
  assert.ok(['PRE_INTRODUCTION', 'POST_INTRODUCTION'].includes(verified.phase));
  assert.strictEqual(verified.cells, 384);
  assert.strictEqual(verified.monthsWithNoSnapshot, 124);
  assert.strictEqual(verified.sourceRebuildNormal, true);
  assert.strictEqual(verified.sourceRebuildOptimized, true);
  assert.strictEqual(verified.remoteVerified, false);
  assert.strictEqual(verified.outcomesAccessed, false);
}

console.log('verify-nasdaq-symbol-directory-monthly-gap-matrix-output-seal-v2.test.js: PASS');
