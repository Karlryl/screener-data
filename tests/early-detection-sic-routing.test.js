'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('provisional SEC SIC bridge keeps ambiguous routes explicit', () => {
  const script = path.join(__dirname, '..', 'scripts', 'early-detection-sic-routing.py');
  const run = spawnSync(process.env.PYTHON || 'python', [script, 'self-test'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout);
  assert.equal(result.status, 'PASS');
  assert.equal(result.representativeCodes, 13);
  assert.match(result.contractSha256, /^[0-9a-f]{64}$/);
});
