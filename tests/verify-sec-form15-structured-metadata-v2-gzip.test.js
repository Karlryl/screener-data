#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = 'scripts/verify-sec-form15-structured-metadata-v2-gzip.py';

for (const optimized of [false, true]) {
  const prefix = optimized ? ['-O'] : [];
  const selfTest = spawnSync('python', [...prefix, '-B', script, 'self-test'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(selfTest.status, 0, selfTest.stderr || selfTest.stdout);
  const selfResult = JSON.parse(selfTest.stdout.trim());
  assert.equal(selfResult.status, 'PASS');
  assert.equal(selfResult.outcomesAccessed, false);
  assert.deepEqual(selfResult.mutationKills, {
    candidate: true,
    claim: true,
    rowOrder: true,
    sourceHash: true,
  });

  const verify = spawnSync('python', [...prefix, '-B', script, 'verify'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(verify.status, 0, verify.stderr || verify.stdout);
  const result = JSON.parse(verify.stdout.trim());
  assert.equal(result.status, 'PASS');
  assert.equal(result.rows, 17067);
  assert.equal(result.uniqueAccessions, 12923);
  assert.equal(result.candidateOnlySnippets, 21750);
  assert.equal(result.sourceRebuild, false);
  assert.equal(result.outcomesAccessed, false);
}

console.log('verify-sec-form15-structured-metadata-v2-gzip.test.js: PASS');
