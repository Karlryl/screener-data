'use strict';

// W7 2026-09-26: TradingView emits Bursa trading names (MAYBANK.KL); Yahoo only knows the
// numeric Bursa code (1155.KL). configs/bursa-name-to-code.json maps one to the other.
const test = require('node:test');
const assert = require('node:assert/strict');
const { MARKETS, verarbeiteZeilen, bursaYahooSymbol, isUnmappedBursa } = require('../discovery/tv-scanner.js');
const { repariereBursaBestand } = require('../refresh-universe.js');
const map = require('../configs/bursa-name-to-code.json');

const cfg = MARKETS['tv-malaysia'];
const rates = { USD: 1, MYR: 0.2456 };
const row = (code, name) => ({ d: [code, 1e11, 'MYR', name, 'stock', 'common', 'MYX', 'Malaysia'] });

test('bursa: presence — MAYBANK.KL maps to 1155.KL in the table, the scanner and the universe repair', () => {
  assert.equal(map.codes.MAYBANK.code, '1155');
  assert.equal(bursaYahooSymbol('MAYBANK.KL'), '1155.KL');
  const out = verarbeiteZeilen('tv-malaysia', cfg, [row('MAYBANK', 'Malayan Banking Bhd.')], rates, 1, 0);
  assert.deepEqual([...out.keys()], ['1155.KL']);
  assert.equal(out.get('1155.KL').ticker, '1155.KL');
  assert.deepEqual(out.tor.bursa, { mapped: 1, unmapped: [] });
  const stocks = [{ ticker: 'MAYBANK.KL', yahoo_symbol: 'MAYBANK.KL', name: 'Malayan Banking Bhd.' }];
  assert.deepEqual(repariereBursaBestand(stocks), { repaired: 1, unmapped: [] });
  assert.equal(stocks[0].ticker, '1155.KL');
  assert.equal(stocks[0].yahoo_symbol, '1155.KL');
});

test('bursa: absence — non-.KL symbols and numeric codes are untouched', () => {
  for (const t of ['AAPL', '7203.T', 'MAYBANK.SI', '1155.KL', '5235SS.KL', '', null]) {
    assert.equal(bursaYahooSymbol(t), t, String(t));
    assert.equal(isUnmappedBursa(t), false, String(t));
  }
  const stocks = [{ ticker: 'AAPL', yahoo_symbol: 'AAPL' }, { ticker: '1155.KL', yahoo_symbol: '1155.KL' }];
  assert.deepEqual(repariereBursaBestand(stocks), { repaired: 0, unmapped: [] });
  assert.deepEqual(stocks.map((s) => s.ticker), ['AAPL', '1155.KL']);
});

test('bursa: an unmapped .KL trading name is kept as-is and counted, never dropped', () => {
  const out = verarbeiteZeilen('tv-malaysia', cfg, [row('ZZNEWCO', 'New Co Bhd'), row('CIMB', 'CIMB Group')], rates, 2, 0);
  assert.deepEqual([...out.keys()].sort(), ['1023.KL', 'ZZNEWCO.KL']);
  assert.deepEqual(out.tor.bursa, { mapped: 1, unmapped: ['ZZNEWCO.KL'] });
  const stocks = [{ ticker: 'ZZNEWCO.KL', yahoo_symbol: 'ZZNEWCO.KL' }];
  assert.deepEqual(repariereBursaBestand(stocks), { repaired: 0, unmapped: ['ZZNEWCO.KL'] });
  assert.equal(stocks.length, 1);
  assert.equal(stocks[0].ticker, 'ZZNEWCO.KL');
});

test('bursa: other TradingView markets carry no bursa counter', () => {
  const out = verarbeiteZeilen('tv-singapore', MARKETS['tv-singapore'], [{ d: ['D05', 1e11, 'SGD', 'DBS', 'stock', 'common', 'SGX', 'Singapore'] }], { SGD: 0.78 }, 1, 0);
  assert.deepEqual([...out.keys()], ['D05.SI']);
  assert.equal(out.tor.bursa, undefined);
});

test('bursa: table shape — every code is a Bursa code, no two names share one', () => {
  const codes = Object.values(map.codes).map((e) => e.code);
  assert.ok(codes.length >= 103, 'table shrank: ' + codes.length);
  for (const [name, e] of Object.entries(map.codes)) {
    assert.match(e.code, /^[0-9]{4}[A-Z]*$/, name);
    assert.ok(e.name, name + ' has no verified Yahoo name');
  }
  assert.equal(new Set(codes).size, codes.length, 'duplicate code');
});
