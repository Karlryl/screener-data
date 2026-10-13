'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.join(__dirname, '..', 'scripts', 'early-detection-independent-final-audit.py');
const run = spawnSync(process.env.PYTHON || 'python', [script, 'self-test'], { encoding: 'utf8' });
assert.equal(run.status, 0, run.stderr || run.stdout);
const value = JSON.parse(run.stdout);
assert.equal(value.status, 'PASS');
assert.equal(value.independentAuditPassed, null);
assert.equal(value.checklistItems, 22);
assert.equal(value.blankRejected, true);
assert.equal(value.syntheticPositiveFixturePassed, true);
assert.equal(value.openP2Rejected, true);
assert.equal(value.componentManifestRecomputed, true);
assert.equal(value.prerequisiteGateCount, 10);
assert.equal(value.circularIndependentGateExcluded, true);
assert.equal(value.independentAuditRedBootstrapRequired, true);
assert.equal(value.attestationPackageBindingEnforced, true);
console.log('early-detection-independent-final-audit.test.js: PASS');
