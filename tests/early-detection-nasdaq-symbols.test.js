'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('Nasdaq archive adapter parses exchange snapshots and never crosses quarter boundaries', () => {
  const script = path.join(__dirname, '..', 'scripts', 'early-detection-nasdaq-symbols.py');
  const run = spawnSync(process.env.PYTHON || 'python', [script, 'self-test'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout);
  assert.equal(result.status, 'PASS');
  assert.equal(result.rows, 1);
  assert.equal(result.selectedCaptures, 2);
  assert.equal(result.historicalOtherListedAlias, true);
  assert.equal(result.gzipTransportVerified, true);
  assert.equal(result.signedReportVerified, true);
  assert.match(result.payloadSha1Base32, /^[A-Z2-7]+$/);
});
