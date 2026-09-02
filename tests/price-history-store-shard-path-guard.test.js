'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  shardFilename,
  shardPath,
} = require('../lib/price-history-store.js');

const ROOT = path.join('synthetic', 'prices');

test('keeps shard files inside the history directory', () => {
  assert.equal(
    path.dirname(shardPath(ROOT, 7)),
    path.join(ROOT, 'history'),
  );
});

test('uses the canonical shard filename as the path leaf', () => {
  assert.equal(
    path.basename(shardPath(ROOT, 7)),
    shardFilename(7),
  );
});
