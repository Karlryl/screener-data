'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { shardFilename } = require('../lib/price-history-store.js');

test('zero-pads single-digit shard filenames', () => {
  const observed = [
    shardFilename(0),
    shardFilename(9),
  ];

  assert.deepEqual(observed, [
    'history-00.json',
    'history-09.json',
  ]);
});

test('keeps two-digit shard filenames unchanged', () => {
  const observed = [
    shardFilename(10),
    shardFilename(31),
  ];

  assert.deepEqual(observed, [
    'history-10.json',
    'history-31.json',
  ]);
});
