'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('SEC GQS input adapter derives Q4 and cash-flow quarters without cross-concept subtraction', () => {
  const script = path.join(__dirname, '..', 'scripts', 'early-detection-gqs-inputs.py');
  const run = spawnSync(process.env.PYTHON || 'python', [script, 'self-test'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout);
  assert.equal(result.status, 'PASS');
  assert.equal(result.q4Revenue, 40);
  assert.deepEqual(result.cashFlowQuarters, [10, 15, 20, 25]);
  assert.equal(result.floatHashVerification, 'PASS');
});
