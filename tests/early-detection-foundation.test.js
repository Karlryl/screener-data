#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const script = path.join(ROOT, 'scripts', 'early-detection-foundation.py');
const candidates = [process.env.PYTHON, 'python'].filter(Boolean);
let completed = null;

for (const executable of candidates) {
  completed = spawnSync(executable, [script, 'self-test'], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (!completed.error || completed.error.code !== 'ENOENT') break;
}

assert.ok(completed, 'foundation self-test did not start');
assert.equal(completed.error, undefined, completed.error?.message);
assert.equal(completed.status, 0, completed.stderr || completed.stdout);
const result = JSON.parse(completed.stdout);
assert.equal(result.status, 'PASS');
assert.equal(result.acceptedCompanyfacts, 1);
assert.equal(result.quarantinedCompanyfacts, 1);
assert.equal(result.fsdArchives, 1);
assert.equal(result.midasArchives, 1);
assert.equal(result.researchSources, 1);
assert.equal(result.archivedResearchSources, 1);
assert.equal(result.observationsVerified, 6);
assert.equal(result.storeTransferVerified, true);

const registryPath = path.join(ROOT, 'research', 'early-detection-v4', 'free-source-registry.json');
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
assert.equal(registry.mandate, 'free_only_no_productive_gqs_change');
assert.ok(registry.sources.length >= 14);
assert.equal(registry.sources.find((row) => row.sourceId === 'NASDAQ_DAILY_LIST').decision, 'PROHIBITED_PAID');
assert.equal(registry.sources.find((row) => row.sourceId === 'YAHOO_CHART').decision, 'EXPLORATORY_ONLY');
assert.equal(registry.sources.find((row) => row.sourceId === 'HF_JINJING_DELISTED').decision, 'REJECTED_WRONG_MARKET');
assert.equal(registry.sources.find((row) => row.sourceId === 'HF_FINNHUB_OHLCV_1M').eligibleFor.length, 0);
assert.equal(registry.sources.find((row) => row.sourceId === 'KAGGLE_ARANDKEI_DELISTED').decision, 'EXPLORATORY_SMALL_SUBSET_ONLY');
assert.equal(
  registry.sources.find((row) => row.sourceId === 'COMMON_CRAWL_WARC').decision,
  'PRIMARY_FREE_ARCHIVE_EVIDENCE_WITH_FAIL_CLOSED_METADATA_GATE',
);
assert.equal(
  registry.sources.find((row) => row.sourceId === 'INTERNET_ARCHIVE_SEC_FSD').decision,
  'VERIFIED_FREE_TRANSPORT_FALLBACK',
);

const priceAudit = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'reports', 'early-detection', 'free-ohlcv-source-audit-2026-08-08.json'),
  'utf8',
));
assert.equal(priceAudit.status, 'NO_CONFIRMATORY_FULL_UNIVERSE_SOURCE_FOUND');
assert.equal(priceAudit.productiveGqsModified, false);
assert.ok(priceAudit.findings.every((row) => row.confirmatoryEligible === false));

const corpusReport = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'reports', 'early-detection', 'research-corpus-bootstrap-2026-08-08.json'),
  'utf8',
));
assert.equal(corpusReport.status, 'PARTIAL_NOT_SIGNAL_ELIGIBLE');
assert.equal(corpusReport.registrySources, 55);
assert.equal(corpusReport.capturedSources, corpusReport.capturedSourceIds.length);
assert.equal(corpusReport.unresolvedSources, corpusReport.unresolvedSourceIds.length);
assert.equal(corpusReport.capturedSources + corpusReport.unresolvedSources, corpusReport.registrySources);
assert.equal(corpusReport.qualityDecision.capturedResearchPayloadsAccepted, 0);
assert.equal(corpusReport.qualityDecision.confirmatoryUseAllowed, false);
assert.equal(corpusReport.storeVerification.status, 'PASS');
assert.equal(corpusReport.productiveGqsModified, false);

const metadataAudit = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'reports', 'early-detection', 'research-metadata-audit-2026-08-08.json'),
  'utf8',
));
assert.equal(metadataAudit.status, 'PARTIAL_ONE_HISTORICAL_SOURCE_ACCEPTED');
assert.equal(metadataAudit.currentPayloadAudit.sources, 39);
assert.equal(metadataAudit.historicalArchiveTests[0].sourceId, 'S025');
assert.equal(metadataAudit.historicalArchiveTests[0].decision, 'ACCEPTED_SIGNAL_ELIGIBLE');
assert.equal(metadataAudit.policy.automaticGuessing, false);
assert.equal(metadataAudit.productiveGqsModified, false);

const secWayback = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'reports', 'early-detection', 'sec-wayback-bootstrap-2026-08-08.json'),
  'utf8',
));
assert.equal(secWayback.status, 'PARTIAL_16_OF_69_QUARTERS_ACQUIRED');
assert.equal(secWayback.sourceInventory.quarterCoverage, 69);
assert.equal(secWayback.acquisition.payloadVersions, 32);
assert.equal(secWayback.storeVerification.status, 'PASS');
assert.equal(secWayback.productiveGqsModified, false);

const compactEquivalence = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'reports', 'early-detection', 'pit-compact-equivalence-2009-2012.json'),
  'utf8',
));
assert.equal(compactEquivalence.status, 'PASS');
assert.equal(compactEquivalence.coverage.payloadVersions, 32);
assert.equal(compactEquivalence.logicalTotals.facts, 35174832);
assert.equal(compactEquivalence.equivalence.factRowHashSequencesEqual, true);
assert.equal(compactEquivalence.storage.wideToCompactRatio, 5.55);
assert.equal(compactEquivalence.productiveGqsModified, false);

const workflow = fs.readFileSync(
  path.join(ROOT, '.github', 'workflows', 'early-detection-research-data.yml'),
  'utf8',
);
assert.match(workflow, /^on:\r?\n  workflow_dispatch:/m);
assert.doesNotMatch(workflow, /^  (push|schedule):/m);
assert.match(workflow, /retention-days: 1/);
assert.match(workflow, /early-detection-foundation\.py acquire-sec-fsd/);
assert.match(workflow, /SEC_FSD_QUARTER: \$\{\{ inputs\.quarter \}\}/);
assert.match(workflow, /--from-quarter "\$SEC_FSD_QUARTER"/);
assert.doesNotMatch(workflow, /--from-quarter "\$\{\{ inputs\.quarter \}\}"/);

console.log('early-detection-foundation.test.js: PASS');
