'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { findeAusreisser } = require('../scripts/watch-annual-spikes.js');

const series = (values) => values.map((value) => ({ value }));

test('findeAusreisser accepts a spike that clears both neighbors', () => {
  const hits = findeAusreisser(series([100e6, 900e6, 100e6]), 8, 50e6);

  assert.equal(hits.length, 1);
  assert.equal(hits[0].index, 1);
});

test('findeAusreisser rejects a spike that clears only the smaller neighbor', () => {
  assert.deepEqual(
    findeAusreisser(series([100e6, 900e6, 200e6]), 8, 50e6),
    [],
  );
});
