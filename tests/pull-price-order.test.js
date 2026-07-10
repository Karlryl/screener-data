'use strict';
// A7-fix (2026-07-10): guard the stale-first pull ordering in pull-historical-prices.js.
// The bug: a 25-min timeout killed the full-universe pull before the single end-of-run
// history.json write, and the loop always restarted at index 0 -> only the head ever
// refreshed. Fix = pull benchmarks first, then oldest/missing-history first, so each
// timeout-bounded run advances the stale frontier. This test pins that ordering.
const test = require('node:test');
const assert = require('node:assert');
const { staleFirstComparator } = require('../pull-historical-prices.js');

test('benchmarks sort before non-benchmarks regardless of history', () => {
  const history = { SPY: [{ date: '2026-07-09', close: 1 }], AAA: [] }; // SPY fresh, AAA missing
  const stocks = [
    { ticker: 'AAA' },
    { ticker: 'SPY', added_via: 'benchmark' },
  ];
  stocks.sort(staleFirstComparator(history));
  assert.strictEqual(stocks[0].ticker, 'SPY', 'benchmark must be pulled first even if fresher');
});

test('among non-benchmarks, oldest/missing history is pulled first', () => {
  const history = {
    FRESH: [{ date: '2026-07-09', close: 1 }],
    STALE: [{ date: '2026-06-01', close: 1 }],
    // MISSING has no history entry at all -> lastDate '' -> sorts first
  };
  const stocks = [
    { ticker: 'FRESH' },
    { ticker: 'STALE' },
    { ticker: 'MISSING' },
  ];
  stocks.sort(staleFirstComparator(history));
  assert.deepStrictEqual(stocks.map(s => s.ticker), ['MISSING', 'STALE', 'FRESH']);
});

test('benchmarks first, then stale-first among the rest', () => {
  const history = { QQQ: [{ date: '2026-07-09', close: 1 }], OLD: [{ date: '2026-01-01', close: 1 }], NEW: [{ date: '2026-07-08', close: 1 }] };
  const stocks = [
    { ticker: 'NEW' },
    { ticker: 'OLD' },
    { ticker: 'QQQ', added_via: 'benchmark' },
  ];
  stocks.sort(staleFirstComparator(history));
  assert.deepStrictEqual(stocks.map(s => s.ticker), ['QQQ', 'OLD', 'NEW']);
});
