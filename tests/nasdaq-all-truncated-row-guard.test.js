'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { fetchNasdaqAll } = require('../discovery/nasdaq-all.js');

const NASDAQ_HEADER = 'Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares';
const OTHER_HEADER = 'ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol';
const FOOTER = 'File Creation Time: 0902202606:00';

function registerFile(header, rows) {
  return [header, ...rows, FOOTER].join('\n');
}

async function run(nasdaqRows, otherRows) {
  const nasdaqText = registerFile(NASDAQ_HEADER, nasdaqRows);
  const otherText = registerFile(OTHER_HEADER, otherRows);

  return fetchNasdaqAll({
    fetchText: async (url) => {
      if (url.endsWith('/nasdaqlisted.txt')) return nasdaqText;
      if (url.endsWith('/otherlisted.txt')) return otherText;
      throw new Error('unexpected NASDAQ Trader URL: ' + url);
    },
  });
}

test('rows missing a consumed classification flag are not published', async () => {
  const map = await run([
    'NVALID|Nasdaq Valid Inc|Q|N|N|100|N|N',
    'NTRUNC|Nasdaq Short Inc|Q|N|N|100',
  ], [
    'OVALID|Other Valid Inc|N|OVALID|N|100|N|OVALID',
    'OTRUNC|Other Short Inc|N|OTRUNC|N|100',
  ]);

  assert.equal(map.has('NVALID'), true);
  assert.equal(map.has('OVALID'), true);
  assert.equal(map.has('NTRUNC'), false);
  assert.equal(map.has('OTRUNC'), false);
});

test('full-width rows alongside internal blank lines stay healthy', async () => {
  const map = await run([
    'NBLANK|Nasdaq Blank Control Inc|Q|N|N|100|N|N',
    '',
  ], [
    'OBLANK|Other Blank Control Inc|N|OBLANK|N|100|N|OBLANK',
    '',
  ]);

  assert.equal(map.has('NBLANK'), true);
  assert.equal(map.has('OBLANK'), true);
  assert.equal(map.size, 2);
  assert.equal(map.partial, undefined);
});
