'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('quarterly GQS shadow calendar uses exact period ends and deterministic hashes', () => {
  const script = path.join(__dirname, '..', 'scripts', 'early-detection-gqs-calendar.py');
  const run = spawnSync(process.env.PYTHON || 'python', [script, 'self-test'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout);
  assert.equal(result.status, 'PASS');
  assert.deepEqual(result.quarterSequence, ['2012q4', '2013q1', '2013q2']);
  assert.equal(result.leapQuarterEnd, '2012-03-31T23:59:59Z');
});
