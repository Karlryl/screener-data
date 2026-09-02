'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchTaiwanUniverse } = require('../discovery/finmind-tw.js');

const ownsPartial = map => Object.hasOwn(map, 'partial');

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

test('a healthy empty FinMind response stays complete', async () => {
  const result = await quietly(() => fetchTaiwanUniverse({
    getFn: async () => JSON.stringify({ status: 200, data: [] }),
  }));

  assert.equal(result.size, 0);
  assert.equal(ownsPartial(result), false);
});

test('a FinMind transport failure returns an empty partial result', async () => {
  let calls = 0;
  const result = await quietly(() => fetchTaiwanUniverse({
    getFn: async () => {
      calls += 1;
      throw new Error('fixture transport failure');
    },
  }));

  assert.equal(calls, 1);
  assert.equal(result.size, 0);
  assert.equal(ownsPartial(result), true);
  assert.equal(result.partial, true);
});
