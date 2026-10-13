'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('bounded adjusted-close cohort never promotes current tickers to historical identity', () => {
  const script = path.join(__dirname, '..', 'scripts', 'early-detection-price-cohort.py');
  const run = spawnSync(process.env.PYTHON || 'python', [script, 'self-test'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout);
  assert.equal(result.status, 'PASS');
  assert.equal(result.deterministic, true);
  assert.equal(result.validPriceFiles, 1);
});
