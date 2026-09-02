'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchXetraUniverse } = require('../discovery/xetra.js');

const VALID_CSV = [
  'Market:;XETR',
  'Date Last Update:;01.09.2026',
  'Instrument;Mnemonic;Instrument Type;First Trading Date;ISIN',
  'SAP SE;SAP;CS;1995-01-01;DE0007164600',
].join('\n');

function ownsPartial(map) {
  return Object.prototype.hasOwnProperty.call(map, 'partial');
}

async function quietly(run) {
  const oldLog = console.log;
  const oldError = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return await run();
  } finally {
    console.log = oldLog;
    console.error = oldError;
  }
}

test('a valid Xetra register remains a healthy complete result', async () => {
  const result = await quietly(() => fetchXetraUniverse({ getFn: async () => VALID_CSV }));

  assert.equal(result.size, 1);
  assert.equal(result.has('SAP.DE'), true);
  assert.equal(ownsPartial(result), false);
});

test('a Xetra transport failure remains visibly partial', async () => {
  const result = await quietly(() => fetchXetraUniverse({
    getFn: async () => { throw new Error('socket closed'); },
  }));

  assert.equal(result.size, 0);
  assert.equal(ownsPartial(result), true);
  assert.equal(result.partial, true);
});
