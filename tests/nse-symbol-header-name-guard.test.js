'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseEquityCsv } = require('../discovery/nse-in.js');

function ownsPartial(map) {
  return Object.prototype.hasOwnProperty.call(map, 'partial');
}

test('the NSE symbol column is located by header name after reordering', () => {
  const result = parseEquityCsv(
    'NAME OF COMPANY,SYMBOL\r\nReliance Industries,RELIANCE'
  );

  assert.deepEqual([...result.keys()], ['RELIANCE.NS']);
  assert.equal(result.get('RELIANCE.NS').name, 'Reliance Industries');
});

test('a reordered header-only NSE register remains a healthy empty result', () => {
  const result = parseEquityCsv('NAME OF COMPANY,SYMBOL');

  assert.equal(result.size, 0);
  assert.equal(ownsPartial(result), false);
});
