'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('availability contract rejects all 100 deterministic look-ahead fixtures', () => {
  const script = path.join(__dirname, '..', 'scripts', 'early-detection-leakage-fixtures.js');
  const run = spawnSync(process.execPath, [script, '--self-test'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout);
  assert.equal(result.fixtures, 100);
  assert.deepEqual(result.assertions, {
    lookAheadRejected: 100,
    exactBoundaryAccepted: 100,
    missingRequiredTimestampRejected: 100,
    futureMutationMovedKnownAt: 100,
  });
  assert.match(result.reportSha256, /^[0-9a-f]{64}$/);
});
