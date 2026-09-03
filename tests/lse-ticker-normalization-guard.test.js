'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { toYahooTicker } = require('../discovery/lse-uk.js');

test('LSE ticker dots retain their Yahoo normalization', () => {
  const actual = [' aal ', 'BP.', 'bt.a'].map((ticker) => toYahooTicker(ticker));

  assert.deepEqual(actual, ['AAL.L', 'BP.L', 'BT-A.L']);
});

test('unsupported LSE ticker shapes remain rejected', () => {
  const actual = [null, '', '   ', 'A_B', 'A/B'].map((ticker) => toYahooTicker(ticker));

  assert.deepEqual(actual, [null, null, null, null, null]);
});
