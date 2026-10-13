'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('./helpers/offline-network-guard');
const { fetchXetraUniverse } = require('../discovery/xetra.js');

const PREFIX = [
  'Market:;XETR',
  'Date Last Update:;01.09.2026',
  'Instrument;Mnemonic;Instrument Type;First Trading Date;ISIN',
];

function ownsPartial(map) {
  return Object.prototype.hasOwnProperty.call(map, 'partial');
}

async function fetchRow(row) {
  return fetchXetraUniverse({
    getFn: async () => PREFIX.concat(row).join('\n'),
  });
}

test('post-quote garbage cannot publish a phantom Xetra mnemonic', async () => {
  const result = await fetchRow(
    'Bad Corp;"BAD"junk;CS;2026-01-01;DE0000000001'
  );

  assert.equal(result.size, 0);
  assert.equal(ownsPartial(result), true);
  assert.equal(result.partial, true);
});

test('a valid quoted Xetra mnemonic remains healthy', async () => {
  const result = await fetchRow(
    'Good Corp;"GOOD";CS;2026-01-01;DE0000000002'
  );

  assert.deepEqual([...result.keys()], ['GOOD.DE']);
  assert.equal(ownsPartial(result), false);
});
