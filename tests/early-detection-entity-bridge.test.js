'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('entity bridge routes unique issuer names and fails ambiguous names closed', () => {
  const script = path.join(__dirname, '..', 'scripts', 'early-detection-entity-bridge.py');
  const run = spawnSync(process.env.PYTHON || 'python', [script, 'self-test'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout);
  assert.equal(result.status, 'PASS');
  assert.deepEqual(result.uniqueCandidate.candidateCiks, [1]);
  assert.equal(result.ambiguousCandidate.status, 'AMBIGUOUS');
  assert.deepEqual(result.ambiguousCandidate.candidateCiks, [2, 3]);
  assert.equal(result.deterministicReportHash, true);
  assert.equal(result.edgarAliasCandidate, true);
  assert.equal(result.multipleSnapshotRoots, true);
  assert.equal(result.gzipTransportVerified, true);
});
