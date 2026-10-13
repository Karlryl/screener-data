'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildNameMap } = require('../scripts/build-findash-name-map.js');

function build(tickers) {
  const overviewBytes = Buffer.from(JSON.stringify({
    schema: 'findash-export/v1',
    rows: tickers.map(ticker => ({ ticker })),
  }));
  return buildNameMap({ overviewBytes, snapshots: [], watchlist: [] });
}

test('distinct normalized tickers build one row each', () => {
  const result = build(['ABC', 'DEF']);

  assert.equal(result.rowCount, 2);
});

test('duplicate normalized tickers fail before name resolution', () => {
  assert.throws(
    () => build(['abc', ' ABC ']),
    /published overview contains duplicate normalized tickers/,
  );
});
