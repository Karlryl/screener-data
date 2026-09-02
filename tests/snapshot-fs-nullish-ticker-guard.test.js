'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { safeSnapshotFilename } = require('../lib/snapshot-fs.js');

test('keeps ordinary ticker filename generation unchanged', () => {
  assert.equal(safeSnapshotFilename('AAPL'), 'AAPL.json');
});

test('rejects a null ticker before filename generation', () => {
  assert.throws(() => safeSnapshotFilename(null));
});

test('rejects an undefined ticker before filename generation', () => {
  assert.throws(() => safeSnapshotFilename(undefined));
});
