'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('SEC MIDAS archive adapter preserves official catalog quirks and validates ZIPs', () => {
  const script = path.join(__dirname, '..', 'scripts', 'early-detection-midas.py');
  const run = spawnSync(process.env.PYTHON || 'python', [script, 'self-test'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout);
  assert.equal(result.status, 'PASS');
  assert.equal(result.catalogQuarterCount2012To2025, 56);
  assert.equal(result.q1CatalogTypoPreserved, true);
  assert.equal(result.archiveDigestVerificationRequired, true);
  assert.equal(result.roleExcludesOhlcv, true);
  assert.equal(result.nestedArchiveSupported, true);
});
