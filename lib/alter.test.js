'use strict';
const assert = require('node:assert/strict');
const { alterTage, alterStunden, istVeraltet, zeigeTage, MS_PRO_TAG, MS_PRO_STUNDE } = require('./alter.js');
let pass = 0;
function test(name, fn) { fn(); pass++; console.log('ok ' + name); }

test('documented units are exact', () => {
  assert.equal(MS_PRO_TAG, 86400000);
  assert.equal(MS_PRO_STUNDE, 3600000);
  assert.equal(MS_PRO_TAG, 24 * MS_PRO_STUNDE);
});
test('day age preserves fractions instead of rounding the alarm away', () => {
  assert.equal(alterTage(0, 0), 0);
  assert.equal(alterTage(0, 86400000), 1);
  assert.equal(alterTage(0, 216000000), 2.5);
  assert.equal(alterTage(86400000, 0), -1);
  assert.equal(alterTage(-86400000, 0), 1);
  assert.equal(alterTage(0, 1), 1 / 86400000);
});
test('hour age floors both positive and negative durations', () => {
  assert.equal(alterStunden(0, 0), 0);
  assert.equal(alterStunden(0, 3599999), 0);
  assert.equal(alterStunden(0, 3600000), 1);
  assert.equal(alterStunden(0, 7199999), 1);
  assert.equal(alterStunden(1, 0), -1);
  assert.equal(alterStunden(-7200000, 0), 2);
});
test('invalid timestamps return null in either argument', () => {
  for (const value of [null, undefined, NaN, Infinity, -Infinity, '', '0', false]) {
    for (const fn of [alterTage, alterStunden]) {
      assert.equal(fn(value, 0), null);
      assert.equal(fn(0, value), null);
    }
  }
});
test('staleness uses the unrounded strict boundary', () => {
  assert.equal(istVeraltet(2, 2), false);
  assert.equal(istVeraltet(2 + 1 / 86400000, 2), true);
  assert.equal(istVeraltet(2.76, 2), true);
  assert.equal(istVeraltet(0, 0), false);
  assert.equal(istVeraltet(-1, 2), false);
  assert.equal(istVeraltet(0, -1), true);
  assert.equal(istVeraltet(-2, -1), false);
});
test('unusable age or threshold fails closed', () => {
  for (const value of [null, undefined, NaN, Infinity, -Infinity, '', '2', false]) {
    assert.equal(istVeraltet(value, 2), true);
    assert.equal(istVeraltet(1, value), true);
  }
});
test('display rounds without controlling staleness', () => {
  assert.equal(zeigeTage(0), '0.0');
  assert.equal(zeigeTage(2.76), '2.8');
  assert.equal(zeigeTage(-1.25), '-1.3');
  assert.equal(zeigeTage(2.01), '2.0');
  assert.equal(istVeraltet(2.01, 2), true);
});
test('display marks unusable ages as unknown', () => {
  for (const value of [null, undefined, NaN, Infinity, -Infinity, '', '2', false]) assert.equal(zeigeTage(value), '?');
});
console.log('alter.test.js: ' + pass + ' cases passed');
