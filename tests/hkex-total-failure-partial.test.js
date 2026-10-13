'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchHkexUniverse } = require('../discovery/hkex-hk.js');

const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const EQUITY_ROW = [
  '<x:row r="2">',
  '<x:c r="A2" t="str"><x:v>700</x:v></x:c>',
  '<x:c r="B2" t="str"><x:v>TENCENT</x:v></x:c>',
  '<x:c r="C2" t="str"><x:v>Equity</x:v></x:c>',
  '</x:row>',
].join('');

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

test('an injected healthy HKEX register remains a complete result', async () => {
  const result = await quietly(() => fetchHkexUniverse({
    getBufferFn: async () => ZIP_SIGNATURE,
    extractZipEntryFn: () => Buffer.from(EQUITY_ROW),
  }));

  assert.equal(result.size, 1);
  assert.equal(result.has('0700.HK'), true);
  assert.equal(ownsPartial(result), false);
});

test('an HKEX transport failure remains visibly partial', async () => {
  const result = await quietly(() => fetchHkexUniverse({
    getBufferFn: async () => { throw new Error('offline'); },
  }));

  assert.equal(result.size, 0);
  assert.equal(ownsPartial(result), true);
  assert.equal(result.partial, true);
});
