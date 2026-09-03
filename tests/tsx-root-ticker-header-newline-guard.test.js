'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseSheet } = require('../discovery/tsx-ca.js');

function inlineCell(ref, value) {
  return `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
}

function sheetXml(rootTickerHeader, rows = []) {
  const header = [
    inlineCell('A1', 'Exchange'),
    inlineCell('B1', 'Name'),
    inlineCell('C1', rootTickerHeader),
  ].join('');
  const body = rows.map(([exchange, name, ticker], index) => {
    const row = index + 2;
    return `<row r="${row}">` + [
      inlineCell(`A${row}`, exchange),
      inlineCell(`B${row}`, name),
      inlineCell(`C${row}`, ticker),
    ].join('') + '</row>';
  }).join('');
  return `<worksheet><sheetData><row r="1">${header}</row>${body}</sheetData></worksheet>`;
}

function parse(rootTickerHeader, rows) {
  const result = new Map();
  const added = parseSheet(sheetXml(rootTickerHeader, rows), [], result);
  return { added, result };
}

test('TSX recognizes the documented newline inside the Root Ticker header', () => {
  const rootTickerHeader = 'Root\nTicker';
  assert.equal(rootTickerHeader.includes('\n'), true, 'fixture must contain a runtime LF');

  const { added, result } = parse(rootTickerHeader, [
    ['TSX', 'Wrapped Resources Inc.', 'WRAP'],
  ]);

  assert.equal(added, 1);
  assert.deepEqual([...result.keys()], ['WRAP.TO']);
});

test('an ordinary header-only sheet remains a legitimate empty result', () => {
  const { added, result } = parse('Root Ticker', []);

  assert.equal(added, 0);
  assert.equal(result.size, 0);
});
