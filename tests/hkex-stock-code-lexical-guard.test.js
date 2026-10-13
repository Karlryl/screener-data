'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { parseSheet } = require('../discovery/hkex-hk.js');

function row(number, code, name) {
  return '<x:row r="' + number + '">' +
    '<x:c r="A' + number + '" t="str"><x:v>' + code + '</x:v></x:c>' +
    '<x:c r="B' + number + '" t="str"><x:v>' + name + '</x:v></x:c>' +
    '<x:c r="C' + number + '" t="str"><x:v>Equity</x:v></x:c>' +
    '</x:row>';
}

function sheet(...rows) {
  return '<x:worksheet><x:sheetData>' + rows.join('') +
    '</x:sheetData></x:worksheet>';
}

test('exponent-like stock codes cannot steal a genuine HKEX ticker', () => {
  const parsed = parseSheet(sheet(
    row(2, '7e2', 'WRONG EXPONENT'),
    row(3, '700', 'RIGHT TENCENT')
  ));

  assert.deepEqual([...parsed.keys()], ['0700.HK']);
  assert.equal(parsed.get('0700.HK').name, 'RIGHT TENCENT');
});

test('structurally valid rows with only invalid codes stay healthy and empty', () => {
  const parsed = parseSheet(sheet(
    row(2, '700junk', 'WRONG SUFFIX'),
    row(3, '700.5', 'WRONG DECIMAL'),
    row(4, '0', 'WRONG ZERO'),
    row(5, '10000', 'WRONG RANGE')
  ));

  assert.equal(parsed.size, 0);
  assert.equal(Object.hasOwn(parsed, 'partial'), false);
});
