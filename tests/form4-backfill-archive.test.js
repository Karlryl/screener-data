'use strict';
// One-time form4 backfill (30.10.2026, see docs/form4-backfill-pre-archive.md): rows that left the
// cache before the archive existed. The file is frozen; the daily writers only touch <YYYY-MM>.json.gz.
// Run standalone: node tests/form4-backfill-archive.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const A = require('../lib/form4-cache-archive.js');
const { txnKey } = require('../scripts/pull-insider-form4-daily.js')._internals;

const DIR = path.join(__dirname, '..', 'external-data', 'archive', 'sec-form4');
const BACKFILL = path.join(DIR, 'backfill-pre-archive.json.gz');
const SHA256 = '6bc941ad2182deead6d8b1be111f8af233dbc66ccbdddb1ff932331b88dc1910';
const ROWS = 970;                 // row keys (ticker + txnKey): in a commit, not in cache or archive on 30.10.
const REASONS = {
  'backfill-expired': 288,
  'backfill-expired-or-replaced': 1,
  'backfill-replaced-same-transaction': 189,
  'backfill-purged-no-matching-transaction': 482,
  'backfill-ticker-moved': 10,
};

test('backfill: the one-time file is frozen', () => {
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(BACKFILL)).digest('hex'), SHA256,
    'the one-time backfill file must never change (G24)');
});

test('backfill: readable, row count and reasons pinned', () => {
  const lines = A.readArchive(BACKFILL);
  assert.equal(lines.length, ROWS);
  const tally = {};
  for (const l of lines) tally[l.reason] = (tally[l.reason] || 0) + 1;
  assert.deepEqual(tally, REASONS);
});

test('backfill: every row carries filingDate (T7) and its source commits', () => {
  for (const l of A.readArchive(BACKFILL)) {
    const id = l.ticker + ' ' + (l.row && l.row.accessionNumber);
    assert.match(String(l.row && l.row.filingDate), /^\d{4}-\d{2}-\d{2}$/, 'filingDate missing: ' + id);
    assert.ok(l.row.accessionNumber, 'accessionNumber missing: ' + id);
    assert.match(String(l.source && l.source.lastSeenCommit), /^[0-9a-f]{40}$/, 'lastSeenCommit missing: ' + id);
    assert.match(String(l.source && l.source.firstMissingCommit), /^[0-9a-f]{40}$/, 'firstMissingCommit missing: ' + id);
  }
});

const noSymbol = (r) => { const c = Object.assign({}, r); delete c.issuerTradingSymbol; return A.canon(c); };

test('backfill: no key twice, and no row that the monthly archive already held with other content', () => {
  const lines = A.readArchive(BACKFILL);
  const keys = new Set();
  const byTxn = new Map();
  for (const l of lines) {
    const k = l.ticker + '\u0000' + txnKey(l.row);
    assert.ok(!keys.has(k), 'key twice in the backfill: ' + k);
    keys.add(k);
    byTxn.set(txnKey(l.row), l);
  }
  const builtAt = lines[0].archivedAt;
  // ponytail: only archive lines up to the build time. A later re-pull may legitimately bring such a
  // key back and archive it again; that must not turn every PR check red.
  const months = fs.readdirSync(DIR).filter(f => /^\d{4}-\d{2}\.json\.gz$/.test(f));
  assert.ok(months.includes('2026-10.json.gz'), 'the monthly archive of the build month is missing');
  for (const f of months) {
    for (const l of A.readArchive(path.join(DIR, f))) {
      if (l.archivedAt > builtAt) continue;
      const k = l.ticker + '\u0000' + txnKey(l.row);
      assert.ok(!keys.has(k), f + ' already holds ' + k);
      // The same transaction under another ticker is only allowed as a ticker move with equal content.
      const other = byTxn.get(txnKey(l.row));
      if (!other) continue;
      assert.equal(other.reason, 'backfill-ticker-moved', f + ' holds this transaction under ' + l.ticker);
      assert.equal(noSymbol(other.row), noSymbol(l.row), f + ' holds other content under ' + l.ticker);
    }
  }
});

test('serializeCache: a row that does not survive the compact round trip throws, nothing is written', () => {
  const row = { accessionNumber: 'A-1', filingDate: '2026-10-01', _c: 'x' };
  assert.throws(() => A.serializeCache({ byTicker: { AAA: { transactions: [row] } } }),
    /compact round trip differs for AAA A-1/);
});
