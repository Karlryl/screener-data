'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { verify } = require('../../scripts/gqs00-freeze.js');

test('GQS-00@1.1.0 registry, hashes, fixtures, traces and equality proof stay sealed', () => {
  const result = verify();
  assert.equal(result.canonicalId, 'GQS-00@1.1.0');
  assert.equal(result.branchesCovered, 13);
  assert.equal(result.scoreMismatches, 0);
  assert.equal(result.rankMismatches, 0);
  assert.equal(result.negativeMutationGate, 'PASS');
});
