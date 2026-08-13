'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'run-tiingo-starter-eod-three-case-private-pilot-v1.py');
const CONTRACT = path.join(ROOT, 'research', 'early-detection-v4', 'tiingo-starter-eod-three-case-private-pilot-contract-v1.json');
const EXPECTED_CONTRACT_RAW = '6881985f0cbcb474671183ad5a6d3db989b38a50f480310fe62e5922aa06a867';
const EXPECTED_RUNNER_NORMALIZED = '2afb706fb7e872fcc7d55c89e9808fbd965613c546f200110091b01be872dfab';
const EXPECTED_TEST_NORMALIZED = '7e53edb8a4ef90a0ceb4d5000ab10818cdf922075cdddb7ead660840e6951cf5';

function sha(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function normalizedRunner(raw) {
  let text = raw.toString('utf8').replace(/\r\n/g, '\n');
  for (const name of ['CONTRACT_RAW', 'CONTRACT_SELF', 'RUNNER_NORMALIZED', 'TEST_NORMALIZED']) {
    const pattern = new RegExp(`^${name} = "[0-9a-fA-Z_]+"$`, 'gm');
    assert.strictEqual((text.match(pattern) || []).length, 1);
    text = text.replace(pattern, `${name} = "${'0'.repeat(64)}"`);
  }
  return Buffer.from(text, 'utf8');
}

function normalizedTest(raw) {
  let text = raw.toString('utf8').replace(/\r\n/g, '\n');
  for (const name of ['EXPECTED_CONTRACT_RAW', 'EXPECTED_RUNNER_NORMALIZED', 'EXPECTED_TEST_NORMALIZED']) {
    const pattern = new RegExp(`^const ${name} = '[0-9a-fA-Z_]+';$`, 'gm');
    assert.strictEqual((text.match(pattern) || []).length, 1);
    text = text.replace(pattern, `const ${name} = '${'0'.repeat(64)}';`);
  }
  return Buffer.from(text, 'utf8');
}

function run(args, optimized = false) {
  const prefix = optimized ? ['-O', '-B', SCRIPT] : ['-B', SCRIPT];
  return spawnSync(process.env.PYTHON || 'python', [...prefix, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
}

assert.strictEqual(sha(fs.readFileSync(CONTRACT)), EXPECTED_CONTRACT_RAW);
assert.strictEqual(sha(normalizedRunner(fs.readFileSync(SCRIPT))), EXPECTED_RUNNER_NORMALIZED);
assert.strictEqual(sha(normalizedTest(fs.readFileSync(__filename))), EXPECTED_TEST_NORMALIZED);

for (const optimized of [false, true]) {
  const self = run(['self-test'], optimized);
  assert.strictEqual(self.status, 0, self.stderr || self.stdout);
  const selfJson = JSON.parse(self.stdout);
  assert.strictEqual(selfJson.status, 'PASS');
  assert.ok(selfJson.mutationKillCount >= 24);
  assert.ok(Object.values(selfJson.mutationKills).every(Boolean));
  assert.strictEqual(selfJson.networkRequests, 0);
  assert.strictEqual(selfJson.filesWritten, 0);
  assert.strictEqual(selfJson.pricesAccessed, false);
  assert.strictEqual(selfJson.returnsComputed, false);
  assert.strictEqual(selfJson.outcomesAccessed, false);

  const noRemoteVerify = run(['verify'], optimized);
  assert.notStrictEqual(noRemoteVerify.status, 0, 'verify without --remote must fail');

  const verify = run(['verify', '--remote'], optimized);
  assert.strictEqual(verify.status, 0, verify.stderr || verify.stdout);
  const verifyJson = JSON.parse(verify.stdout);
  assert.strictEqual(verifyJson.status, 'PASS');
  assert.ok(['PRE_INTRODUCTION', 'POST_INTRODUCTION'].includes(verifyJson.phase));
  assert.strictEqual(verifyJson.remoteVerified, true);
  assert.strictEqual(verifyJson.pilotMayRunAfterAccountGate, true);
  assert.strictEqual(verifyJson.productionRequestsExecuted, false);
  assert.strictEqual(verifyJson.pricesAccessed, false);
  assert.strictEqual(verifyJson.returnsComputed, false);
  assert.strictEqual(verifyJson.outcomesAccessed, false);

  const noRemoteRun = run(['run', '--private-root', 'C:\\', '--attest-starter-zero-cost'], optimized);
  assert.notStrictEqual(noRemoteRun.status, 0, 'run without --remote must fail before credential or network access');

  const noAttestation = run(['run', '--remote', '--private-root', 'C:\\'], optimized);
  assert.notStrictEqual(noAttestation.status, 0, 'run without zero-cost attestation must fail before credential or network access');

  const noRemotePrivate = run(['verify-private', '--private-root', 'C:\\'], optimized);
  assert.notStrictEqual(noRemotePrivate.status, 0, 'private verification without --remote must fail');
}

const source = fs.readFileSync(SCRIPT, 'utf8');
assert.match(source, /ProxyHandler\(\{\}\)/);
assert.match(source, /GrowthScreener\/Tiingo\/StarterAPI/);
assert.match(source, /CredReadW/);
assert.doesNotMatch(source, /os\.(?:environ|getenv)\s*[\[(]/);
assert.doesNotMatch(source, /token=[^"'\s]/i);
assert.doesNotMatch(source, /apiKey=[^"'\s]/i);

console.log(JSON.stringify({ status: 'PASS', modes: ['normal', 'optimized'], remoteVerified: true, networkRequests: 0, filesWritten: 0, pricesAccessed: false, returnsComputed: false, outcomesAccessed: false }));
