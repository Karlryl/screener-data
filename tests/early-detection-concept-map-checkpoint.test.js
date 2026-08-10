'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.join(__dirname, '..', 'scripts', 'early-detection-concept-map-checkpoint.py');
const run = spawnSync(process.env.PYTHON || 'python', [script, 'self-test'], { encoding: 'utf8' });
assert.equal(run.status, 0, run.stderr || run.stdout);
const value = JSON.parse(run.stdout);
assert.equal(value.status, 'PASS');
assert.equal(value.gatePassed, null);
assert.equal(value.technicalCheckpointPassed, null);
console.log('early-detection-concept-map-checkpoint.test.js: PASS');
