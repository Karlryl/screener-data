'use strict';

// Standalone, dependency-free contract tests: node lib/md-table.test.js
const assert = require('node:assert/strict');
const { mdCell, mdRow, mdTable } = require('./md-table.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (error) { fail++; console.error('FAIL   ' + name + '\n       ' + error.stack); }
}

test('mdCell escapes every pipe', () => {
  assert.equal(mdCell('a|b|c'), 'a\\|b\\|c');
});

test('mdCell replaces each CRLF with one space', () => {
  assert.equal(mdCell('a\r\nb\r\nc'), 'a b c');
});

test('mdCell replaces LF line breaks', () => {
  assert.equal(mdCell('a\nb\nc'), 'a b c');
});

test('mdCell handles pipes and mixed line breaks together', () => {
  assert.equal(mdCell('a|b\r\nc|d\ne'), 'a\\|b c\\|d e');
});

test('mdCell preserves numeric zero', () => {
  assert.equal(mdCell(0), '0');
});

test('mdCell preserves false', () => {
  assert.equal(mdCell(false), 'false');
});

test('mdCell renders null as an empty cell', () => {
  assert.equal(mdCell(null), '');
});

test('mdCell renders undefined as an empty cell', () => {
  assert.equal(mdCell(undefined), '');
});

test('mdCell uses normal object string conversion', () => {
  assert.equal(mdCell({ field: 'value' }), '[object Object]');
});

test('mdCell preserves surrounding whitespace and empty strings', () => {
  assert.equal(mdCell(' \ttext\t '), ' \ttext\t ');
  assert.equal(mdCell(''), '');
});

test('mdCell preserves backslashes and lone carriage returns', () => {
  assert.equal(mdCell('a\\b\rc'), 'a\\b\rc');
});

test('mdRow escapes mixed cell values with exact spacing', () => {
  assert.equal(mdRow(['a|b', 0, false, null, undefined]), '| a\\|b | 0 | false |  |  |');
});

test('mdRow renders a single cell', () => {
  assert.equal(mdRow(['one']), '| one |');
});

test('mdTable with no data rows contains only header and separator', () => {
  assert.equal(mdTable(['first', 'second'], []), '| first | second |\n| --- | --- |');
});

test('mdTable escapes headers and data and uses default alignment', () => {
  assert.equal(mdTable(['h|1', 'h\n2'], [['v|1', 'v\r\n2'], [0, false]]),
    '| h\\|1 | h 2 |\n| --- | --- |\n| v\\|1 | v 2 |\n| 0 | false |');
});

test('mdTable supports left, right, center and omitted column alignment', () => {
  assert.equal(mdTable(['l', 'r', 'c', 'default'], [], ['l', 'r', 'c']),
    '| l | r | c | default |\n| :--- | ---: | :---: | --- |');
});

test('mdTable rejects a short row and identifies row index zero', () => {
  assert.throws(() => mdTable(['a', 'b'], [['one']]),
    { name: 'Error', message: /row 0\b.*1 columns.*expected 2/ });
});

test('mdTable rejects a long row and identifies its later index', () => {
  assert.throws(() => mdTable(['a'], [['one'], ['two', 'three']]),
    { name: 'Error', message: /row 1\b.*2 columns.*expected 1/ });
});

test('mdTable keeps caller-owned arrays unchanged', () => {
  const header = Object.freeze(['a|b']);
  const rows = Object.freeze([Object.freeze(['v\nx'])]);
  const align = Object.freeze(['r']);
  assert.equal(mdTable(header, rows, align), '| a\\|b |\n| ---: |\n| v x |');
  assert.deepEqual(header, ['a|b']);
  assert.deepEqual(rows, [['v\nx']]);
  assert.deepEqual(align, ['r']);
});

console.log('\nmd-table: ' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
