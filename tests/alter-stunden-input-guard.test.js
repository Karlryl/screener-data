'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { alterStunden, MS_PRO_STUNDE } = require('../lib/alter.js');

const INVALID_VALUES = [
  ['null', null],
  ['undefined', undefined],
  ['NaN', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY],
  ['-Infinity', Number.NEGATIVE_INFINITY],
];

test('finite exact-hour delta returns the complete hour count', () => {
  assert.equal(alterStunden(5 * MS_PRO_STUNDE, 7 * MS_PRO_STUNDE), 2);
});

test('finite partial-hour delta is floored only after validation', () => {
  assert.equal(alterStunden(4.5 * MS_PRO_STUNDE, 7 * MS_PRO_STUNDE), 2);
});

for (const [label, value] of INVALID_VALUES) {
  test(`invalid zeitstempelMs ${label} returns null`, () => {
    assert.equal(alterStunden(value, 7 * MS_PRO_STUNDE), null);
  });

  test(`invalid jetztMs ${label} returns null`, () => {
    assert.equal(alterStunden(5 * MS_PRO_STUNDE, value), null);
  });
}
