'use strict';
/**
 * X1 (Tag 348, screener-data): scripts/backfill-prices.js must read/write the
 * SHARDED price store (lib/price-history-store.js), not the legacy
 * prices/history.json monolith. Since the Tag-294 shard migration,
 * store.loadAll() ignores history.json once any shard exists — a backfill
 * that still read/wrote the monolith directly was a silent no-op: every
 * migrated consumer (pull-historical-prices.js, update-ath-state.js,
 * rank-ic.js, …) reads the shards, never the monolith.
 *
 * Standalone-Runner (node <datei>, exit 0/1 — same style as
 * tests/price-history-store.test.js).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../lib/price-history-store.js');
const backfill = require('../scripts/backfill-prices.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e.stack || e.message)); }
}
function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'backfill-x1-'));
}

test('loadHistory reads via the shard store, ignoring a stale legacy monolith', () => {
  const dir = tmpDir();
  // Migrated store: shards exist. A STALE prices/history.json sits alongside
  // them (frozen at migration time) — price-history-store.js:122-124 says
  // loadAll() must ignore it once any shard exists.
  store.saveAll(dir, { AAA: [{ date: '2026-01-01', close: 10 }] });
  fs.writeFileSync(store.legacyPath(dir), JSON.stringify({ AAA: [{ date: '1999-01-01', close: 0.01 }] }));

  const history = backfill.loadHistory(dir);
  assert.deepEqual(history.AAA, [{ date: '2026-01-01', close: 10 }],
    'must read the shard value, not the stale legacy monolith');
});

test('saveHistory writes ONLY the dirty shard via store.saveDirty, never prices/history.json', () => {
  const dir = tmpDir();
  store.saveAll(dir, { AAA: [{ date: '2026-01-01', close: 10 }] });
  const history = backfill.loadHistory(dir);
  history.BBB = [{ date: '2026-01-02', close: 20 }]; // simulate a freshly-fetched ticker

  backfill.saveHistory(dir, history, new Set(['BBB']));

  assert.ok(!fs.existsSync(store.legacyPath(dir)),
    'a migrated backfill run must never (re)create the legacy monolith — nobody reads it');
  const reread = store.loadAll(dir);
  assert.deepEqual(reread.BBB, [{ date: '2026-01-02', close: 20 }],
    'new ticker must be visible to every migrated consumer via store.loadAll — this is the X1 bug: ' +
    'before the fix a direct history.json write was invisible here');
  assert.deepEqual(reread.AAA, [{ date: '2026-01-01', close: 10 }],
    'untouched ticker must survive a dirty-only write');
});

test('saveHistory is a no-op (no shard write) when nothing changed', () => {
  const dir = tmpDir();
  store.saveAll(dir, { AAA: [{ date: '2026-01-01', close: 10 }] });
  const before = fs.statSync(store.shardPath(dir, store.shardOf('AAA'))).mtimeMs;
  const spin = Date.now() + 15; while (Date.now() < spin) { /* mtime/clock delta */ }
  const written = backfill.saveHistory(dir, backfill.loadHistory(dir), new Set());
  assert.deepEqual(written, [], 'empty dirty set writes nothing');
  const after = fs.statSync(store.shardPath(dir, store.shardOf('AAA'))).mtimeMs;
  assert.equal(after, before, 'shard must be untouched');
});

console.log('\nbackfill-prices: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
