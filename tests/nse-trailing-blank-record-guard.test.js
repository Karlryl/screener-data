'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseEquityCsv } = require('../discovery/nse-in.js');

function ownsPartial(map) {
  return Object.prototype.hasOwnProperty.call(map, 'partial');
}

test('a terminal blank NSE record remains a healthy empty register', () => {
  const result = parseEquityCsv('SYMBOL,NAME OF COMPANY\r\n');

  assert.equal(result.size, 0);
  assert.equal(ownsPartial(result), false);
});

test('a valid final NSE record needs no terminal newline', () => {
  const result = parseEquityCsv(
    'SYMBOL,NAME OF COMPANY\r\nRELIANCE,Reliance Industries'
  );

  assert.deepEqual([...result.keys()], ['RELIANCE.NS']);
});
