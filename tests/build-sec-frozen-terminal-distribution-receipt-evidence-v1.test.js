#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'build-sec-frozen-terminal-distribution-receipt-evidence-v1.py');
const contractPath = path.join(root, 'research', 'early-detection-v4', 'sec-frozen-terminal-distribution-receipt-evidence-contract-v1.json');
const output = path.join(root, 'reports', 'early-detection', 'sec-frozen-terminal-distribution-receipt-evidence-v1.json');
const EXPECTED_CONTRACT_RAW = 'ac6e7fb337c897b1c7b6829c9beb0136e5a1d902e38d6f9e9bac261421edb9f4';
const EXPECTED_SCOPE = 'EXACT_FIVE_FROZEN_PRIMARY_SEC_SENTENCES_ONLY_NO_GENERAL_SELECTOR';
const EXPECTED_KINDS = {
  ACTUAL_DEFAULT_MIXED_CONSIDERATION_RECEIVED_STATED: 1,
  ACTUAL_FIRST_LIQUIDATING_DISTRIBUTION_BY_CHECKS_STATED: 1,
  DATED_FINAL_DISTRIBUTION_TO_HOLDERS_STATED: 3,
};
const EXPECTED_NO_GO = [
  'ALL_HOLDERS_RECEIVED',
  'CASH_ONLY_CONSIDERATION',
  'FINAL_LIQUIDATING_DISTRIBUTION',
  'FULL_CORPORATE_ACTION_CHAIN',
  'NO_FURTHER_DISTRIBUTIONS',
  'ORIGINAL_V4_GATE_CREDIT',
  'POST_CLOSING_RECOVERY',
  'TERMINAL_SESSION_COMPLETE',
  'TERMINAL_WEALTH_COMPLETE',
];
const EXPECTED_EXCLUSIONS = [
  'CONDITIONAL_OR_IF_ANY_PAYMENT',
  'CURRENTLY_ESTIMATED_OR_UP_TO_AMOUNT',
  'CVR_OR_OTHER_RIGHT_WITHOUT_PAYMENT',
  'FIRST_OR_INITIAL_DISTRIBUTION_AS_FINAL',
  'FUTURE_PAYMENT_OR_RELEASE',
  'GENERIC_SENTENCE_WITHOUT_ACCESSION_AND_TITLE_CLASS_BINDING',
  'PERMITS_DISTRIBUTION_WITHOUT_PAYMENT_OR_RECEIPT',
  'PRE_CLOSING_PROCEEDS_AS_POST_CLOSING_RECOVERY',
  'RIGHT_TO_RECEIVE_AS_ACTUAL_RECEIPT',
  'TENDER_PAYMENT_AS_NON_TENDERED_HOLDER_RECEIPT',
];
const EXPECTED_CLAIM_LOCKS = {
  actualCashReceiptForAllRows: false,
  allHoldersVerified: false,
  cashOnlyVerified: false,
  corporateActionChainComplete: false,
  finalLiquidatingDistributionVerified: false,
  historicalIdentityResolved: false,
  noFurtherDistributionsVerified: false,
  noLaterRecoveryVerified: false,
  originalV4GateCredit: false,
  outcomesAccessed: false,
  postClosingRecoveryVerified: false,
  terminalSessionComplete: false,
  terminalWealthComplete: false,
};

function sha(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function runPython(optimized, command) {
  const prefix = optimized ? ['-O', '-B', script] : ['-B', script];
  const run = spawnSync(process.env.PYTHON || 'python', [...prefix, command], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120000,
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return JSON.parse(run.stdout.trim());
}

const contractRaw = fs.readFileSync(contractPath);
assert.equal(sha(contractRaw), EXPECTED_CONTRACT_RAW);
const contract = JSON.parse(contractRaw);
assert.equal(contract.evidenceContract.expectedRows, 5);
assert.equal(contract.evidenceContract.exactFrozenSentenceSetRequired, true);
assert.equal(contract.evidenceContract.futureRowsRequireNewProtocol, true);
assert.equal(contract.evidenceContract.scopeLimit, EXPECTED_SCOPE);
assert.deepEqual(contract.evidenceContract.noGoClaims, EXPECTED_NO_GO);
assert.deepEqual(contract.evidenceContract.excludedSemanticClasses, EXPECTED_EXCLUSIONS);
assert.deepEqual(contract.evidenceContract.expectedEvidenceKindCounts, EXPECTED_KINDS);
assert.deepEqual(contract.claimLocks, EXPECTED_CLAIM_LOCKS);

const rows = contract.evidenceContract.frozenRows;
assert.equal(rows.length, 5);
assert.deepEqual(rows.map((row) => row.accession), [
  '0000891377-11-000008',
  '0000903423-11-000138',
  '0000903423-11-000139',
  '0000903423-11-000140',
  '0000950157-22-000333',
]);
assert.equal(new Set(rows.map((row) => row.sourceRef.blobSha256)).size, 5);
assert.equal(new Set(rows.map((row) => row.reconciliationWitness.occurrenceId)).size, 5);
for (const row of rows) {
  assert.equal(sha(Buffer.from(row.evidenceText, 'utf8')), row.sourceRef.evidenceSentenceSha256);
  assert.match(row.sourceRef.relativePath, new RegExp(`^${row.sourceRef.blobSha256.slice(0, 2)}/${row.sourceRef.blobSha256}\\.txt$`));
  assert.ok(row.sourceRef.titleClassEnd > row.sourceRef.titleClassStart);
  assert.ok(row.sourceRef.titleClassText.length > 0);
}
const saturnRows = rows.filter((row) => row.accession.startsWith('0000903423-11-'));
assert.equal(new Set(saturnRows.map((row) => row.sourceRef.titleClassText)).size, 3);
assert.equal(new Set(saturnRows.map((row) => row.sourceRef.titleClassSentenceSha256)).size, 3);

for (const optimized of [false, true]) {
  const verified = runPython(optimized, 'verify-contract');
  assert.equal(verified.status, 'PASS');
  assert.equal(verified.verifiedRows, 5);
  assert.equal(verified.scopeLimit, EXPECTED_SCOPE);
  assert.equal(verified.outcomesAccessed, false);

  const selfTest = runPython(optimized, 'self-test');
  assert.equal(selfTest.status, 'PASS');
  assert.equal(selfTest.verifiedRows, 5);
  assert.equal(selfTest.scopeLimit, EXPECTED_SCOPE);
  assert.equal(selfTest.outcomesAccessed, false);
  assert.deepEqual(new Set(Object.values(selfTest.kills)), new Set([true]));
  for (const key of [
    'rowRemoved',
    'evidenceKindChanged',
    'semanticValueChanged',
    'cashOnlyClaimed',
    'terminalWealthClaimed',
    'postClosingRecoveryClaimed',
    'outcomeClaimed',
    'sixthRowAdded',
    'sourceSentenceChangedAndRehashed',
    'titleClassChangedAndOffsetsRehashed',
    'accessionBlobDocumentCrossover',
    'reconciliationWitnessBlobChanged',
    'inventoryWitnessBytesChanged',
    ...EXPECTED_EXCLUSIONS.map((item) => `excluded_${item}`),
  ]) assert.equal(selfTest.kills[key], true, key);

  const dryRun = runPython(optimized, 'dry-run');
  assert.equal(dryRun.status, 'PASS');
  assert.equal(dryRun.verifiedRows, 5);
  assert.equal(dryRun.scopeLimit, EXPECTED_SCOPE);
  assert.equal(dryRun.outcomesAccessed, false);
  assert.deepEqual(dryRun.noGoClaims, EXPECTED_NO_GO);
  assert.deepEqual(dryRun.population, {
    frozenEvidenceRows: 5,
    uniqueAccessions: 5,
    datedFinalDistributionStatementRows: 3,
    actualFirstLiquidatingDistributionByChecksStatementRows: 1,
    actualDefaultMixedConsiderationReceiptStatementRows: 1,
    finalLiquidatingDistributionVerifiedRows: 0,
    noFurtherDistributionsVerifiedRows: 0,
    postClosingRecoveryVerifiedRows: 0,
    terminalWealthCompleteRows: 0,
  });
}

if (fs.existsSync(output)) {
  for (const optimized of [false, true]) {
    const verified = runPython(optimized, 'verify-output');
    assert.equal(verified.status, 'PASS');
    assert.equal(verified.sourceRebuildVerified, true);
    assert.equal(verified.verifiedRows, 5);
    assert.equal(verified.scopeLimit, EXPECTED_SCOPE);
    assert.equal(verified.outcomesAccessed, false);
  }
}

console.log('build-sec-frozen-terminal-distribution-receipt-evidence-v1.test.js: PASS');
