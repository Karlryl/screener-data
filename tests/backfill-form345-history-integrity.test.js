'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const backfill = require('../scripts/backfill-form345.js');
const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'backfill-form345.js'), 'utf8');

function loadRaw(raw) {
  return backfill._internals.readHistoryFileOrThrow('history.json', () => raw);
}

function loadValue(value) {
  return loadRaw(JSON.stringify(value));
}

test('production wiring cannot collapse the history cache through readJsonSafe fallback', () => {
  assert.doesNotMatch(source, /readJsonSafe\(HISTORY_CACHE_PATH\)\s*\|\|\s*\{\}/);
  assert.match(source, /const existing = readHistoryFileOrThrow\(HISTORY_CACHE_PATH\);/);
  assert.match(source, /const byTicker = existing\.byTicker;/);

  const mainStart = source.indexOf('async function main()');
  const loadIndex = source.indexOf(
    'const existing = readHistoryFileOrThrow(HISTORY_CACHE_PATH);',
    mainStart,
  );
  const quarterIndex = source.indexOf('for (const { y, q } of quarters)', mainStart);
  const firstWriteIndex = source.indexOf('writeHistory(byTicker);', mainStart);
  assert.ok(mainStart >= 0 && mainStart < loadIndex);
  assert.ok(loadIndex < quarterIndex);
  assert.ok(quarterIndex < firstWriteIndex);
});

test('missing history file remains the only bootstrap case', () => {
  const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
  const loaded = backfill._internals.readHistoryFileOrThrow('history.json', () => { throw missing; });
  assert.deepEqual(loaded, { byTicker: {} });
});

test('existing unreadable history fails instead of becoming an empty cache', () => {
  const denied = Object.assign(new Error('denied'), { code: 'EACCES' });
  assert.throws(
    () => backfill._internals.readHistoryFileOrThrow('history.json', () => { throw denied; }),
    /history\.json.*cannot be read.*EACCES|history\.json.*cannot be read.*denied/,
  );
});

test('existing invalid JSON fails instead of becoming an empty cache', () => {
  assert.throws(() => loadRaw('{"byTicker":'), /history\.json.*cannot be parsed/);
});

for (const [label, value] of [
  ['null', null],
  ['array', []],
  ['string', 'history'],
  ['number', 0],
  ['boolean', false],
]) {
  test(`existing ${label} history root is rejected`, () => {
    assert.throws(() => loadValue(value), /history root must be a non-null, non-array object/);
  });
}

test('a malformed ticker entry between valid entries is still rejected', () => {
  assert.throws(
    () => loadValue({
      byTicker: {
        FIRST: { transactions: [] },
        BROKEN: null,
        LAST: { transactions: [] },
      },
    }),
    /history entry "BROKEN" must be a non-null, non-array object/,
  );
});

for (const [label, value] of [
  ['missing', undefined],
  ['null', null],
  ['array', []],
  ['string', 'tickers'],
  ['number', 0],
  ['boolean', false],
]) {
  test(`history byTicker as ${label} is rejected`, () => {
    const history = value === undefined ? {} : { byTicker: value };
    assert.throws(() => loadValue(history), /history byTicker must be a non-null, non-array object/);
  });
}

for (const [label, value] of [
  ['null', null],
  ['array', []],
  ['string', 'transaction'],
  ['number', 0],
  ['boolean', false],
]) {
  test(`history transaction element as ${label} is rejected even between valid elements`, () => {
    assert.throws(
      () => loadValue({
        byTicker: {
          BROKEN: { transactions: [{ keep: 1 }, value, { keep: 2 }] },
        },
      }),
      /history entry "BROKEN" transaction 1 must be a non-null, non-array object/,
    );
  });
}

for (const [label, value] of [
  ['null', null],
  ['array', []],
  ['string', 'entry'],
  ['number', 0],
  ['boolean', false],
]) {
  test(`history ticker entry as ${label} is rejected`, () => {
    assert.throws(
      () => loadValue({ byTicker: { BROKEN: value } }),
      /history entry "BROKEN" must be a non-null, non-array object/,
    );
  });
}

for (const [label, value] of [
  ['missing', undefined],
  ['null', null],
  ['object', {}],
  ['string', 'transactions'],
  ['number', 0],
  ['boolean', false],
]) {
  test(`history transactions as ${label} is rejected`, () => {
    const entry = value === undefined ? {} : { transactions: value };
    assert.throws(
      () => loadValue({ byTicker: { BROKEN: entry } }),
      /history entry "BROKEN" transactions must be an array/,
    );
  });
}

test('empty byTicker object is valid without inventing a count floor', () => {
  assert.deepEqual(loadValue({ byTicker: {} }), { byTicker: {} });
});

test('valid history preserves unknown root, entry, and transaction fields', () => {
  const history = {
    updatedAt: '2026-09-01T00:00:00.000Z',
    rootExtra: { retained: true },
    byTicker: {
      GOOD: {
        ticker: 'GOOD',
        entryExtra: 'retained',
        transactions: [{ transactionDate: '2026-08-31', transactionExtra: 7 }],
      },
    },
  };
  assert.deepEqual(loadValue(history), history);
});
