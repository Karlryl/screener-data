'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { safeSnapshotFilename } = require('../lib/snapshot-fs.js');

test('public-data AI manifest builder stays outcome-blind and fail-closed', () => {
  const script = path.join(__dirname, '..', 'scripts', 'early-detection-public-ai-manifest.py');
  const run = spawnSync(process.env.PYTHON || 'python', [script, 'self-test'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout);
  assert.equal(result.status, 'PASS');
  assert.equal(result.syntheticFixtureOnly, true);
  assert.equal(result.rows, 2);
  assert.equal(result.historicalPreferredTickerBound, true);
  assert.equal(result.strictBeforeObservedDate, true);
  assert.equal(result.identitySemanticsInferred, false);
  assert.equal(result.futurePriceRowsIgnored, true);
  assert.equal(result.postBoundaryPriorRowRejected, true);
  assert.equal(result.futureDateOrderIgnored, true);
  assert.equal(result.priceFilenameCollisionRejected, true);
  assert.equal(result.nonCanonicalCreatedAtRejected, true);
  assert.equal(result.nonCanonicalObservedAtRejected, true);
  assert.equal(result.compactObservedAtRejected, true);
  assert.deepEqual(result.priceFilenameExamples, {
    preferred: safeSnapshotFilename('AGO$B'),
    reserved: safeSnapshotFilename('CON'),
  });
  assert.equal(result.outcomesAccessed, false);
});
