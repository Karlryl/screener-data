#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = 'scripts/build-sec-frozen-liquidation-payment-evidence-v1.py';
const CONTRACT = path.join(ROOT, 'research', 'early-detection-v4', 'sec-frozen-liquidation-payment-evidence-contract-v1.json');
const BUILDER = path.join(ROOT, 'scripts', 'build-sec-frozen-liquidation-payment-evidence-v1.py');
const OUTPUT = path.join(ROOT, 'reports', 'early-detection', 'sec-frozen-liquidation-payment-evidence-v1.json');
const BASE_COMMIT = 'eca62f4260e940eff70ab8f17ada26c1fd57ab48';
const EXPECTED_SCOPE = 'EXACT_SEVENTEEN_FROZEN_PRIMARY_SEC_EXHIBIT_SENTENCES_ONLY_NO_GENERAL_SELECTOR';
const EXPECTED_CEILING = 'SEVENTEEN_PRIMARY_SEC_EXHIBIT_SENTENCES_STATE_EFFECTIVE_LIQUIDATION_TERMINATION_AND_LITERAL_DOLLAR_SIGN_PER_SHARE_LIQUIDATION_PAYMENT_WAS_DISTRIBUTED';
const EXPECTED_PURPOSE = 'Freeze exactly seventeen outcome-blind primary SEC exhibit sentences that state an effective liquidation or termination and a literal dollar-sign per-share liquidation payment was distributed, while refusing currency resolution, finality, no-further-payment, recovery, terminal-wealth, identity, listing, fee, tax, fractional, universal-holder and Original-V4 claims.';
const EXPECTED_CREATED_AT = '2026-08-13T04:17:01Z';
const EXPECTED_DEDUP_DIMENSIONS = [
  'ACCESSION', 'BLOB_SHA256', 'EVIDENCE_SENTENCE_SHA256',
  'ACCESSION_BLOB_DOCUMENT_SENTENCE_PROVENANCE',
];
const EXPECTED_ACCESSIONS = [101, 103, 105, 107, 112, 114, 116, 118, 120, 122, 124, 126, 128, 134, 136, 138, 140]
  .map((number) => `0001143362-14-${String(number).padStart(6, '0')}`);

function sha(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizedBuilder(raw) {
  let text = raw.toString('utf8').replaceAll('\r\n', '\n');
  for (const name of ['CONTRACT_RAW', 'CONTRACT_SELF']) {
    const expression = new RegExp(`^${name} = "[0-9a-f]{64}"$`, 'm');
    assert.equal((text.match(expression) || []).length, 1, `${name} normalization structure changed`);
    text = text.replace(expression, `${name} = "${'0'.repeat(64)}"`);
  }
  return Buffer.from(text, 'utf8');
}

function run(optimized, command) {
  const prefix = optimized ? ['-O', '-B'] : ['-B'];
  const result = spawnSync(process.env.PYTHON || 'python', [...prefix, SCRIPT, command, '--remote'], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    timeout: 180000,
    maxBuffer: 20 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `${command} failed:\n${result.stdout}\n${result.stderr}`);
  return { raw: result.stdout, value: JSON.parse(result.stdout.trim()) };
}

assert.equal(fs.existsSync(OUTPUT), false, 'future output must remain absent');
const contractRaw = fs.readFileSync(CONTRACT);
const builderRaw = fs.readFileSync(BUILDER);
const contract = JSON.parse(contractRaw.toString('utf8'));
const body = { ...contract };
delete body.contractSha256;
assert.equal(contract.contractSha256, sha(Buffer.from(canonical(body), 'utf8')));
assert.equal(contract.createdAt, EXPECTED_CREATED_AT);
assert.equal(contract.purpose, EXPECTED_PURPOSE);
assert.deepEqual(Object.keys(contract.inputs), ['corpus']);
assert.deepEqual(Object.keys(contract.deduplicationContract).sort(), [
  'dimensions', 'expectedIntersectionCountByDimension', 'frozenFiveInput', 'noncashSixInput',
]);
assert.deepEqual(contract.deduplicationContract.dimensions, EXPECTED_DEDUP_DIMENSIONS);
assert.deepEqual(contract.deduplicationContract.expectedIntersectionCountByDimension, {
  ACCESSION: 0,
  ACCESSION_BLOB_DOCUMENT_SENTENCE_PROVENANCE: 0,
  BLOB_SHA256: 0,
  EVIDENCE_SENTENCE_SHA256: 0,
});
assert.equal(contract.baseSeal.baseCommit, BASE_COMMIT);
assert.equal(contract.baseSeal.baseTag, 867);
assert.equal(contract.evidencePolicy.expectedRows, 17);
assert.equal(contract.evidencePolicy.expectedRecipientExplicitRows, 4);
assert.equal(contract.evidencePolicy.scopeLimit, EXPECTED_SCOPE);
assert.equal(contract.evidencePolicy.semanticCeiling, EXPECTED_CEILING);
assert.deepEqual(contract.frozenCases.map((row) => row.accession), EXPECTED_ACCESSIONS);
assert.equal(new Set(contract.frozenCases.map((row) => row.blobSha256)).size, 17);
assert.equal(new Set(contract.frozenCases.map((row) => row.evidenceSentenceSha256)).size, 17);
assert.equal(contract.frozenCases.filter((row) => row.recipientExplicit).length, 4);
assert.equal(contract.frozenCases.filter((row) => row.currencyCode !== null).length, 0);
assert.deepEqual(new Set(Object.values(contract.claimLocks)), new Set([false]));
assert.equal(contract.claimLocks.cashReceiptVerified, false);
assert.equal(contract.claimLocks.firstDistributionVerified, false);
assert.equal(contract.claimLocks.finalDistributionVerified, false);
assert.equal(sha(normalizedBuilder(builderRaw)), contract.implementationContract.ownedByteBindings.builderNormalizedSha256);
assert.equal(sha(fs.readFileSync(__filename)), contract.implementationContract.ownedByteBindings.testRawSha256);

const builderText = builderRaw.toString('utf8');
const rawMatch = builderText.match(/^CONTRACT_RAW = "([0-9a-f]{64})"$/m);
const selfMatch = builderText.match(/^CONTRACT_SELF = "([0-9a-f]{64})"$/m);
assert.ok(rawMatch && selfMatch, 'builder contract bindings missing');
assert.equal(rawMatch[1], sha(contractRaw));
assert.equal(selfMatch[1], contract.contractSha256);

for (const optimized of [false, true]) {
  const verified = run(optimized, 'verify-contract').value;
  assert.equal(verified.status, 'PASS');
  assert.equal(verified.baseSealCommit, BASE_COMMIT);
  assert.equal(verified.verifiedRows, 17);
  assert.equal(verified.recipientExplicitRows, 4);
  assert.equal(verified.scopeLimit, EXPECTED_SCOPE);
  assert.equal(verified.outcomesAccessed, false);

  const selfTest = run(optimized, 'self-test').value;
  assert.equal(selfTest.status, 'PASS');
  assert.equal(selfTest.verifiedRows, 17);
  assert.equal(selfTest.recipientExplicitRows, 4);
  assert.ok(Object.keys(selfTest.mutationKills).length >= 36);
  assert.deepEqual(new Set(Object.values(selfTest.mutationKills)), new Set([true]));
  assert.equal(selfTest.outcomesAccessed, false);

  const first = run(optimized, 'dry-run');
  const second = run(optimized, 'dry-run');
  assert.equal(first.raw, second.raw, 'dry-run must be byte-identical');
  const dryRun = first.value;
  assert.equal(dryRun.status, 'PASS');
  assert.equal(dryRun.baseSealCommit, BASE_COMMIT);
  assert.equal(dryRun.verifiedRows, 17);
  assert.equal(dryRun.outcomesAccessed, false);
  assert.equal(dryRun.report.scopeLimit, EXPECTED_SCOPE);
  assert.equal(dryRun.report.semanticCeiling, EXPECTED_CEILING);
  assert.deepEqual(dryRun.report.population, {
    actualPastLiquidationPaymentDistributedStatementRows: 17,
    currencyResolvedRows: 0,
    frozenEvidenceRows: 17,
    literalDollarSignPerShareAmountRows: 17,
    recipientExplicitRows: 4,
    uniqueAccessions: 17,
    uniqueBlobs: 17,
  });
  assert.deepEqual(dryRun.report.deduplication.intersectionCountByDimension, {
    ACCESSION: 0,
    ACCESSION_BLOB_DOCUMENT_SENTENCE_PROVENANCE: 0,
    BLOB_SHA256: 0,
    EVIDENCE_SENTENCE_SHA256: 0,
  });
  assert.equal(dryRun.report.deduplication.existingRows, 11);
  assert.deepEqual(dryRun.report.rows.map((row) => row.accession), EXPECTED_ACCESSIONS);
  assert.equal(dryRun.report.rows.filter((row) => row.recipientExplicit).length, 4);
  assert.equal(dryRun.report.rows.filter((row) => row.currencyCode !== null).length, 0);
  assert.equal(dryRun.report.rows.every((row) => row.evidenceText.includes('was distributed')), true);
  assert.equal(dryRun.report.rows.every((row) => /^\$[0-9]+\.[0-9]+$/.test(row.amountLiteral)), true);
  assert.deepEqual(new Set(Object.values(dryRun.report.claimLocks)), new Set([false]));
}

assert.equal(fs.existsSync(OUTPUT), false, 'verification and dry-run must not create output');
console.log(JSON.stringify({
  status: 'PASS',
  modes: ['normal', 'optimized'],
  verifiedRows: 17,
  recipientExplicitRows: 4,
  deduplicatedAgainstRows: 11,
  outputCreated: false,
  outcomesAccessed: false,
}));
