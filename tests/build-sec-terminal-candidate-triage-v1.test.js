#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'build-sec-terminal-candidate-triage-v1.py');
const expectedClasses = [
  'EXPLICIT_CASH_OR_MIXED_CONSIDERATION_CANDIDATE',
  'LIQUIDATION_OR_DISTRIBUTION_CANDIDATE',
  'STOCK_OR_SECURITY_EXCHANGE_CANDIDATE',
  'ADMINISTRATIVE_REMOVAL_NOTICE_CANDIDATE',
  'OTHER_PRIMARY_DOCUMENT_REVIEW_CANDIDATE',
];

for (const optimized of [false, true]) {
  const args = optimized ? ['-O', '-B', script, '--self-test'] : ['-B', script, '--self-test'];
  const run = spawnSync(process.env.PYTHON || 'python', args, {
    cwd: root, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const value = JSON.parse(run.stdout.trim());
  assert.equal(value.status, 'PASS');
  assert.equal(value.classFixtures, true);
  assert.equal(value.paymentPromotionRejected, true);
  assert.equal(value.emptyTextRejected, true);
  assert.equal(value.tickerJoinUsed, false);
  assert.equal(value.outcomesAccessed, false);
}

const source = require('node:fs').readFileSync(script, 'utf8');
assert.doesNotMatch(source, /urllib|requests\.|http\.client|socket\.|aiohttp|fetch\(/);
assert.doesNotMatch(source, /API[_-]?KEY|CLIENT[_-]?SECRET|BEARER/i);

console.log(`build-sec-terminal-candidate-triage-v1.test.js: PASS classes=${expectedClasses.length}`);
