'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSheet } = require('../discovery/hkex-hk.js');

function row(number, code, name, category) {
  return '<x:row r="' + number + '">' +
    '<x:c r="A' + number + '" t="str"><x:v>' + code + '</x:v></x:c>' +
    '<x:c r="B' + number + '" t="str"><x:v>' + name + '</x:v></x:c>' +
    '<x:c r="C' + number + '" t="str"><x:v>' + category + '</x:v></x:c>' +
    '</x:row>';
}

test('keeps HKEX derivative warrants out of the equity universe', () => {
  const result = parseSheet([
    row(2, '700', 'DERIVATIVE', 'Derivative Warrant'),
    row(3, '5', 'HSBC HOLDINGS', 'Equity'),
  ].join(''));

  assert.equal(result.has('0700.HK'), false);
  assert.equal(result.has('0005.HK'), true);
});

test('keeps a structurally valid HKEX header-only sheet empty', () => {
  const result = parseSheet(row(1, 'Stock Code', 'Name', 'Category'));
  assert.equal(result.size, 0);
});
