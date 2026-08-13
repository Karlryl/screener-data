#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'materialize-sec-frozen-liquidation-payment-evidence-v1.py');
const contract = path.join(root, 'research', 'early-detection-v4', 'sec-frozen-liquidation-payment-output-contract-v1.json');
const output = path.join(root, 'reports', 'early-detection', 'sec-frozen-liquidation-payment-evidence-v1.json');
const EXPECTED_CONTRACT_RAW = '522606ba3da01872523220b2865110fd8684999dc38c1491eb5f0281fd92dc4e';
const EXPECTED_CONTROLLER_NORMALIZED = '42817685eaae9883ae8f82eb16ad8f6bed379de437ba47277850b20143c60334';
const EXPECTED_TEST_NORMALIZED = '1480f2ed40d8241465edcf5a1463546be5dd3c46f7b20a3dcca72777632467a7';

const sha = raw => crypto.createHash('sha256').update(raw).digest('hex');
function normalizedTest(raw) {
  let text = raw.toString('utf8');
  for (const name of ['EXPECTED_CONTRACT_RAW', 'EXPECTED_CONTROLLER_NORMALIZED', 'EXPECTED_TEST_NORMALIZED']) {
    text = text.replace(new RegExp(`(const ${name}\\s*=\\s*')[^']+('\\s*;)`), `$1${name}_NORMALIZED$2`);
  }
  return sha(Buffer.from(text));
}
function run(command, optimized = false, success = true) {
  const prefix = optimized ? ['-O', '-B'] : ['-B'];
  const result = spawnSync(process.env.PYTHON || 'python', [...prefix, script, command], { cwd: root, encoding: 'utf8', windowsHide: true, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, maxBuffer: 20 * 1024 * 1024 });
  if (!success) { assert.notEqual(result.status, 0); return result; }
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

assert.equal(sha(fs.readFileSync(contract)), EXPECTED_CONTRACT_RAW);
assert.equal(normalizedTest(fs.readFileSync(__filename)), EXPECTED_TEST_NORMALIZED);
for (const optimized of [false, true]) {
  const self = run('self-test', optimized);
  assert.equal(self.killCount, 8);
  assert.ok(Object.values(self.kills).every(Boolean));
  assert.equal(self.outcomesAccessed, false);
  const verified = run('verify-contract', optimized);
  assert.equal(verified.verifiedRows, 17);
  assert.equal(verified.outcomesAccessed, false);
  if (fs.existsSync(output)) {
    const tracked = spawnSync('git', ['cat-file', '-e', `HEAD:${path.relative(root, output).replaceAll('\\', '/')}`], { cwd: root }).status === 0;
    const result = run(tracked ? 'verify-output' : 'verify-generated', optimized);
    assert.equal(result.sourceRebuildVerified, true);
    assert.equal(result.verifiedRows, 17);
    assert.equal(result.outcomesAccessed, false);
  }
}
console.log('materialize-sec-frozen-liquidation-payment-evidence-v1.test.js: PASS');
