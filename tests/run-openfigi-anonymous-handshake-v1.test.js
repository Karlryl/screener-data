'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'run-openfigi-anonymous-handshake-v1.py');
const CONTRACT = path.join(ROOT, 'research', 'early-detection-v4', 'openfigi-anonymous-handshake-contract-v1.json');
const TERMS = path.join(ROOT, 'research', 'early-detection-v4', 'openfigi-terms-snapshot-v1.json');
const TERMS_SOURCE = path.join(ROOT, 'research', 'early-detection-v4', 'openfigi-terms-of-service-2026-08-12.html');

function runPython(args, input = undefined) {
  return spawnSync('python', args, {
    cwd: ROOT,
    input,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
}

function row(figi, ticker, shareClassFIGI) {
  return {
    figi,
    securityType: 'Common Stock',
    marketSector: 'Equity',
    ticker,
    name: `${ticker} TEST ISSUER`,
    exchCode: 'US',
    shareClassFIGI,
    compositeFIGI: figi,
    securityType2: 'Common Stock',
    securityDescription: ticker,
  };
}

function fixture() {
  return [
    { data: [row('BBG000B9XRY4', 'AAPL', 'BBG001S5N8V8')] },
    { data: [row('BBG000MM2P62', 'FB', 'BBG001SQCQC5')] },
    { data: [row('BBG000MM2P62', 'META', 'BBG001SQCQC5')] },
    { warning: 'No identifier found.' },
    { data: [row('BBG000CVWGS6', 'ATVI', 'BBG001S699P1')] },
  ];
}

test('contract is exact, anonymous, outcome-blind, V3 and point-evidence-only', () => {
  const contract = JSON.parse(fs.readFileSync(CONTRACT, 'utf8'));
  assert.equal(contract.schema, 'openfigi-anonymous-handshake-contract/v1');
  assert.equal(contract.endpoint.url, 'https://api.openfigi.com/v3/mapping');
  assert.equal(contract.documentation.officialDocumentationUrl, 'https://www.openfigi.com/api/documentation');
  assert.equal(contract.documentation.officialOpenApiSchemaUrl, 'https://api.openfigi.com/schema');
  assert.equal(contract.entitlement.accountRequired, false);
  assert.equal(contract.entitlement.apiKeyRequired, false);
  assert.equal(contract.entitlement.paymentDetailsRequired, false);
  assert.equal(contract.entitlement.jobsPerRequestFailClosedCeiling, 5);
  assert.equal(contract.entitlement.jobsInHandshake, 5);
  assert.deepEqual(contract.fixedJobs.map((job) => job.jobId), [
    'AAPL_ACTIVE',
    'FB_INCLUDE_UNLISTED',
    'META_INCLUDE_UNLISTED',
    'ATVI_DEFAULT',
    'ATVI_INCLUDE_UNLISTED',
  ]);
  assert.ok(contract.claimCeiling.forbidden.includes('HISTORICAL_VALIDITY_INTERVAL'));
  assert.ok(contract.claimCeiling.forbidden.includes('TERMINAL_PAYMENT'));
  assert.ok(contract.claimCeiling.forbidden.includes('PRICE_OR_RETURN_OUTCOME'));
  assert.equal(contract.networkPolicy.proxyOrRateLimitBypassAllowed, false);
  assert.equal(contract.termsSnapshot.path, 'research/early-detection-v4/openfigi-terms-snapshot-v1.json');
  assert.equal(contract.termsSnapshot.figiIdentifiersDisposition, 'PUBLIC_DOMAIN_FREE_REPRODUCTION_DISTRIBUTION_AND_USE');
  assert.equal(contract.termsSnapshot.relatedDescriptionsDisposition, 'INTERNAL_HANDSHAKE_EVIDENCE_ONLY_NO_REDISTRIBUTION_RIGHT_ASSERTED');
  assert.deepEqual(new Set(Object.values(contract.locks)), new Set([false]));

  const terms = JSON.parse(fs.readFileSync(TERMS, 'utf8'));
  assert.equal(terms.semanticFacts.figiIdentifiers, 'PUBLIC_DOMAIN_FREE_REPRODUCTION_DISTRIBUTION_AND_USE');
  assert.equal(terms.semanticFacts.relatedSecurityDescriptions, 'AS_IS_NO_ACCURACY_GUARANTEE_NO_PUBLIC_DOMAIN_CLAIM_IN_THIS_STUDY');
  assert.equal(terms.studyDisposition.terminalOrHistoricalClaim, false);
  assert.equal(terms.studyDisposition.humanLegalAttestation, false);
  const termsSource = fs.readFileSync(TERMS_SOURCE);
  assert.equal(terms.observedHttpBody.rawBodyStoredInRepository, true);
  assert.equal(terms.observedHttpBody.bytes, termsSource.length);
  assert.equal(contract.termsSnapshot.sourceBodyPath, 'research/early-detection-v4/openfigi-terms-of-service-2026-08-12.html');
  assert.equal(contract.implementationPolicy.localHeadEqualsUpstreamAndRemoteRequired, true);
  assert.equal(contract.implementationPolicy.localBytesEqualHeadGitBlobsRequired, true);
  assert.equal(contract.implementationPolicy.preAndPostNetworkSnapshotEqualityRequired, true);
});

test('contract verifier passes in normal and optimized Python', () => {
  for (const prefix of [[SCRIPT], ['-O', SCRIPT]]) {
    const result = runPython([...prefix, 'verify-contract']);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).status, 'PASS');
  }
});

test('offline adversarial self-test passes in normal and optimized Python', () => {
  for (const prefix of [[SCRIPT], ['-O', SCRIPT]]) {
    const result = runPython([...prefix, 'self-test']);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, 'PASS');
    assert.equal(output.tests, 16);
  }
});

test('fixture parser labels same-share-class and unlisted-request behavior without interval claims', () => {
  const result = runPython([SCRIPT, 'parse-fixture'], JSON.stringify(fixture()));
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.qualificationStatus, 'QUALIFIED_POINT_EVIDENCE_ONLY');
  assert.equal(parsed.cases.SAME_SECURITY_SYMBOL_CHANGE, 'SAME_SHARE_CLASS_FIGI_POINT_EVIDENCE');
  assert.equal(parsed.cases.TERMINAL_CASH_MERGER_OR_DELISTING, 'MAPPING_ONLY_WITH_INCLUDE_UNLISTED_POINT_EVIDENCE');
  assert.match(parsed.claimCeiling, /NO_HISTORICAL_INTERVAL_OR_TERMINAL_INFERENCE/);
  assert.deepEqual(new Set(Object.values(parsed.locks)), new Set([false]));
});

test('fixture parser fails closed on ambiguous rows and undocumented outcome fields', () => {
  const ambiguous = fixture();
  ambiguous[0].data.push({ ...ambiguous[0].data[0] });
  let result = runPython([SCRIPT, 'parse-fixture'], JSON.stringify(ambiguous));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /ambiguous/);

  const outcomeLeak = fixture();
  outcomeLeak[4].data[0].terminalPayment = 95;
  result = runPython([SCRIPT, 'parse-fixture'], JSON.stringify(outcomeLeak));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /exact keys mismatch/);
});

test('runner has no account/key lookup and no file-output surface', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.doesNotMatch(source, /os\.environ|os\.getenv|OPENFIGI_API|X-OPENFIGI-APIKEY/i);
  assert.doesNotMatch(source, /open\([^\n]*['\"]w|write_text|write_bytes/);
  assert.match(source, /automaticRetryAllowed/);
  assert.match(source, /NoRedirect/);
  assert.match(source, /ProxyHandler\(\{\}\)/);
  assert.match(source, /EXPECTED_CONTRACT_RAW_SHA256/);
  assert.match(source, /EXPECTED_TERMS_RAW_SHA256/);
  assert.match(source, /EXPECTED_TERMS_SOURCE_RAW_SHA256/);
  assert.match(source, /implementation_snapshot\(True\)/);
  assert.match(source, /validate_capture_bundle/);
});
