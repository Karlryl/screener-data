#!/usr/bin/env node
'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');

const originalGet = https.get;
let networkAttempts = 0;
https.get = () => {
  networkAttempts++;
  throw new Error('NETWORK_ATTEMPT');
};
assert.throws(() => https.get('https://network-tripwire.invalid'), /NETWORK_ATTEMPT/);
after(() => { https.get = originalGet; });

const { fetchLseUniverse } = require('../discovery/lse-uk');

const body = JSON.stringify({
  components: [{
    content: [{
      value: {
        content: [
          { tidm: 'BP', issuername: 'BP PLC', isin: 'GB0007980591', category: 'EQUITY', islse: true },
          { tidm: 'VOD', issuername: 'Vodafone', category: 'EQUITY', islse: true },
        ],
        totalPages: 1,
      },
    }],
  }],
});

async function runFixture() {
  const before = networkAttempts;
  const result = await fetchLseUniverse({ fetchText: async () => body });
  assert.equal(networkAttempts, before, 'fixture escaped through the real HTTPS path');
  return result;
}

test('preserves a supplied LSE ISIN', async () => {
  const result = await runFixture();
  assert.equal(result.get('BP.L')?.isin, 'GB0007980591');
});

test('keeps a missing optional LSE ISIN absent', async () => {
  const result = await runFixture();
  const vod = result.get('VOD.L');
  assert.ok(vod);
  assert.equal(Object.hasOwn(vod, 'isin'), false);
});
