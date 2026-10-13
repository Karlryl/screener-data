'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.join(__dirname, '..', 'scripts', 'early-detection-blind-coding.py');
const run = spawnSync(process.env.PYTHON || 'python', [script, 'self-test'], { encoding: 'utf8' });
assert.equal(run.status, 0, run.stderr || run.stdout);
const value = JSON.parse(run.stdout);
assert.equal(value.status, 'PASS');
assert.equal(value.decision, 'PASS_WEIGHT_INVARIANT');
assert.equal(value.caseCount, 20);
assert.equal(value.pairedDecisions, 60);
assert.equal(value.sameFrozenPackageVerified, true);
assert.equal(value.humanAttestationBindingVerified, true);
assert.equal(value.negativeChecksPassed, 5);
console.log('early-detection-blind-coding.test.js: PASS');
