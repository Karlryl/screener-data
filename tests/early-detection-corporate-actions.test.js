'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('SEC Form 25 and 15 rows remain event candidates until original filings are parsed', () => {
  const script = path.join(__dirname, '..', 'scripts', 'early-detection-corporate-actions.py');
  const run = spawnSync(process.env.PYTHON || 'python', [script, 'self-test'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout);
  assert.equal(result.status, 'PASS');
  assert.equal(result.events, 2);
  assert.equal(result.deterministic, true);
});
