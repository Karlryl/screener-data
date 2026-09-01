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
assert.throws(() => https.get('https://network-tripwire.invalid'), /NETWORK_ATTEMPT/,
  'network tripwire must fire before the LSE module loads');
assert.equal(networkAttempts, 1, 'network tripwire control did not execute exactly once');
after(() => { https.get = originalGet; });

const { fetchLseUniverse, parseTotalPages } = require('../discovery/lse-uk');

function row(tidm, name) {
  return { tidm, issuername: name, category: 'EQUITY', islse: true };
}

function page(totalPages, rows) {
  return JSON.stringify({
    components: [{
      content: [{ value: {} }, { value: { content: rows, totalPages } }],
    }],
  });
}

function pageAfterForeignBlock(totalPages, rows) {
  return JSON.stringify({
    components: [{
      content: [
        { value: { content: [], totalPages: 999 } },
        { value: { content: rows, totalPages } },
      ],
    }],
  });
}

function requestKey(url) {
  const outer = new URL(url).searchParams.get('parameters');
  assert.ok(outer, 'LSE request must carry encoded parameters');
  const params = new URLSearchParams(decodeURIComponent(outer));
  return params.get('markets') + ':' + params.get('page');
}

function fixtureFetch(fixtures, calls) {
  return async (url) => {
    const key = requestKey(url);
    calls.push(key);
    assert.ok(Object.hasOwn(fixtures, key), 'unexpected LSE request ' + key);
    return fixtures[key];
  };
}

async function run(fixtures) {
  const calls = [];
  const beforeNetworkAttempts = networkAttempts;
  const map = await fetchLseUniverse({ fetchText: fixtureFetch(fixtures, calls) });
  assert.equal(networkAttempts, beforeNetworkAttempts, 'fixture escaped through the real HTTPS path');
  return { map, calls };
}

test('parseTotalPages keeps the one-page default and bounded numeric compatibility', () => {
  assert.equal(parseTotalPages(undefined), 1);
  assert.equal(parseTotalPages(null), 1);
  assert.equal(parseTotalPages(1), 1);
  assert.equal(parseTotalPages('2'), 2);
  assert.equal(parseTotalPages(40), 40);
  assert.equal(parseTotalPages('40'), 40);
});

test('parseTotalPages rejects coercible junk, unsafe values and operationally excessive counts', () => {
  const invalid = [
    0, -1, 1.5, 41, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1,
    '', ' 2 ', '02', '2junk', '1e1', '41', '9007199254740993',
    true, false, [2], {},
  ];
  for (const value of invalid) {
    assert.throws(() => parseTotalPages(value), /invalid totalPages/, 'must reject ' + String(value));
  }
});

test('invalid pagination metadata fails only its market and marks either market order partial', async () => {
  const badAim = await run({
    'MAINMARKET:0': page(1, [row('MAINX', 'Main X')]),
    'AIM:0': page(-1, [row('BAD', 'Bad AIM')]),
  });
  assert.deepEqual(badAim.calls, ['MAINMARKET:0', 'AIM:0']);
  assert.deepEqual([...badAim.map.keys()], ['MAINX.L']);
  assert.equal(badAim.map.partial, true);

  const badMain = await run({
    'MAINMARKET:0': page(true, [row('BAD', 'Bad Main')]),
    'AIM:0': page(1, [row('AIMX', 'Aim X')]),
  });
  assert.deepEqual(badMain.calls, ['MAINMARKET:0', 'AIM:0']);
  assert.deepEqual([...badMain.map.keys()], ['AIMX.L']);
  assert.equal(badMain.map.partial, true);

  const emptyInvalid = await run({
    'MAINMARKET:0': page(1, [row('MAINX', 'Main X')]),
    'AIM:0': page(41, []),
  });
  assert.deepEqual(emptyInvalid.calls, ['MAINMARKET:0', 'AIM:0']);
  assert.deepEqual([...emptyInvalid.map.keys()], ['MAINX.L']);
  assert.equal(emptyInvalid.map.partial, true,
    'empty content must not bypass invalid pagination metadata');
});

test('valid two-page metadata fetches every declared page without a partial marker', async () => {
  const result = await run({
    'MAINMARKET:0': page(1, [row('MAINX', 'Main X')]),
    'AIM:0': page('2', [row('AIMONE', 'Aim One')]),
    'AIM:1': page(2, [row('AIMTWO', 'Aim Two')]),
  });
  assert.deepEqual(result.calls, ['MAINMARKET:0', 'AIM:0', 'AIM:1']);
  assert.deepEqual([...result.map.keys()], ['MAINX.L', 'AIMONE.L', 'AIMTWO.L']);
  assert.equal(result.map.partial, undefined);
});

test('later absent pagination metadata retains the first page count', async () => {
  const result = await run({
    'MAINMARKET:0': page(1, [row('MAINX', 'Main X')]),
    'AIM:0': page(2, [row('AIMONE', 'Aim One')]),
    'AIM:1': page(undefined, [row('AIMTWO', 'Aim Two')]),
  });
  assert.deepEqual(result.calls, ['MAINMARKET:0', 'AIM:0', 'AIM:1']);
  assert.deepEqual([...result.map.keys()], ['MAINX.L', 'AIMONE.L', 'AIMTWO.L']);
  assert.equal(result.map.partial, undefined);

  const laterNull = await run({
    'MAINMARKET:0': page(1, [row('MAINX', 'Main X')]),
    'AIM:0': page(2, [row('AIMONE', 'Aim One')]),
    'AIM:1': page(null, [row('AIMTWO', 'Aim Two')]),
  });
  assert.deepEqual(laterNull.calls, ['MAINMARKET:0', 'AIM:0', 'AIM:1']);
  assert.deepEqual([...laterNull.map.keys()], ['MAINX.L', 'AIMONE.L', 'AIMTWO.L']);
  assert.equal(laterNull.map.partial, undefined);
});

test('absent or null first-page metadata keeps the compatible one-page default', async () => {
  const result = await run({
    'MAINMARKET:0': page(undefined, [row('MAINX', 'Main X')]),
    'AIM:0': page(null, [row('AIMX', 'Aim X')]),
  });
  assert.deepEqual(result.calls, ['MAINMARKET:0', 'AIM:0']);
  assert.deepEqual([...result.map.keys()], ['MAINX.L', 'AIMX.L']);
  assert.equal(result.map.partial, undefined);
});

test('a page-count change in either direction cannot look complete', async () => {
  const shrinks = await run({
    'MAINMARKET:0': page(1, [row('MAINX', 'Main X')]),
    'AIM:0': page(3, [row('AIMONE', 'Aim One')]),
    'AIM:1': page(1, [row('AIMTWO', 'Aim Two')]),
  });
  assert.deepEqual(shrinks.calls, ['MAINMARKET:0', 'AIM:0', 'AIM:1']);
  assert.deepEqual([...shrinks.map.keys()], ['MAINX.L', 'AIMONE.L']);
  assert.equal(shrinks.map.partial, true);

  const grows = await run({
    'MAINMARKET:0': page(1, [row('MAINX', 'Main X')]),
    'AIM:0': page(2, [row('AIMONE', 'Aim One')]),
    'AIM:1': page(3, [row('AIMTWO', 'Aim Two')]),
  });
  assert.deepEqual(grows.calls, ['MAINMARKET:0', 'AIM:0', 'AIM:1']);
  assert.deepEqual([...grows.map.keys()], ['MAINX.L', 'AIMONE.L']);
  assert.equal(grows.map.partial, true);
});

test('an unusable pagination block is a visible per-market failure', async () => {
  const result = await run({
    'MAINMARKET:0': JSON.stringify({ components: [] }),
    'AIM:0': page(1, [row('AIMX', 'Aim X')]),
  });
  assert.deepEqual(result.calls, ['MAINMARKET:0', 'AIM:0']);
  assert.deepEqual([...result.map.keys()], ['AIMX.L']);
  assert.equal(result.map.partial, true);
});

test('a preceding paginated CMS block cannot mask the instrument block', async () => {
  const result = await run({
    'MAINMARKET:0': pageAfterForeignBlock(1, [row('MAINX', 'Main X')]),
    'AIM:0': page(1, [row('AIMX', 'Aim X')]),
  });
  assert.deepEqual(result.calls, ['MAINMARKET:0', 'AIM:0']);
  assert.deepEqual([...result.map.keys()], ['MAINX.L', 'AIMX.L']);
  assert.equal(result.map.partial, undefined);
});
