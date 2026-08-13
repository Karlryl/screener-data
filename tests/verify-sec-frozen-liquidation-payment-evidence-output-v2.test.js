#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'verify-sec-frozen-liquidation-payment-evidence-output-v2.py');
const contract = path.join(root, 'research', 'early-detection-v4', 'sec-frozen-liquidation-payment-output-seal-contract-v2.json');
const EXPECTED_CONTRACT_RAW = 'a22b02be6376f2d54230b438a8edc9786497c3257c9923da29c9b5f18d096eee';
const EXPECTED_VERIFIER_NORMALIZED = '3eef5f90f9073f7c68d0f8f856b5751d1065934ad97a79fd254877a00ac012fe';
const EXPECTED_TEST_NORMALIZED = '49f03e0af4173ac0e93de248b0f2276cfa7d38694c97810a5df57f5e29ddfd31';
const sha = raw => crypto.createHash('sha256').update(raw).digest('hex');
function normalized(raw) { let text = raw.toString('utf8'); for (const name of ['EXPECTED_CONTRACT_RAW', 'EXPECTED_VERIFIER_NORMALIZED', 'EXPECTED_TEST_NORMALIZED']) text = text.replace(new RegExp(`(const ${name}\\s*=\\s*')[^']+('\\s*;)`), `$1${name}_NORMALIZED$2`); return sha(Buffer.from(text)); }
function run(command, optimized = false, success = true) { const result = spawnSync(process.env.PYTHON || 'python', [...(optimized ? ['-O', '-B'] : ['-B']), script, command, '--remote'], { cwd: root, encoding: 'utf8', windowsHide: true, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, maxBuffer: 20 * 1024 * 1024 }); if (!success) { assert.notEqual(result.status, 0); return; } assert.equal(result.status, 0, result.stderr || result.stdout); return JSON.parse(result.stdout); }
assert.equal(sha(fs.readFileSync(contract)), EXPECTED_CONTRACT_RAW); assert.equal(normalized(fs.readFileSync(__filename)), EXPECTED_TEST_NORMALIZED);
for (const optimized of [false, true]) { const self = run('self-test', optimized); assert.equal(self.killCount, 6); assert.ok(Object.values(self.kills).every(Boolean)); const verified = run('verify', optimized); assert.equal(verified.sourceRebuildVerified, true); assert.equal(verified.verifiedRows, 17); assert.equal(verified.recipientExplicitRows, 4); assert.equal(verified.outcomesAccessed, false); assert.equal(verified.remoteVerified, true); }
console.log('verify-sec-frozen-liquidation-payment-evidence-output-v2.test.js: PASS');
