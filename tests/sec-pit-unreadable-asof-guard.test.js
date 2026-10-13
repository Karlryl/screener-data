'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pitSeriesFromFacts } = require('../lib/sec-pit.js');

test('a valid PIT cutoff keeps an empty fact set legitimately empty', () => {
  const series = pitSeriesFromFacts([], { asOf: '2026-09-02' });

  assert.deepEqual(series, []);
});

test('an unreadable PIT cutoff fails closed', () => {
  assert.throws(
    () => pitSeriesFromFacts([], { asOf: 'not-a-date' }),
    /\[sec-pit\] asOf unlesbar: not-a-date/
  );
});
