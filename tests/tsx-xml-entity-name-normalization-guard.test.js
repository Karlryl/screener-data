'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSheet } = require('../discovery/tsx-ca.js');

function inlineCell(ref, value) {
  return `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
}

function sheetXml(rows) {
  const header = [
    inlineCell('A1', 'Exchange'),
    inlineCell('B1', 'Name'),
    inlineCell('C1', 'Root Ticker'),
  ].join('');
  const body = rows.map(([name, ticker], index) => {
    const row = index + 2;
    return `<row r="${row}">` + [
      inlineCell(`A${row}`, 'TSX'),
      inlineCell(`B${row}`, name),
      inlineCell(`C${row}`, ticker),
    ].join('') + '</row>';
  }).join('');
  return `<worksheet><sheetData><row r="1">${header}</row>${body}</sheetData></worksheet>`;
}

const result = new Map();
parseSheet(sheetXml([
  ['AT&amp;T Operating Inc.', 'ATT'],
  ['Plain Company', 'PLAIN'],
]), [], result);

test('TSX inline-string ampersand entities are decoded in issuer names', () => {
  assert.equal(result.get('ATT.TO')?.name, 'AT&T Operating Inc.');
});

test('plain TSX names remain an unchanged parser control', () => {
  assert.equal(result.get('PLAIN.TO')?.name, 'Plain Company');
  assert.equal(result.size, 2);
});
