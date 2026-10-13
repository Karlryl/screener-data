#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const script = path.join(ROOT, 'scripts', 'early-detection-web-archive.py');
const run = spawnSync(process.env.PYTHON || 'python', [script, 'self-test'], {
  cwd: ROOT,
  encoding: 'utf8',
  windowsHide: true,
});

assert.equal(run.error, undefined, run.error?.message);
assert.equal(run.status, 0, run.stderr || run.stdout);
const result = JSON.parse(run.stdout);
assert.equal(result.status, 'PASS');
assert.equal(result.warcParsed, true);
assert.equal(result.exactPublicationSelected, '2024-08-13T12:00:00.000Z');
assert.equal(result.metadataDecision, 'UNIQUE_EXACT_PUBLICATION_METADATA');

console.log('early-detection-web-archive.test.js: PASS');
