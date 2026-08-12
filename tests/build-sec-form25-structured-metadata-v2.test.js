#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'build-sec-form25-structured-metadata-v2.py');

for (const optimized of [false, true]) {
  const args = optimized ? ['-O', '-B', script, '--self-test'] : ['-B', script, '--self-test'];
  const run = spawnSync(process.env.PYTHON || 'python', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout);
  assert.equal(result.status, 'PASS');
  assert.equal(result.v2ContractSchemaBound, true);
  assert.equal(result.baseBuilderV1RawBound, true);
  assert.equal(result.inventoryV4RawBound, true);
  assert.equal(result.inventoryV4SelfBound, true);
  assert.equal(result.inventoryV4ContractRawBound, true);
  assert.equal(result.inventoryV4BuilderRawBound, true);
  assert.equal(result.malformedHtmlFixInherited, true);
  assert.equal(result.binaryGraphicFixInherited, true);
  assert.equal(result.validExactExtractionAccepted, true);
  assert.equal(result.malformedXmlRejected, true);
  assert.equal(result.multipleXmlDocumentsRejected, true);
  assert.equal(result.duplicateXmlFieldRejected, true);
  assert.equal(result.conflictingXmlFieldRejected, true);
  assert.equal(result.dateAmbiguityRejected, true);
  assert.equal(result.paymentLanguageWithoutAmountRejected, true);
  assert.equal(result.tickerOnlyJoinMutationRejected, true);
  assert.equal(result.missingSourceHashMutationRejected, true);
  assert.equal(result.candidatePromotionMutationRejected, true);
  assert.equal(result.falseClaimMutationRejected, true);
  assert.equal(result.outcomesAccessed, false);
}

console.log('build-sec-form25-structured-metadata-v2.test.js: PASS');
