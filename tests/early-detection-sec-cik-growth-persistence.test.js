'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const repo = path.resolve(__dirname, '..');
const script = path.join(repo, 'scripts', 'early-detection-sec-cik-growth-persistence.py');

test('SEC-CIK exposure builder is outcome-blind and fail-closed', () => {
  const run = spawnSync('python', [script, 'self-test'], { cwd: repo, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout);
  assert.equal(result.status, 'PASS');
  assert.equal(result.positiveFixture, 'TRIGGER_POSITIVE');
  assert.equal(result.exactThresholdsPreserved, true);
  assert.equal(result.zeroOcfRejected, true);
  assert.equal(result.ambiguousDuplicateRejected, true);
  assert.equal(result.crossFiscalYearRejected, true);
  assert.equal(result.conceptPriorityFailClosed, true);
  assert.equal(result.crossDerivationConceptPriorityPreserved, true);
  assert.equal(result.conflictingOcfDerivationsRejected, true);
  assert.equal(result.revenueCrossDerivationPriorityPreserved, true);
  assert.equal(result.laterRevisionConflictRejected, true);
  assert.equal(result.tamperedDatabaseRejected, true);
  assert.equal(result.interposedDatabaseRejected, true);
  assert.equal(result.fallbackAnchorSelected, '20140331');
  assert.equal(result.postCutoffFixtureQuarantined, true);
  assert.equal(result.outcomeInjectionRejected, true);
  assert.equal(result.emptyExposureRejected, true);
  assert.equal(result.rehashedMetricMutationRejected, true);
  assert.equal(result.validExposureVerified, 'PASS');
});
