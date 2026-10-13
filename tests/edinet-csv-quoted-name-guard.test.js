'use strict';

const offlineGuard = require('./helpers/offline-network-guard');
const assert = require('node:assert/strict');
const { after, test } = require('node:test');
const { fetchEdinetJapan } = require('../discovery/edinet-jp.js');

const HEADER = '上場区分,提出者名（英字）,証券コード';

async function fetchRow(row) {
  const csv = ['download metadata', HEADER, row].join('\n');
  return fetchEdinetJapan({
    get: async () => Buffer.from('synthetic zip'),
    unzip: () => Buffer.from('synthetic Shift_JIS payload'),
    decode: () => csv,
  });
}

test('comma inside a double-quoted EDINET name stays in one field', async () => {
  const result = await fetchRow('上場,"Alpha, Holdings Inc.",285AA');

  assert.deepEqual([...result.keys()], ['285A.T']);
  assert.equal(result.get('285A.T').name, 'Alpha, Holdings Inc.');
});

test('plain EDINET name remains unchanged', async () => {
  const result = await fetchRow('上場,Plain Company,13770');

  assert.deepEqual([...result.keys()], ['1377.T']);
  assert.equal(result.get('1377.T').name, 'Plain Company');
});

after(() => {
  assert.deepEqual(offlineGuard.state.attempts, [], 'all fixtures must stay on injected offline seams');
});
