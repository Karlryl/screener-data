'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'run-finra-q004-accounted-handshake-v2.py');
const CONTRACT = path.join(ROOT, 'research', 'early-detection-v4', 'finra-q004-accounted-handshake-contract-v2.json');
const OUTPUT = path.join(ROOT, 'reports', 'early-detection', 'finra-q004-public-credential-handshake-v2.json');

function run(args, optimized = false) {
  const pythonArgs = optimized ? ['-O', SCRIPT, ...args] : [SCRIPT, ...args];
  return childProcess.spawnSync('python', pythonArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
  });
}

test('FINRA accounted handshake contract is outcome-blind and fail-closed', () => {
  const contract = JSON.parse(fs.readFileSync(CONTRACT, 'utf8'));
  assert.equal(contract.schema, 'finra-q004-accounted-handshake-contract/v2');
  assert.equal(contract.accountContract.userType, 'INDIVIDUAL');
  assert.equal(contract.accountContract.credentialType, 'PUBLIC');
  assert.equal(contract.accountContract.monthlyFeeUsd, 0);
  assert.equal(contract.accountContract.monthlyUsageCapLabel, '10 GB');
  assert.equal(contract.accountContract.paymentDetailsRequired, false);
  assert.equal(contract.accountContract.trialUsed, false);
  assert.equal(contract.accountContract.paidCredentialTypesAllowed, false);
  assert.equal(contract.handshakeContract.maximumRequests, 1);
  assert.equal(contract.handshakeContract.productionDataRequestsAllowed, false);
  assert.equal(contract.handshakeContract.metadataRequestsAllowed, false);
  assert.equal(contract.handshakeContract.accessTokenMayBePersisted, false);
  assert.equal(contract.handshakeContract.accessTokenMayBePrinted, false);
  assert.ok(Object.values(contract.claimLocks).every((value) => value === false));

  for (const optimized of [false, true]) {
    const verify = run(['verify-contract'], optimized);
    assert.equal(verify.status, 0, verify.stderr);
    const verified = JSON.parse(verify.stdout);
    assert.equal(verified.status, 'PASS');
    assert.equal(verified.outcomesAccessed, false);

    const self = run(['self-test'], optimized);
    assert.equal(self.status, 0, self.stderr);
    const result = JSON.parse(self.stdout);
    assert.equal(result.status, 'PASS');
    assert.equal(result.outcomesAccessed, false);
    assert.equal(result.secretsCaptured, false);
    assert.ok(Object.values(result.kills).every(Boolean));
    assert.doesNotMatch(self.stdout, /SYNTHETIC_TOKEN_MUST_NEVER_APPEAR/);

    if (fs.existsSync(OUTPUT)) {
      const output = run(['verify-output', '--output', OUTPUT], optimized);
      assert.equal(output.status, 0, output.stderr);
      const outputResult = JSON.parse(output.stdout);
      assert.equal(outputResult.status, 'PASS');
      assert.equal(outputResult.outcomesAccessed, false);
      assert.equal(outputResult.secretsCaptured, false);
    }
  }
});
