'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('entity/listing ledger keeps direct, candidate and conflict states separate', () => {
  const script = path.join(__dirname, '..', 'scripts', 'early-detection-entity-listing-ledger.py');
  const run = spawnSync(process.env.PYTHON || 'python', [script, 'self-test'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout);
  assert.equal(result.status, 'PASS');
  assert.equal(result.failClosedStates, 5);
  assert.equal(result.adjudicationSqlVerified, true);
});
