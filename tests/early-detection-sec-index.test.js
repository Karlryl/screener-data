'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('SEC quarterly master adapter parses accessions and delisting-form locators', () => {
  const script = path.join(__dirname, '..', 'scripts', 'early-detection-sec-index.py');
  const run = spawnSync(process.env.PYTHON || 'python', [script, 'self-test'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout);
  assert.equal(result.status, 'PASS');
  assert.equal(result.rows, 3);
  assert.equal(result.form25FamilyRows, 1);
  assert.equal(result.sourceAnomalies, 1);
});
