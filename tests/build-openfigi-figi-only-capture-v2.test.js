'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'build-openfigi-figi-only-capture-v2.py');
const CONTRACT = path.join(ROOT, 'research', 'early-detection-v4', 'openfigi-figi-only-disposition-contract-v2.json');
const OUTPUT = path.join(ROOT, 'reports', 'early-detection', 'openfigi-figi-only-capture-v2.json');

function runPython(args) {
  return spawnSync('python', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
}

test('V1 remains quarantined with zero credit and V2 is FIGI-only', () => {
  const contract = JSON.parse(fs.readFileSync(CONTRACT, 'utf8'));
  assert.equal(contract.schema, 'openfigi-figi-only-disposition-contract/v2');
  assert.equal(contract.v1Disposition.status, 'QUARANTINED_DESCRIPTIVE_FIELDS_RIGHTS_UNCLEARED');
  assert.equal(contract.v1Disposition.studyCredit, 'ZERO');
  assert.equal(contract.v1Disposition.eligibleForAnyStudyGate, false);
  assert.equal(contract.v1Disposition.eligibleForOriginalV4, false);
  assert.equal(contract.v2Disposition.status, 'PUBLIC_FIGI_ONLY_POINT_EVIDENCE');
  assert.equal(contract.v2Disposition.originalV4GateCredit, 'ZERO');
  assert.deepEqual(new Set(contract.derivation.rowExactKeys), new Set(['jobId', 'state', 'figi', 'compositeFIGI', 'shareClassFIGI']));
  assert.equal(contract.termsBinding.publicDomainScope, 'FIGI_IDENTIFIERS_ONLY');
  assert.equal(contract.termsBinding.relatedDescriptionsDisposition, 'EXCLUDED_FROM_V2');
  assert.equal(contract.v1Binding.introductionTag, 742);
  assert.equal(contract.v1Binding.introductionCommit, '9ecf9a8b67bc103812174eb347a8547b52144d93');
  assert.equal(contract.remoteBinding.minimumRemoteBaseCommit, 'ec806d8112fdaa05ee2cd328da256c504e8038fe');
  assert.ok(contract.claimCeiling.allowed.includes('NEGATIVE_TICKER_REUSE_EVIDENCE'));
  assert.ok(contract.claimCeiling.forbidden.includes('HISTORICAL_VALIDITY_INTERVAL'));
  assert.ok(contract.claimCeiling.forbidden.includes('ORIGINAL_V4_GATE_CREDIT'));
  assert.deepEqual(new Set(Object.values(contract.locks)), new Set([false]));
});

test('contract and adversarial self-test pass in normal and optimized Python', () => {
  for (const prefix of [[SCRIPT], ['-O', SCRIPT]]) {
    let result = runPython([...prefix, 'verify-contract']);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    let parsed = JSON.parse(result.stdout);
    assert.equal(parsed.status, 'PASS');
    assert.equal(parsed.v1StudyCredit, 'ZERO');

    result = runPython([...prefix, 'self-test']);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    parsed = JSON.parse(result.stdout);
    assert.equal(parsed.status, 'PASS');
    assert.equal(parsed.tests, 20);
    assert.equal(parsed.v1StudyCredit, 'ZERO');
  }
});

test('sidepath and missing output are rejected without creating production output', () => {
  assert.equal(fs.existsSync(OUTPUT), false, 'V2 production output must not exist during contract tests');
  let result = runPython([SCRIPT, 'build', '--output', 'reports/early-detection/openfigi-v2-sidepath.json']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /sidepath output rejected/);
  assert.equal(fs.existsSync(path.join(ROOT, 'reports', 'early-detection', 'openfigi-v2-sidepath.json')), false);

  result = runPython([SCRIPT, 'build']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /requires --output/);
  assert.equal(fs.existsSync(OUTPUT), false);
});

test('builder exposes no alternate output path or provider-network call', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.doesNotMatch(source, /urllib|requests\.|httpx|api\.openfigi\.com/);
  assert.match(source, /os\.link\(temp_path, path\)/);
  assert.match(source, /write-new output already exists/);
  assert.match(source, /pre\/post build implementation snapshot drift/);
  assert.match(source, /ls-remote/);
  assert.match(source, /V2 forbidden output key leak/);
  assert.match(source, /V1 quarantine\/credit leak/);
});

test('contract binds exact V1 and Terms trust bytes', () => {
  const contract = JSON.parse(fs.readFileSync(CONTRACT, 'utf8'));
  assert.equal(contract.v1Binding.rawSha256, '99144a7a85520efe7e127f32bbd438f07efa8578007f1f7333dd6bc58c683c48');
  assert.equal(contract.v1Binding.bundleSha256, '846050a4d5fd84900e01e7c387c4ad96086c49696e092d6817fd29b9f96c9e2c');
  assert.equal(contract.v1Binding.responseRawSha256, '0eeea739a2df7a64c4dc63a5e5572b97eb07b8717a7c2e762ab089c34a1d747a');
  assert.equal(contract.termsBinding.sourceRawSha256, 'dc1f321786c6e29cc4758bfd86137d49e95ae7a0b1c2abf68d44f2f53a67420e');
  assert.equal(contract.termsBinding.snapshotRawSha256, '423d084fd0ff7ebb20fc0d055901a0aa9b915a40218c911653462234a8b80ae7');
  assert.equal(contract.termsBinding.snapshotSha256, '8c882530c0cd7f918f0101373421d7238689ec584d74d8f77306421e13b33c95');
});
