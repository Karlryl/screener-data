'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('SEC MIDAS index remains source-hash-bound and deterministic', () => {
  const script = path.join(__dirname, '..', 'scripts', 'early-detection-midas-index.py');
  const run = spawnSync(process.env.PYTHON || 'python', [script, 'self-test'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout);
  assert.equal(result.status, 'PASS');
  assert.equal(result.rows, 1);
  assert.equal(result.sourceHashVerified, true);
  assert.equal(result.logicalManifestDeterministic, true);
  assert.equal(result.nestedArchiveSupported, true);
});
