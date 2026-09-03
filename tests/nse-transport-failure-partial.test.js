'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchNseIndia } = require('../discovery/nse-in.js');

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

test('a header-only NSE register remains a healthy empty result', async () => {
  const result = await quietly(() => fetchNseIndia({
    getFn: async () => 'SYMBOL,NAME OF COMPANY',
  }));

  assert.equal(result.size, 0);
  assert.equal(ownsPartial(result), false);
});

test('an NSE transport failure remains visibly partial', async () => {
  const result = await quietly(() => fetchNseIndia({
    getFn: async () => { throw new Error('offline'); },
  }));

  assert.equal(result.size, 0);
  assert.equal(ownsPartial(result), true);
  assert.equal(result.partial, true);
});
