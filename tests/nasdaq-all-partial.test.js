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
  'network tripwire must fire before the NASDAQ module loads');
assert.equal(networkAttempts, 1, 'network tripwire control did not execute exactly once');
after(() => { https.get = originalGet; });

const { fetchNasdaqAll } = require('../discovery/nasdaq-all');

const NASDAQ_HEADER = 'Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares|Future Field';
const OTHER_HEADER = 'ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol|Future Field';

function nasdaqFile(symbol = 'NDAQX') {
  return [
    NASDAQ_HEADER,
    symbol + '|Nasdaq Example Inc|Q|N|N|100|N|N|ignored',
    'File Creation Time: 0901202606:00',
  ].join('\n');
}

function otherFile(symbol = 'NYSEX') {
  return [
    OTHER_HEADER,
    symbol + '|NYSE Example Inc|N|' + symbol + '|N|100|N|' + symbol + '|ignored',
    'File Creation Time: 0901202606:00',
  ].join('\n');
}

function sourceKey(url) {
  if (url.endsWith('/nasdaqlisted.txt')) return 'nasdaq';
  if (url.endsWith('/otherlisted.txt')) return 'other';
  throw new Error('unexpected NASDAQ Trader URL: ' + url);
}

function fixtureFetch(fixtures, calls) {
  return async (url) => {
    const key = sourceKey(url);
    calls.push(key);
    const value = fixtures[key];
    if (value instanceof Error) throw value;
    assert.notEqual(value, undefined, 'missing fixture for ' + key);
    return value;
  };
}

async function run(fixtures) {
  const calls = [];
  const beforeNetworkAttempts = networkAttempts;
  const map = await fetchNasdaqAll({ fetchText: fixtureFetch(fixtures, calls) });
  assert.equal(networkAttempts, beforeNetworkAttempts, 'fixture escaped through the real HTTPS path');
  assert.deepEqual(calls, ['nasdaq', 'other'], 'both independent register files must always be attempted');
  return map;
}

test('both healthy register files retain both populations without a partial marker', async () => {
  const map = await run({ nasdaq: nasdaqFile(), other: otherFile() });
  assert.deepEqual([...map.keys()], ['NDAQX', 'NYSEX']);
  assert.equal(map.get('NDAQX').exchange, 'NASDAQ');
  assert.equal(map.get('NYSEX').exchange, 'NYSE');
  assert.equal(map.partial, undefined);
});

test('either one-sided fetch failure preserves the healthy half and stamps partial', async () => {
  const noOther = await run({ nasdaq: nasdaqFile(), other: new Error('ECONNRESET other') });
  assert.deepEqual([...noOther.keys()], ['NDAQX']);
  assert.equal(noOther.partial, true);

  const noNasdaq = await run({ nasdaq: new Error('ECONNRESET nasdaq'), other: otherFile() });
  assert.deepEqual([...noNasdaq.keys()], ['NYSEX']);
  assert.equal(noNasdaq.partial, true);
});

test('a total fetch failure stays an empty but visibly partial Map', async () => {
  const map = await run({
    nasdaq: new Error('ECONNRESET nasdaq'),
    other: new Error('ECONNRESET other'),
  });
  assert.equal(map.size, 0);
  assert.equal(map.partial, true);
});

test('HTTP-200 header-only content cannot masquerade as a healthy source half', async () => {
  const noNasdaqRows = await run({
    nasdaq: [NASDAQ_HEADER, 'File Creation Time: 0901202606:00'].join('\n'),
    other: otherFile(),
  });
  assert.deepEqual([...noNasdaqRows.keys()], ['NYSEX']);
  assert.equal(noNasdaqRows.partial, true);

  const noOtherRows = await run({
    nasdaq: nasdaqFile(),
    other: [OTHER_HEADER, 'File Creation Time: 0901202606:00'].join('\n'),
  });
  assert.deepEqual([...noOtherRows.keys()], ['NDAQX']);
  assert.equal(noOtherRows.partial, true);
});

test('leading blank lines cannot move the header into the parser data range', async () => {
  const shiftedNasdaq = await run({ nasdaq: '\n' + nasdaqFile(), other: otherFile() });
  assert.deepEqual([...shiftedNasdaq.keys()], ['NYSEX']);
  assert.equal(shiftedNasdaq.has('SYMBOL'), false);
  assert.equal(shiftedNasdaq.partial, true);

  const shiftedOther = await run({ nasdaq: nasdaqFile(), other: '\n' + otherFile() });
  assert.deepEqual([...shiftedOther.keys()], ['NDAQX']);
  assert.equal(shiftedOther.has('ACT SYMBOL'), false);
  assert.equal(shiftedOther.partial, true);
});

test('a missing file-creation footer exposes a truncated HTTP-200 body', async () => {
  const truncatedNasdaq = nasdaqFile().split('\n').slice(0, -1).join('\n');
  const noNasdaqFooter = await run({ nasdaq: truncatedNasdaq, other: otherFile() });
  assert.deepEqual([...noNasdaqFooter.keys()], ['NYSEX']);
  assert.equal(noNasdaqFooter.partial, true);

  const truncatedOther = otherFile().split('\n').slice(0, -1).join('\n');
  const noOtherFooter = await run({ nasdaq: nasdaqFile(), other: truncatedOther });
  assert.deepEqual([...noOtherFooter.keys()], ['NDAQX']);
  assert.equal(noOtherFooter.partial, true);
});

test('every parser-relevant header field is validated for both source files', async () => {
  const nasdaqHeaderFields = [0, 1, 3, 6];
  for (const index of nasdaqHeaderFields) {
    const fields = NASDAQ_HEADER.split('|');
    fields[index] = 'Unexpected Field';
    const malformed = nasdaqFile().replace(NASDAQ_HEADER, fields.join('|'));
    const map = await run({ nasdaq: malformed, other: otherFile() });
    assert.deepEqual([...map.keys()], ['NYSEX'], 'NASDAQ header column ' + (index + 1));
    assert.equal(map.partial, true, 'NASDAQ header column ' + (index + 1));
  }

  const otherHeaderFields = [0, 1, 2, 4, 6];
  for (const index of otherHeaderFields) {
    const fields = OTHER_HEADER.split('|');
    fields[index] = 'Unexpected Field';
    const malformed = otherFile().replace(OTHER_HEADER, fields.join('|'));
    const map = await run({ nasdaq: nasdaqFile(), other: malformed });
    assert.deepEqual([...map.keys()], ['NDAQX'], 'otherlisted header column ' + (index + 1));
    assert.equal(map.partial, true, 'otherlisted header column ' + (index + 1));
  }
});
