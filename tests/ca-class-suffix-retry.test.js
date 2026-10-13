'use strict';
/**
 * TSX/TSXV class/unit retry (W7 night run 2026-09-26, cause 3).
 * The TMX listing gives only the root, so "BIP.TO" is stored where Yahoo lists
 * "BIP-UN.TO". pull-yahoo.js resolves a failing bare .TO/.V symbol with one batch
 * quote over -UN/-B/-A/-X/-U (same issuer name required), picks the line Yahoo
 * reports a marketCap for, then the highest 3-month traded value.
 * Executes the exported resolver and the catch-block step caClassRetryStock with
 * a fake quote function (no network).
 * Run standalone: node tests/ca-class-suffix-retry.test.js
 */
const assert = require('node:assert/strict');
const {
  resolveCaClassSymbol, pickCaClassLine, caClassCandidates, caClassRetryStock,
  _silentErrorCounts, _resetSilentErrorCounts,
} = require('../pull-yahoo.js');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}
const q = (symbol, price, vol, longName = 'Brookfield Infrastructure Partners L.P.', marketCap = 1e9) =>
  ({ symbol, regularMarketPrice: price, averageDailyVolume3Month: vol, longName, marketCap });
// Fake Yahoo: returns only the symbols it "knows", records what was asked.
function fakeYahoo(known) {
  const calls = [];
  const fn = async syms => { calls.push(syms); return known.filter(k => syms.includes(k.symbol)); };
  return { fn, calls };
}
const BIP = { ticker: 'BIP.TO', yahoo_symbol: 'BIP.TO', name: 'Brookfield Infrastructure Partners L.P.' };

(async () => {
  await test('presence: a BIP-like bare root that fails resolves to its -UN line', async () => {
    const y = fakeYahoo([q('BIP-UN.TO', 40, 500000)]);
    assert.equal(await resolveCaClassSymbol(BIP, 'not-found', y.fn), 'BIP-UN.TO');
    assert.deepEqual(y.calls, [['BIP.TO', 'BIP-UN.TO', 'BIP-B.TO', 'BIP-A.TO', 'BIP-X.TO', 'BIP-U.TO']]);
  });

  await test('presence: schema-fail on a TSXV bare root also resolves (.V keeps its venue)', async () => {
    const y = fakeYahoo([q('ABC-A.V', 1, 1000, 'ABC Mining Corp.')]);
    assert.equal(await resolveCaClassSymbol({ ticker: 'ABC.V', yahoo_symbol: 'ABC.V', name: 'Abc Mining Corp' }, 'schema-fail', y.fn), 'ABC-A.V');
  });

  await test('wiring step: caClassRetryStock returns the retry row (same ticker, resolved symbol, loop stop) and counts it', async () => {
    _resetSilentErrorCounts();
    const y = fakeYahoo([q('BIP-UN.TO', 40, 500000)]);
    const row = await caClassRetryStock(BIP, 'not-found', y.fn);
    assert.equal(row.ticker, 'BIP.TO', 'snapshot file stays keyed by the watchlist ticker');
    assert.equal(row.yahoo_symbol, 'BIP-UN.TO');
    assert.equal(row._caRetried, true);
    assert.equal(BIP.yahoo_symbol, 'BIP.TO', 'shared watchlist row must not be mutated');
    assert.equal(_silentErrorCounts().symbolsNormalized, 1);
    assert.equal(await caClassRetryStock(row, 'not-found', y.fn), null, 'a resolved row is never probed again');
    _resetSilentErrorCounts();
  });

  await test('wiring step: a probe that throws is reported as probeFailed (never a not-found verdict)', async () => {
    const r = await caClassRetryStock(BIP, 'not-found', async () => { throw new Error('ETIMEDOUT'); });
    assert.deepEqual(r, { probeFailed: true });
  });

  await test('class choice: two classes -> the one with the higher 3M traded value (TECK-B over TECK-A)', async () => {
    const teck = n => q(n, 60, n === 'TECK-B.TO' ? 3000000 : 2000, 'Teck Resources Limited');
    const y = fakeYahoo([teck('TECK-A.TO'), teck('TECK-B.TO')]);
    assert.equal(await resolveCaClassSymbol({ ticker: 'TECK.TO', yahoo_symbol: 'TECK.TO', name: 'Teck Resources Ltd.' }, 'not-found', y.fn), 'TECK-B.TO');
  });

  await test('class choice: a line with a Yahoo marketCap beats a busier line without one (HOT-UN over HOT-U)', () => {
    assert.equal(pickCaClassLine('HOT.TO', [
      q('HOT-UN.TO', 1, 36000, 'American Hotel Income Properties REIT LP', 40687376),
      q('HOT-U.TO', 1, 43000, 'American Hotel Income Properties REIT LP', 0),
    ], 'American Hotel Income Properties REIT LP'), 'HOT-UN.TO');
  });

  await test('class choice: equal traded value -> fixed order UN, B, A, X, U', () => {
    assert.equal(pickCaClassLine('XYZ.TO', [q('XYZ-A.TO', 10, 100), q('XYZ-B.TO', 10, 100)]), 'XYZ-B.TO');
    assert.deepEqual(caClassCandidates('xyz.to'), ['XYZ-UN.TO', 'XYZ-B.TO', 'XYZ-A.TO', 'XYZ-X.TO', 'XYZ-U.TO']);
  });

  await test('absence: a variant of a different issuer (reused root) is rejected', async () => {
    const y = fakeYahoo([q('BIP-UN.TO', 40, 500000, 'Bipolar Gold Corp.')]);
    assert.equal(await resolveCaClassSymbol(BIP, 'not-found', y.fn), null);
  });

  await test('absence: a working bare symbol is never swapped (it quotes itself)', async () => {
    const y = fakeYahoo([q('RY.TO', 150, 5000000, 'Royal Bank of Canada'), q('RY-UN.TO', 1, 10, 'Royal Bank of Canada')]);
    assert.equal(await resolveCaClassSymbol({ ticker: 'RY.TO', yahoo_symbol: 'RY.TO', name: 'Royal Bank of Canada' }, 'schema-fail', y.fn), null);
  });

  await test('absence: non-Canadian, already-suffixed, retried or transient errors -> no probe at all', async () => {
    const y = fakeYahoo([q('BIP-UN.TO', 40, 500000)]);
    for (const [stock, errClass] of [
      [{ ticker: 'AAPL', yahoo_symbol: 'AAPL' }, 'not-found'],
      [{ ticker: '005930.KS', yahoo_symbol: '005930.KS' }, 'not-found'],
      [{ ticker: 'MAYBANK.KL', yahoo_symbol: 'MAYBANK.KL' }, 'not-found'],
      [{ ticker: 'BBD-B.TO', yahoo_symbol: 'BBD-B.TO' }, 'not-found'],
      [Object.assign({}, BIP, { _caRetried: true }), 'not-found'],
      [BIP, 'rate-limit'],
      [BIP, 'timeout'],
      [BIP, 'auth'],
    ]) {
      assert.equal(await resolveCaClassSymbol(stock, errClass, y.fn), null, stock.yahoo_symbol + ' ' + errClass);
      assert.equal(await caClassRetryStock(stock, errClass, y.fn), null, stock.yahoo_symbol + ' ' + errClass);
    }
    assert.equal(y.calls.length, 0, 'no Yahoo request may be spent on a non-candidate');
  });

  await test('absence: no variant quotes (preferred-only issuer) -> null, original symbol stays', async () => {
    const y = fakeYahoo([q('BPO-PR-A.TO', 20, 1000, 'Brookfield Office Properties Inc.')]);
    assert.equal(await caClassRetryStock({ ticker: 'BPO.TO', yahoo_symbol: 'BPO.TO', name: 'Brookfield Office Properties Inc.' }, 'not-found', y.fn), null);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
