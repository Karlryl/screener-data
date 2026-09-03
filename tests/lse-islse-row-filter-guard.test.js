#!/usr/bin/env node
'use strict';

require('./helpers/offline-network-guard');

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { fetchLseUniverse } = require('../discovery/lse-uk');

function page(rows) {
  return JSON.stringify({
    components: [{ content: [{ value: { content: rows, totalPages: 1 } }] }],
  });
}

async function fetchRows(rows) {
  let calls = 0;
  const result = await fetchLseUniverse({
    fetchText: async () => {
      calls++;
      return page(rows);
    },
  });
  assert.equal(calls, 2, 'both LSE markets must consume the fixture');
  return result;
}

test('LSE keeps only rows explicitly marked as LSE instruments', async () => {
  const result = await fetchRows([
    { tidm: 'OFF', issuername: 'Off-market Equity', category: 'EQUITY', islse: false },
    { tidm: 'BP', issuername: 'BP plc', category: 'EQUITY', islse: true },
  ]);

  assert.deepEqual([...result.keys()], ['BP.L']);
  assert.equal(result.has('OFF.L'), false);
  assert.equal(result.partial, undefined);
});

test('a structurally valid page with no equities is a healthy empty result', async () => {
  const result = await fetchRows([
    { tidm: 'BOND', issuername: 'Example Bond', category: 'BOND', islse: true },
  ]);

  assert.equal(result.size, 0);
  assert.equal(result.partial, undefined);
});
