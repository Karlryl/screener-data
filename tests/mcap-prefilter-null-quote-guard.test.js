'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { prefilterByMcap } = require('../discovery/mcap-prefilter.js');

async function exercise(symbols, quoteResult) {
  const calls = [];
  const originalLog = console.log;
  console.log = () => {};

  try {
    const result = await prefilterByMcap(symbols, {
      minUsd: 2e9,
      rates: { USD: 1 },
      quote: async (batch) => {
        calls.push([...batch]);
        return quoteResult;
      },
    });
    return { result, calls };
  } finally {
    console.log = originalLog;
  }
}

test('a null main-pass quote cannot discard a valid tail', async () => {
  const { result, calls } = await exercise(
    ['MISSING.PA', 'GOOD.PA'],
    [null, {
      symbol: 'GOOD.PA',
      marketCap: 3e9,
      currency: 'USD',
      quoteType: 'EQUITY',
    }]
  );

  assert.deepEqual(calls, [['MISSING.PA', 'GOOD.PA']]);
  assert.deepEqual([...result.kept], [['GOOD.PA', 3e9]]);
  assert.deepEqual([...result.answered], ['GOOD.PA']);
});

test('a truthy quote without a symbol remains an ignored control', async () => {
  const { result, calls } = await exercise(['NO-SYMBOL.PA'], [{}]);

  assert.deepEqual(calls, [['NO-SYMBOL.PA']]);
  assert.deepEqual(
    {
      kept: result.kept.size,
      answered: result.answered.size,
      renamed: result.renamed.size,
      unpriceable: result.unpriceable.size,
      belowUsd: result.belowUsd.size,
      nichtAktie: result.nichtAktie.size,
    },
    { kept: 0, answered: 0, renamed: 0, unpriceable: 0, belowUsd: 0, nichtAktie: 0 }
  );
});
