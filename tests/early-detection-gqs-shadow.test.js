'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('SEC GQS shadow adapter hashes canonically and fails ambiguous SIC routes closed', () => {
  const script = path.join(__dirname, '..', 'scripts', 'early-detection-gqs-shadow.js');
  const run = spawnSync(process.execPath, [script, '--self-test'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout);
  assert.equal(result.status, 'PASS');
  assert.match(result.canonicalSha256, /^[0-9a-f]{64}$/);
  assert.match(result.scoringTreeSha256, /^[0-9a-f]{64}$/);
});
