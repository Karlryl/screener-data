'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { alterTage, MS_PRO_TAG } = require('../lib/alter.js');

test('returns a day delta when both timestamps are finite', () => {
  assert.equal(alterTage(0, 2 * MS_PRO_TAG), 2);
});

test('returns null when the current timestamp is non-finite', () => {
  const observed = [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ].map((jetztMs) => alterTage(0, jetztMs));

  assert.deepEqual(observed, [null, null, null]);
});
