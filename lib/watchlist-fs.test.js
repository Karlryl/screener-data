'use strict';
/**
 * Bug 26 regression: keyed-map (bare-object) shape must synthesize a stocks
 * array from ONLY the ticker-like keys, not from metadata keys like updatedAt.
 * Run standalone: node --test lib/watchlist-fs.test.js
 */
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { loadWatchlist, extractStocksArray, detectShape } = require('./watchlist-fs.js');

function cleanupFixture(dir) {
  const target = path.resolve(dir);
  assert.equal(path.dirname(target), path.resolve(os.tmpdir()), 'cleanup stays in OS temp');
  assert.equal(path.basename(target).startsWith('watchlist-load-'), true, 'cleanup owns this fixture');
  fs.rmSync(target, { recursive: true, force: true });
}

test('bare-object shape ignores metadata keys', () => {
  const raw = {
    AAPL: { note: 'x' },
    MSFT: { note: 'y' },
    NVDA: { note: 'z' },
    updatedAt: '2026-07-03',
    note: 'universe snapshot',
  };
  assert.equal(detectShape(raw), 'object');
  const stocks = extractStocksArray(raw);
  // 3 ticker keys -> 3 synthetic stocks (was 5, incl. {ticker:'updatedAt'})
  assert.equal(stocks.length, 3);
  const tickers = stocks.map(s => s.ticker).sort();
  assert.deepEqual(tickers, ['AAPL', 'MSFT', 'NVDA']);
  // metadata string values must NOT be spread into char-indexed props
  assert.ok(!stocks.some(s => s.ticker === 'updatedAt'));
});

test('loadWatchlist reads wrapped and legacy array files with their exact ticker lists', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watchlist-load-valid-'));
  t.after(() => cleanupFixture(dir));
  const stocks = [{ ticker: 'AAPL', note: 'fixture' }, { ticker: 'MSFT' }];
  const wrapped = { _meta: { fixture: true }, stocks };
  const wrappedPath = path.join(dir, 'wrapped.json');
  fs.writeFileSync(wrappedPath, JSON.stringify(wrapped));
  const loaded = loadWatchlist(wrappedPath);
  assert.deepEqual(loaded.stocks.map(stock => stock.ticker), ['AAPL', 'MSFT']);
  assert.deepEqual(loaded, { shape: 'wrapped', stocks, size: 2, raw: wrapped, error: null });

  const arrayPath = path.join(dir, 'array.json');
  fs.writeFileSync(arrayPath, JSON.stringify(stocks));
  assert.deepEqual(loadWatchlist(arrayPath),
    { shape: 'array', stocks, size: 2, raw: stocks, error: null });
});

test('loadWatchlist returns its invalid sentinel for corrupt JSON and missing files', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watchlist-load-invalid-'));
  t.after(() => cleanupFixture(dir));
  const brokenPath = path.join(dir, 'broken.json');
  fs.writeFileSync(brokenPath, '{ invalid JSON');
  const broken = loadWatchlist(brokenPath);
  assert.match(broken.error, /JSON|Unexpected/i);
  assert.deepEqual(broken,
    { shape: 'invalid', stocks: [], size: 0, raw: null, error: broken.error });

  const missingPath = path.join(dir, 'missing.json');
  assert.deepEqual(loadWatchlist(missingPath), {
    shape: 'invalid', stocks: [], size: 0, raw: null,
    error: 'file not found: ' + missingPath,
  });
});
