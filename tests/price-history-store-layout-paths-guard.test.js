'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  legacyPath,
  metaPath,
} = require('../lib/price-history-store.js');

const ROOT = path.join('synthetic', 'prices');

test('keeps the legacy history file beside the shard directory', () => {
  assert.equal(
    legacyPath(ROOT),
    path.join(ROOT, 'history.json'),
  );
});

test('keeps metadata inside the shard history directory', () => {
  assert.equal(
    metaPath(ROOT),
    path.join(ROOT, 'history', '_meta.json'),
  );
});
