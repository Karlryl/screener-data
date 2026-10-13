'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { extractTickersFromWikitext } = require('../discovery/wikipedia-indices.js');

function table(headerSeparator, company, symbol) {
  return [
    '{| class="wikitable"',
    `! Company ${headerSeparator} Symbol`,
    '|-',
    `| ${company} || ${symbol}`,
    '|}',
  ].join('\n');
}

test('a pipe-separated MediaWiki header exposes its ticker column', () => {
  const tickers = extractTickersFromWikitext(table('||', 'Vodafone', 'VOD'), '.L');

  assert.deepEqual([...tickers], ['VOD.L']);
});

test('the standard exclamation-separated header remains supported', () => {
  const tickers = extractTickersFromWikitext(table('!!', 'Apple', 'AAPL'), '');

  assert.deepEqual([...tickers], ['AAPL']);
});
