'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isWhenIssuedSecurity } = require('../discovery/when-issued.js');

test('recognizes the explicit when-issued phrase', () => {
  assert.equal(isWhenIssuedSecurity('Example Common Stock When-Issued'), true);
});

test('keeps ordinary issued-and-outstanding wording valid', () => {
  assert.equal(isWhenIssuedSecurity('Common stock issued and outstanding'), false);
});
