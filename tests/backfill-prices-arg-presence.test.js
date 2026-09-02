'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'backfill-prices.js');
const backfill = require(SCRIPT);

function argv(...args) {
  return ['node', 'backfill-prices.js', ...args];
}

function rejectsFlag(flag, args) {
  assert.throws(
    () => backfill.parseArgs(argv(...args)),
    (error) => error instanceof Error && error.message.includes(flag) && /require/i.test(error.message),
  );
}

test('exports the pure argument parser', () => {
  assert.equal(typeof backfill.parseArgs, 'function');
});

test('parses arguments before ticker-file, store, Yahoo, or sleep work', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  const start = source.indexOf('async function main() {');
  const end = source.indexOf('\n}\n\n// X1: guard', start);
  assert.ok(start >= 0 && end > start, 'main() source seam must remain identifiable');
  const body = source.slice(start, end);
  const parseAt = body.indexOf('parseArgs(process.argv)');
  assert.ok(parseAt >= 0, 'main() must call parseArgs(process.argv)');
  for (const call of [
    'loadTickerFile(args.tickerFile)',
    'loadHistory(pricesDir)',
    'fetchAndMergeSeries(yahooSymbol, history[ticker])',
    'sleep(SLEEP)',
  ]) {
    const callAt = body.indexOf(call);
    assert.ok(callAt > parseAt, call + ' must remain after argument validation');
  }
});

test('omitted source flags retain the existing empty defaults', () => {
  assert.deepEqual(backfill.parseArgs(argv()), { tickers: [], tickerFile: null });
});

test('ticker lists retain trimming and empty comma-field filtering', () => {
  assert.deepEqual(
    backfill.parseArgs(argv('--tickers', ' AAA, ,BBB,, ')).tickers,
    ['AAA', 'BBB'],
  );
});

test('ticker duplicates, order, and punctuation remain untouched', () => {
  assert.deepEqual(
    backfill.parseArgs(argv('--tickers', 'BRK-B,^GSPC,000001.SZ,CONIN$,BTC-USD,BRK-B')).tickers,
    ['BRK-B', '^GSPC', '000001.SZ', 'CONIN$', 'BTC-USD', 'BRK-B'],
  );
});

test('ticker-file paths are returned byte-for-byte, including spaces', () => {
  const file = [' C:', 'Market Data', 'ticker list.json '].join(String.fromCharCode(92));
  assert.equal(backfill.parseArgs(argv('--ticker-file', file)).tickerFile, file);
  assert.equal(backfill.parseArgs(argv('--ticker-file', '--symbols.json')).tickerFile, '--symbols.json');
});

test('combines ticker and file sources in the documented order', () => {
  assert.deepEqual(
    backfill.parseArgs(argv('--tickers', 'AAA,BBB', '--ticker-file', 'tickers.json')),
    { tickers: ['AAA', 'BBB'], tickerFile: 'tickers.json' },
  );
});

test('combines file and ticker sources in reverse order', () => {
  assert.deepEqual(
    backfill.parseArgs(argv('--ticker-file', 'tickers.json', '--tickers', 'AAA')),
    { tickers: ['AAA'], tickerFile: 'tickers.json' },
  );
});

test('unknown options retain their existing ignored behavior', () => {
  assert.deepEqual(
    backfill.parseArgs(argv('--unknown', 'value', '--tickers', 'AAA', '--other')),
    { tickers: ['AAA'], tickerFile: null },
  );
});

test('repeated recognized flags retain last-value-wins behavior', () => {
  assert.deepEqual(
    backfill.parseArgs(argv(
      '--tickers', 'OLD', '--ticker-file', 'old.json',
      '--tickers', 'NEW,NEW2', '--ticker-file', 'new.json',
    )),
    { tickers: ['NEW', 'NEW2'], tickerFile: 'new.json' },
  );
});

test('rejects a trailing --ticker-file after valid explicit tickers', () => {
  rejectsFlag('--ticker-file', ['--tickers', 'AAA', '--ticker-file']);
});

test('rejects a trailing --tickers after a valid ticker file', () => {
  rejectsFlag('--tickers', ['--ticker-file', 'tickers.json', '--tickers']);
});

test('rejects an empty --ticker-file value', () => {
  rejectsFlag('--ticker-file', ['--ticker-file', '']);
});

test('rejects a whitespace-only --ticker-file value', () => {
  rejectsFlag('--ticker-file', ['--ticker-file', '   ']);
});

test('rejects an empty --tickers value', () => {
  rejectsFlag('--tickers', ['--tickers', '']);
});

test('rejects a ticker list containing only empty comma fields', () => {
  rejectsFlag('--tickers', ['--tickers', ' , , ']);
});

test('does not consume --tickers as the value of --ticker-file', () => {
  rejectsFlag('--ticker-file', ['--ticker-file', '--tickers', 'AAA']);
});

test('does not consume --ticker-file as the value of --tickers', () => {
  rejectsFlag('--tickers', ['--tickers', '--ticker-file', 'C:\\Market Data\\tickers.json']);
});
