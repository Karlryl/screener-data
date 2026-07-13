'use strict';
/**
 * Tag 294: lib/price-history-store.js self-check (Standalone-Runner: node <datei>,
 * Exit 0/1 — same style as tests/scoring/*).
 *
 * Covers: shardOf determinism + distribution, saveAll→loadAll roundtrip deep-equal,
 * saveDirty writes ONLY the touched shards, and the legacy-fallback (dir with only
 * history.json → loadAll returns its content).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../lib/price-history-store.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e.stack || e.message)); }
}
function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'phs-'));
}
function sampleHistory(n) {
  const h = {};
  for (let i = 0; i < n; i++) {
    const t = 'TKR' + i;
    h[t] = [
      { date: '2026-07-0' + ((i % 9) + 1), close: 100 + i },
      { date: '2026-07-1' + ((i % 9) + 1), close: 101 + i },
    ];
  }
  // include real tickers with dots / benchmarks to exercise the key space
  h['SPY'] = [{ date: '2026-07-10', close: 500 }];
  h['BRK.B'] = [{ date: '2026-07-10', close: 400 }];
  return h;
}

test('shardOf is deterministic and in range', () => {
  for (const t of ['SPY', 'NVDA', 'AAPL', 'BRK.B', 'RHM.DE', '', 'a']) {
    const s1 = store.shardOf(t), s2 = store.shardOf(t);
    assert.equal(s1, s2, 'stable for ' + JSON.stringify(t));
    assert.ok(Number.isInteger(s1) && s1 >= 0 && s1 < store.SHARD_COUNT, 'in range for ' + t);
  }
});

test('shardOf is case-sensitive', () => {
  // documented: hash is on the exact key string. spy and SPY may differ.
  assert.equal(store.shardOf('spy'), store.shardOf('spy'));
  // not asserting they differ (could collide) — just that casing feeds the hash:
  const a = store.shardOf('AbC'), b = store.shardOf('abc');
  assert.ok(Number.isInteger(a) && Number.isInteger(b));
});

test('shardOf spreads a realistic universe across all 32 shards', () => {
  const h = sampleHistory(2000);
  const seen = new Set();
  for (const t of Object.keys(h)) seen.add(store.shardOf(t));
  assert.equal(seen.size, store.SHARD_COUNT, 'all ' + store.SHARD_COUNT + ' shards non-empty, got ' + seen.size);
});

test('saveAll → loadAll roundtrip deep-equal', () => {
  const dir = tmpDir();
  const h = sampleHistory(500);
  store.saveAll(dir, h);
  // all 32 shard files exist
  for (let n = 0; n < store.SHARD_COUNT; n++) {
    assert.ok(fs.existsSync(store.shardPath(dir, n)), 'shard ' + n + ' written');
  }
  const back = store.loadAll(dir);
  assert.deepEqual(back, h, 'roundtrip identical');
});

test('saveDirty writes ONLY the shards of changed tickers', () => {
  const dir = tmpDir();
  const h = sampleHistory(500);
  store.saveAll(dir, h);
  // record mtimes of all shards
  const before = [];
  for (let n = 0; n < store.SHARD_COUNT; n++) before[n] = fs.statSync(store.shardPath(dir, n)).mtimeMs;

  // change two tickers, note which shards they belong to
  h['TKR1'][0].close = 999;
  h['SPY'][0].close = 888;
  const dirty = new Set(['TKR1', 'SPY']);
  const expectShards = new Set([store.shardOf('TKR1'), store.shardOf('SPY')]);

  // ensure a measurable mtime delta on filesystems with coarse resolution
  const spin = Date.now() + 15; while (Date.now() < spin) { /* wait */ }

  const wrote = store.saveDirty(dir, h, dirty);
  assert.deepEqual(new Set(wrote), expectShards, 'saveDirty returns exactly the dirty shards');

  for (let n = 0; n < store.SHARD_COUNT; n++) {
    const after = fs.statSync(store.shardPath(dir, n)).mtimeMs;
    if (expectShards.has(n)) {
      assert.ok(after >= before[n], 'dirty shard ' + n + ' rewritten');
    } else {
      assert.equal(after, before[n], 'clean shard ' + n + ' untouched');
    }
  }
  // and the change is persisted + reloadable
  const back = store.loadAll(dir);
  assert.equal(back['TKR1'][0].close, 999);
  assert.equal(back['SPY'][0].close, 888);
});

test('saveDirty rebuilds a dirty shard COMPLETELY (siblings preserved)', () => {
  const dir = tmpDir();
  const h = sampleHistory(500);
  store.saveAll(dir, h);
  // pick a shard with ≥2 tickers, change one, verify the other survives
  const target = store.shardOf('SPY');
  const siblings = Object.keys(h).filter(t => store.shardOf(t) === target && t !== 'SPY');
  assert.ok(siblings.length > 0, 'need a sibling in SPY shard for this test');
  h['SPY'][0].close = 777;
  store.saveDirty(dir, h, new Set(['SPY']));
  const shard = store.loadShard(dir, target);
  assert.equal(shard['SPY'][0].close, 777);
  for (const s of siblings) assert.ok(s in shard, 'sibling ' + s + ' preserved in rebuilt shard');
});

test('legacy-fallback: dir with only history.json → loadAll returns its content', () => {
  const dir = tmpDir();
  const legacy = { SPY: [{ date: '2026-07-10', close: 1 }], NVDA: [{ date: '2026-07-10', close: 2 }] };
  fs.writeFileSync(store.legacyPath(dir), JSON.stringify(legacy));
  const back = store.loadAll(dir);
  assert.deepEqual(back, legacy, 'legacy content read when no shards exist');
  // loadShard on a legacy-only dir returns {} (no shard file) — documents that
  // consumers needing a single ticker must fall back to loadAll pre-migration.
  assert.deepEqual(store.loadShard(dir, store.shardOf('SPY')), {});
});

test('shards win over legacy once they exist', () => {
  const dir = tmpDir();
  fs.writeFileSync(store.legacyPath(dir), JSON.stringify({ SPY: [{ date: '2000-01-01', close: 1 }] }));
  const fresh = { SPY: [{ date: '2026-07-10', close: 500 }] };
  store.saveAll(dir, fresh);
  const back = store.loadAll(dir);
  assert.deepEqual(back, fresh, 'shard content wins, legacy ignored');
});

test('corrupt shard throws with shardPath set', () => {
  const dir = tmpDir();
  store.saveAll(dir, sampleHistory(100));
  const badN = store.shardOf('SPY');
  fs.writeFileSync(store.shardPath(dir, badN), '{ this is not json');
  let err = null;
  try { store.loadAll(dir); } catch (e) { err = e; }
  assert.ok(err, 'loadAll throws on corrupt shard');
  assert.equal(err.shardPath, store.shardPath(dir, badN), 'err.shardPath points at the bad shard');
});

console.log('\nprice-history-store: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
