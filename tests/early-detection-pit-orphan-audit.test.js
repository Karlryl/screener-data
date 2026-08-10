'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('orphan audit proves row and sequence hashes without promoting the row', () => {
  const script = path.join(__dirname, '..', 'scripts', 'early-detection-pit-orphan-audit.py');
  const run = spawnSync(process.env.PYTHON || 'python', [script, 'self-test'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout);
  assert.equal(result.status, 'PASS');
  assert.equal(result.orphanRows, 1);
  assert.equal(result.hashVerification, 'PASS');
});
