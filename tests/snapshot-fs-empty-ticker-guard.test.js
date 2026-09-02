'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { safeSnapshotFilename } = require('../lib/snapshot-fs.js');

test('maps a non-empty ticker to its snapshot filename', () => {
  assert.equal(safeSnapshotFilename('BRK.B'), 'BRK.B.json');
});

test('rejects an empty ticker before filename generation', () => {
  assert.throws(() => safeSnapshotFilename(''));
});
