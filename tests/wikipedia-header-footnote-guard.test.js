'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { extractTickersFromWikitext } = require('../discovery/wikipedia-indices.js');

function table(header, company, symbol) {
  return [
    '{| class="wikitable"',
    `! Company !! ${header}`,
    '|-',
    `| ${company} || ${symbol}`,
    '|}',
  ].join('\n');
}

test('a trailing footnote does not hide the Wikipedia ticker column', () => {
  const tickers = extractTickersFromWikitext(table('Symbol[a]', 'Vodafone', 'VOD'), '.L');

  assert.deepEqual([...tickers], ['VOD.L']);
});

test('a plain Wikipedia ticker header remains supported', () => {
  const tickers = extractTickersFromWikitext(table('Symbol', 'Apple', 'AAPL'), '');

  assert.deepEqual([...tickers], ['AAPL']);
});
