#!/usr/bin/env node
'use strict';
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const verifier = path.join(root, 'scripts', 'verify-sec-liquidation-downstream-content-disposition-v1.py');
function run(command, optimized = false, expected = 0) {
  const args = [...(optimized ? ['-O'] : []), '-B', verifier, command, '--remote'];
  const result = spawnSync('python', args, { cwd: root, encoding: 'utf8' });
  assert.strictEqual(result.status, expected, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return expected === 0 ? JSON.parse(result.stdout) : null;
}
for (const optimized of [false, true]) {
  const result = run('verify', optimized);
  assert.strictEqual(result.status, 'PASS');
  assert.strictEqual(result.candidateFilings, 115);
  assert.strictEqual(result.caseCandidateLinks, 469);
  assert.strictEqual(result.parsedDocuments, 399);
  assert.strictEqual(result.normalizedSentences, 43949);
  assert.strictEqual(result.laterLiquidationCorroborationRows, 4);
  assert.deepStrictEqual(result.laterLiquidationCorroborationCases, [
    'LIQUIDATION-PAYMENT-014', 'LIQUIDATION-PAYMENT-015', 'LIQUIDATION-PAYMENT-016', 'LIQUIDATION-PAYMENT-017'
  ]);
  assert.strictEqual(result.sameDescriptorOriginalAmountSentenceMatches, 0);
  assert.strictEqual(result.pastAdditionalDistributionSentenceMatches, 0);
  assert.strictEqual(result.noFurtherPaymentSentenceMatches, 0);
  assert.ok(Object.values(result.claimLocks).every(value => value === false));
  assert.strictEqual(result.networkRequests, 0);
  assert.strictEqual(result.writes, 0);
  assert.strictEqual(result.outcomesAccessed, false);
  const self = run('self-test', optimized);
  assert.strictEqual(Object.keys(self.mutationKills).length, 17);
  assert.ok(Object.values(self.mutationKills).every(Boolean));
  const noRemote = spawnSync('python', [...(optimized ? ['-O'] : []), '-B', verifier, 'verify'], { cwd: root, encoding: 'utf8' });
  assert.strictEqual(noRemote.status, 2);
}
console.log(JSON.stringify({ status: 'PASS', verifiedDocuments: 115, corroboratedCases: 4, terminalWealthCredit: false, outcomesAccessed: false }));
