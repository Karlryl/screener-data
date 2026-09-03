'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isWhenIssuedSecurity } = require('../discovery/when-issued.js');

test('string names still identify when-issued securities', () => {
  assert.equal(isWhenIssuedSecurity('Example Common Stock When-Issued'), true);
});

test('non-string names never enter regex coercion', () => {
  const name = ['Example Stock When Issued'];

  assert.equal(isWhenIssuedSecurity(name), false);
});
