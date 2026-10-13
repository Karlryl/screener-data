'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { fetchTaiwanUniverse } = require('../discovery/finmind-tw.js');

async function fetchRows(data) {
  return fetchTaiwanUniverse({
    getFn: async () => JSON.stringify({ status: 200, data }),
  });
}

test('FinMind ETF category is excluded from the common-stock universe', async () => {
  const result = await fetchRows([
    {
      stock_id: '0050',
      stock_name: 'Taiwan 50 ETF',
      type: 'twse',
      industry_category: 'ETF',
    },
    {
      stock_id: '2330',
      stock_name: 'TSMC',
      type: 'twse',
      industry_category: 'Semiconductor',
    },
  ]);

  assert.deepEqual([...result.keys()], ['2330.TW']);
});

test('ordinary stock with omitted optional category remains healthy', async () => {
  const result = await fetchRows([
    { stock_id: '6488', stock_name: 'GlobalWafers', type: 'tpex' },
  ]);

  assert.deepEqual([...result.keys()], ['6488.TWO']);
  assert.equal(Object.hasOwn(result, 'partial'), false);
});
