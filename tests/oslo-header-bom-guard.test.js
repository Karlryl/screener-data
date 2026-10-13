'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('./helpers/offline-network-guard');
const { fetchOsloUniverse } = require('../discovery/oslo.js');

const HEADER = 'Name;ISIN;Symbol;Market;Currency';
const ROW = 'Reserve Growth ASA;NO0010000001;RGRW;Euronext Growth Oslo;NOK';

async function keysFor(header) {
  const result = await fetchOsloUniverse(async () => [header, ROW].join('\n'));
  return [...result.keys()];
}

test('accepts a UTF-8 BOM before a first-line Oslo header', async () => {
  assert.deepEqual(await keysFor('\uFEFF' + HEADER), ['RGRW.OL']);
});

test('accepts the same first-line Oslo header without a BOM', async () => {
  assert.deepEqual(await keysFor(HEADER), ['RGRW.OL']);
});
