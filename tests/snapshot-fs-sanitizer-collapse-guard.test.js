'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { safeSnapshotFilename } = require('../lib/snapshot-fs.js');

test('sanitizes a nonempty ticker containing an unsupported character', () => {
  assert.equal(safeSnapshotFilename('A@B'), 'A_B.json');
});

test('rejects a ticker that fully collapses during sanitization', () => {
  assert.throws(() => safeSnapshotFilename('@@'));
});
