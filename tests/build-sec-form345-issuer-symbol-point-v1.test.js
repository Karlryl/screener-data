#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CONTRACT_PATH = path.join(
  ROOT, 'research', 'early-detection-v4', 'sec-form345-issuer-symbol-point-contract-v1.json'
);
const BUILDER_PATH = path.join(ROOT, 'scripts', 'build-sec-form345-issuer-symbol-point-v1.py');
const OUTPUT_PATH = path.join(ROOT, 'reports', 'early-detection', 'sec-form345-issuer-symbol-point-v1.json');
const PARENT = '95b10fe726557c75dc1bcc828f595214fb77c8e2';
const CONTRACT_RAW_SHA256 = '96aac6435c470ccd3c9f4b1e453951fa788f0b14d88d7f046270a65a71b1a8f8';
const CONTRACT_SHA256 = 'd5069e503b5107f2f6924df4c938f3339d72798b3f35c657b2007f8e51660340';
const SELECTED_FIELDS = [
  'ACCESSION_NUMBER',
  'FILING_DATE',
  'DOCUMENT_TYPE',
  'ISSUERCIK',
  'ISSUERNAME',
  'ISSUERTRADINGSYMBOL',
];

function sha256(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function runPython(optimized, command, extra = []) {
  const args = optimized
    ? ['-O', '-B', BUILDER_PATH, command, ...extra]
    : ['-B', BUILDER_PATH, command, ...extra];
  const result = spawnSync('python', args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.strictEqual(
    result.status,
    0,
    `${optimized ? 'optimized' : 'normal'} ${command} failed:\n${result.stdout}\n${result.stderr}`
  );
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  assert(lines.length > 0, `${command} returned no JSON`);
  return JSON.parse(lines.at(-1));
}

const contractRaw = fs.readFileSync(CONTRACT_PATH);
assert.strictEqual(sha256(contractRaw), CONTRACT_RAW_SHA256, 'contract raw hash drift');
const contract = JSON.parse(contractRaw.toString('utf8'));
const body = { ...contract };
delete body.contractSha256;
assert.strictEqual(sha256(Buffer.from(canonical(body), 'utf8')), CONTRACT_SHA256, 'contract self hash drift');
assert.strictEqual(contract.contractSha256, CONTRACT_SHA256);
assert.strictEqual(contract.remoteBinding.parentRemoteCommit, PARENT);
assert.strictEqual(contract.remoteBinding.parentTag, 834);
assert.strictEqual(contract.remoteBinding.productionExecutionRequiresRemoteDirectChild, true);
assert.deepStrictEqual(contract.submissionContract.selectedFields, SELECTED_FIELDS);
assert.strictEqual(contract.submissionContract.otherTables, 'NEVER_OPEN_OR_PARSE');
assert.strictEqual(contract.population.joinKey, 'EXACT_CANONICAL_10_DIGIT_ISSUER_CIK');
assert.strictEqual(contract.population.tickerJoinAllowed, false);
assert.strictEqual(contract.population.issuerNameJoinAllowed, false);
assert.strictEqual(contract.population.pointEvidenceMayResolveHistoricalInterval, false);
assert.strictEqual(contract.population.pointEvidenceMayResolvePermanentIdentity, false);
assert(Object.values(contract.claimLocks).every((value) => value === false), 'a claim lock was promoted');
assert.strictEqual(contract.quarterScope.quarters.length, 64);
const expectedQuarters = [];
for (let year = 2009; year <= 2024; year += 1) {
  for (let quarter = 1; quarter <= 4; quarter += 1) {
    expectedQuarters.push({
      quarter: `${year}Q${quarter}`,
      url: `https://www.sec.gov/files/structureddata/data/insider-transactions-data-sets/${year}q${quarter}_form345.zip`,
    });
  }
}
assert.deepStrictEqual(contract.quarterScope.quarters, expectedQuarters, 'quarter URL seal drift');
assert.strictEqual(contract.networkPolicy.maximumRequestsPerSecond, 5);
assert.strictEqual(contract.networkPolicy.minimumIntervalMilliseconds, 200);
assert.strictEqual(contract.networkPolicy.secContactEnvironmentVariable, 'SEC_CONTACT');
assert.strictEqual(contract.networkPolicy.secContactMayBePrintedStoredOrHashed, false);
assert.deepStrictEqual(contract.networkPolicy.productionCommandsOnly, ['capture']);
assert.strictEqual(contract.privateCapture.rawZipMayEnterGitOrPublicOutput, false);

const builderSource = fs.readFileSync(BUILDER_PATH, 'utf8');
assert(builderSource.includes(`CONTRACT_RAW_SHA256 = "${CONTRACT_RAW_SHA256}"`));
assert(builderSource.includes(`PARENT_REMOTE_COMMIT = "${PARENT}"`));
assert(!builderSource.includes('__CONTRACT_RAW_SHA256__'), 'unsealed contract placeholder');
assert(builderSource.includes('archive.read(member)'), 'SUBMISSION member is not explicitly read');
assert.strictEqual((builderSource.match(/archive\.read\(/g) || []).length, 1, 'more than one ZIP member read path');
assert(builderSource.includes('response.read(MAX_RESPONSE_BYTES + 1)'), 'bounded response read missing');
assert(builderSource.includes('MAX_RESPONSE_BYTES = 67_108_864'), 'response byte ceiling drift');
assert(builderSource.includes('MINIMUM_INTERVAL_SECONDS = 0.2'), 'request interval drift');
assert(builderSource.includes('REQUEST_TIMEOUT_SECONDS = 120'), 'request timeout drift');
assert(builderSource.includes('time.sleep(wait_for)'), 'sequential rate delay missing');
assert(builderSource.includes('os.environ.get("SEC_CONTACT", "")'), 'SEC contact gate missing');
assert(builderSource.includes('SEC_OPENER.open(request'), 'redirect-blocking opener is not used');
assert(builderSource.includes('class NoRedirectHandler'), 'redirect blocker is missing');
assert(builderSource.includes('verify_production_topology()["head"] != topology["head"]'), 'post-run topology check missing');

const outputBefore = fs.existsSync(OUTPUT_PATH) ? sha256(fs.readFileSync(OUTPUT_PATH)) : null;
for (const optimized of [false, true]) {
  const verify = runPython(optimized, 'verify-contract');
  assert.strictEqual(verify.status, 'PASS');
  assert.strictEqual(verify.head, PARENT);
  assert.strictEqual(verify.expectedQuarters, 64);
  assert.strictEqual(verify.networkRequests, 0);
  assert.strictEqual(verify.filesWritten, 0);
  assert.strictEqual(verify.outcomesAccessed, false);

  const dryRoot = path.join(
    os.tmpdir(), `sec-form345-dry-run-${process.pid}-${optimized ? 'optimized' : 'normal'}`
  );
  assert.strictEqual(fs.existsSync(dryRoot), false, 'dry-run sentinel path unexpectedly exists');
  const dry = runPython(optimized, 'dry-run', ['--private-root', dryRoot]);
  assert.strictEqual(dry.status, 'PASS');
  assert.strictEqual(dry.networkRequests, 0);
  assert.strictEqual(dry.filesWritten, 0);
  assert.strictEqual(dry.outcomesAccessed, false);
  assert.strictEqual(fs.existsSync(dryRoot), false, 'dry-run wrote a private path');

  const selfTest = runPython(optimized, 'self-test');
  assert.strictEqual(selfTest.status, 'PASS');
  assert.strictEqual(selfTest.networkRequests, 0);
  assert.strictEqual(selfTest.outcomesAccessed, false);
  for (const [key, value] of Object.entries(selfTest)) {
    if (!['status', 'networkRequests', 'outcomesAccessed'].includes(key)) {
      assert.strictEqual(value, true, `adversarial kill failed: ${key}`);
    }
  }
}
const outputAfter = fs.existsSync(OUTPUT_PATH) ? sha256(fs.readFileSync(OUTPUT_PATH)) : null;
assert.strictEqual(outputAfter, outputBefore, 'verification unexpectedly wrote or changed production output');

console.log(JSON.stringify({
  status: 'PASS',
  contractRawSha256: CONTRACT_RAW_SHA256,
  contractSha256: CONTRACT_SHA256,
  expectedQuarters: 64,
  modes: ['normal', 'optimized'],
  networkRequests: 0,
  productionOutputChanged: false,
  outcomesAccessed: false,
}));
