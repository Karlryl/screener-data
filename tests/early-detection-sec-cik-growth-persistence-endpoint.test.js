#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'early-detection-sec-cik-growth-persistence-endpoint.py');
const run = spawnSync('python', [script, 'self-test'], { cwd: root, encoding: 'utf8' });
assert.strictEqual(run.status, 0, run.stderr || run.stdout);
const result = JSON.parse(run.stdout);
assert.strictEqual(result.status, 'PASS');
assert.strictEqual(result.threePassPlusMissingFailsClosed, true);
assert.strictEqual(result.threeOfFourPersistent, true);
assert.strictEqual(result.twoOfFourNotPersistent, true);
assert.strictEqual(result.exactTwentyPercentPasses, true);
assert.strictEqual(result.belowTwentyPercentFails, true);
assert.strictEqual(result.newcombeMethod10OraclePass, true);
assert.deepStrictEqual(result.fullCohortDenominatorPreserved, [20, 40]);
assert.strictEqual(result.auditOutcomeUnlockRejected, true);
assert.strictEqual(result.endpointAcceptanceBoundariesPass, true);
assert.strictEqual(result.amendmentRejected, true);
assert.strictEqual(result.comparativeFactRejected, true);
assert.strictEqual(result.ambiguousFiscalSlotFailsClosed, true);
assert.strictEqual(result.duplicateFiscalSlotFailsClosed, true);
assert.strictEqual(result.sameCommitStageBypassRejected, true);
assert.strictEqual(result.mergeCheckpointRejected, true);
assert.strictEqual(result.futureResultPiggybackRejected, true);
assert.strictEqual(result.endpointSnapshotDriftRejected, true);
assert.strictEqual(result.sideResultPathRejected, true);
assert.strictEqual(result.sideAuthorizationPathRejected, true);
assert.strictEqual(result.sideSealPathRejected, true);
assert.strictEqual(result.preoutcomeResultHistoryRejected, true);
assert.strictEqual(result.exactAscertainmentGatesPass, true);
assert.strictEqual(result.postCutoffFactsRead, false);
assert.strictEqual(result.outcomesAccessed, false);
console.log('early-detection SEC CIK endpoint tests passed');
