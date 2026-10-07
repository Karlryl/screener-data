'use strict';
// Offline contract tests; no snapshot files are read or written.
const assert = require('node:assert/strict');
const { safeSnapshotFilename, WINDOWS_RESERVED, isMetadataSnapshot } = require('./snapshot-fs.js');
let pass = 0;
function test(name, fn) { fn(); pass++; console.log('ok ' + name); }

test('normal tickers preserve dots and hyphens and fold case', () => {
  assert.equal(safeSnapshotFilename('aapl'), 'AAPL.json');
  assert.equal(safeSnapshotFilename('BRK.B'), 'BRK.B.json');
  assert.equal(safeSnapshotFilename('BRK-B'), 'BRK-B.json');
  assert.equal(safeSnapshotFilename('7203.T'), '7203.T.json');
});
test('unsafe characters are sanitized without creating path separators', () => {
  assert.equal(safeSnapshotFilename('a/b\\c'), 'A_B_C.json');
  assert.equal(safeSnapshotFilename('A B$'), 'A_B_.json');
  assert.equal(safeSnapshotFilename('../CON'), '_.._CON.json');
});
test('Windows device names are protected including exchange suffixes', () => {
  for (const name of ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM9', 'LPT1', 'LPT9']) {
    assert.equal(safeSnapshotFilename(name.toLowerCase()), '_' + name + '.json');
    assert.equal(safeSnapshotFilename(name + '.DE'), '_' + name + '.DE.json');
  }
  assert.equal(safeSnapshotFilename('COM0'), 'COM0.json');
  assert.equal(safeSnapshotFilename('COM10'), 'COM10.json');
  assert.equal(safeSnapshotFilename('CONIN$'), 'CONIN_.json');
  assert.equal(safeSnapshotFilename('CONOUT$'), 'CONOUT_.json');
});
test('WINDOWS_RESERVED matches the documented complete device family', () => {
  for (const name of ['CON', 'PRN', 'AUX', 'NUL', 'CONIN$', 'CONOUT$']) {
    assert.equal(WINDOWS_RESERVED.test(name.toLowerCase()), true, name);
  }
  for (let i = 1; i <= 9; i++) {
    assert.equal(WINDOWS_RESERVED.test('COM' + i), true);
    assert.equal(WINDOWS_RESERVED.test('LPT' + i), true);
  }
  for (const name of ['', 'COM0', 'LPT0', 'COM10', 'LPT10', '_CON', 'CON.DE', 'CONSOLE']) {
    assert.equal(WINDOWS_RESERVED.test(name), false, name);
  }
});
test('nullish and entirely sanitized tickers are rejected', () => {
  for (const value of [null, undefined]) assert.throws(() => safeSnapshotFilename(value), TypeError);
  for (const value of ['', ' ', '$', '___']) assert.throws(() => safeSnapshotFilename(value), /empty after sanitisation/);
});
test('leading dots and numeric inputs retain current coercion behavior', () => {
  assert.equal(safeSnapshotFilename('.DE'), '_.DE.json');
  assert.equal(safeSnapshotFilename('.'), '_..json');
  assert.equal(safeSnapshotFilename('..'), '_...json');
  assert.equal(safeSnapshotFilename(-7), '-7.json');
  assert.equal(safeSnapshotFilename(NaN), 'NAN.json');
});
test('only metadata names are excluded, including manifest suffixes', () => {
  for (const value of ['_manifest.json', '_manifest-part-1.json', '_manifest', '_last_good_disk.json']) {
    assert.equal(isMetadataSnapshot(value), true, value);
  }
  for (const value of ['', 'AAPL.json', '_CON.json', '_PRN.DE.json', '_other.json', '_last_good_disk.json.bak', '_MANIFEST.json']) {
    assert.equal(isMetadataSnapshot(value), false, value);
  }
});
test('metadata predicate currently requires a string input', () => {
  for (const value of [null, undefined, NaN, -1]) assert.throws(() => isMetadataSnapshot(value), TypeError);
});
console.log('snapshot-fs.test.js: ' + pass + ' cases passed');
