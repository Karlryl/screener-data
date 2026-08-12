'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { safeSnapshotFilename } = require('../lib/snapshot-fs.js');

test('public-data AI cohort is deterministic and sealed before production use', () => {
  const script = path.join(__dirname, '..', 'scripts', 'early-detection-public-ai-cohort.py');
  const run = spawnSync(process.env.PYTHON || 'python', [script, 'self-test'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout);
  assert.equal(result.status, 'PASS');
  assert.equal(result.deterministic, true);
  assert.equal(result.syntheticFixtureOnly, true);
  assert.equal(result.sealRequiredForProduction, true);
  assert.deepEqual(result.counts, { inputRows: 10, eligibleRows: 1, rejectedRows: 9 });
  assert.equal(result.outcomeInjectionRejected, true);
  assert.equal(result.unsealedProductionRejected, true);
  assert.equal(result.realSourceBindingsRecomputed, true);
  assert.equal(result.forgedPriorBarCountRejected, true);
  assert.equal(result.unboundCorpusReferenceRejected, true);
  assert.equal(result.sameDayCloseRejected, true);
  assert.equal(result.remoteAuthorizationVerified, true);
  assert.equal(result.detachedRemoteArtifactRejected, true);
  assert.equal(result.sqliteSidecarRejected, true);
  assert.equal(result.archivedObservationRecomputed, true);
  assert.equal(result.structuredEvidenceBasisOnly, true);
  assert.equal(result.aiAuditSchemaVerified, true);
  assert.equal(result.duplicateAiAuditRejected, true);
  assert.equal(result.incompleteSemanticAuditRejected, true);
  assert.equal(result.staleOutcomeLedgerRejected, true);
  assert.equal(result.historicalPreferredTickerAccepted, true);
  assert.equal(result.invalidPathTickerRejected, true);
  assert.equal(result.futurePriceRowsIgnored, true);
  assert.equal(result.postBoundaryPriorRowRejected, true);
  assert.equal(result.futureDateOrderIgnored, true);
  assert.equal(result.priceFilenameCollisionRejected, true);
  assert.equal(result.compactObservedAtRejected, true);
  assert.deepEqual(result.priceFilenameExamples, {
    preferred: safeSnapshotFilename('AGO$B'),
    reserved: safeSnapshotFilename('CON'),
  });
  assert.equal(result.outcomesAccessed, false);
  assert.deepEqual(result.claimLocks, {
    protocolLabel: 'FEM-SEC-US-PUBLIC-AI',
    status: 'COVERAGE_ONLY_NOT_ORIGINAL_V4',
    confirmatoryEligible: false,
    survivorshipSafe: false,
    humanAttestation: false,
    aiAuditOnly: true,
    resultComputationAllowed: false,
    productiveGqsModified: false,
  });
  assert.deepEqual(result.sealMutationsRejected, [
    'inputManifestSha256',
    'outcomesAccessed',
    'productiveGqsModified',
    'protocolLabel',
    'protocolStatus',
    'resultComputationAllowed',
    'scopeSha256',
    'selectorSha256',
  ]);
  for (const reason of [
    'IDENTITY_CONFLICT_TICKER_REUSE',
    'IDENTITY_CONFLICT_MULTI_CIK',
    'IDENTITY_CONFLICT_MULTI_SYMBOL',
    'IDENTITY_CONFLICT_SHARE_CLASS',
    'IDENTITY_CONFLICT_SUCCESSOR',
    'INSUFFICIENT_PRIOR_BARS',
    'LATER_CORPORATE_ACTION_FACTOR',
    'PRICE_FILE_MISSING',
    'CANDIDATE_STATUS_AMBIGUOUS',
  ]) {
    assert.ok(result.negativeRejections.includes(reason), `missing negative fixture: ${reason}`);
  }
});
