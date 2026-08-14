'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isWhenIssuedSecurity } = require('../../discovery/when-issued.js');
const { isJunkSecurity } = require('../../discovery/nasdaq-all.js');
const { entferneWhenIssuedBestand, sollUniverseSchreiben, _vorGateVerworfen } = require('../../refresh-universe.js');

test('when-issued: MFPVV name and hyphen variant are detected narrowly', () => {
  assert.equal(isWhenIssuedSecurity('Midera Food Processing, Inc. - Common Stock When Issued'), true);
  assert.equal(isWhenIssuedSecurity('Example Common Stock When-Issued'), true);
  assert.equal(isJunkSecurity('MFPVV', 'Midera Food Processing, Inc. - Common Stock When Issued'), true);
  assert.equal(_vorGateVerworfen({ symbol: 'MFPVV', quoteType: 'EQUITY', longName: 'Example Stock When Issued' }), true);
});

test('when-issued: regular issuance wording and company names stay valid', () => {
  for (const name of ['Common stock issued and outstanding', 'When Systems, Inc.', 'Issued Capital plc']) {
    assert.equal(isWhenIssuedSecurity(name), false, name);
  }
});

test('when-issued: existing temporary row is removed from the watchlist', () => {
  const mfp = { ticker: 'MFP', name: 'Midera Food Processing, Inc.' };
  const mfpvv = { ticker: 'MFPVV', name: 'Midera Food Processing, Inc. - Common Stock When Issued' };
  const result = entferneWhenIssuedBestand([mfp, mfpvv]);
  assert.deepEqual(result, { stocks: [mfp], dropped: 1 });
});

test('persistence gate writes for a pure Yahoo or when-issued removal', () => {
  assert.equal(sollUniverseSchreiben({ yahooDropped: 1 }), true);
  assert.equal(sollUniverseSchreiben({ whenIssuedDropped: 1 }), true);
  assert.equal(sollUniverseSchreiben({}), false);
});

test('all US discovery adapters call the shared when-issued filter', () => {
  for (const rel of ['nasdaq-all.js', 'nasdaq-api.js', 'otc-markets.js', 'sec-tickers.js', 'finnhub.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'discovery', rel), 'utf8');
    assert.match(src, /isWhenIssuedSecurity\s*\(/, `${rel} must call the shared filter`);
  }
});
