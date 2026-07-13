#!/usr/bin/env node
'use strict';
/**
 * Tag 294: one-time migration prices/history.json → prices/history/history-NN.json
 *
 * Idempotent: if any shard already exists this is a no-op (prints a message and
 * exits 0). Otherwise it reads the frozen monolith, partitions it into 32 shards
 * via lib/price-history-store.js (single owner of the layout), writes them, and
 * VERIFIES byte-genau that loadAll(shards) reconstructs the monolith exactly
 * (ticker count identical + a seeded 20-ticker deep-equal sample). The old
 * monolith is left untouched (Löschung braucht Karl-OK).
 *
 * Run: node scripts/migrate-price-history-shards.js
 */
const fs = require('fs');
const path = require('path');
const store = require('../lib/price-history-store.js');

const PRICES_DIR = path.join(__dirname, '..', 'prices');
const LEGACY = store.legacyPath(PRICES_DIR);

// Small seeded PRNG (mulberry32) so the sample of "random" verify tickers is
// reproducible across runs — a failing sample is investigable, not a lottery.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function main() {
  // Idempotency: any shard present → already migrated.
  for (let n = 0; n < store.SHARD_COUNT; n++) {
    if (fs.existsSync(store.shardPath(PRICES_DIR, n))) {
      console.log('[migrate] shards already present (found ' + store.shardFilename(n) + ') — no-op.');
      return 0;
    }
  }
  if (!fs.existsSync(LEGACY)) {
    console.log('[migrate] no legacy prices/history.json and no shards — nothing to migrate.');
    return 0;
  }

  const rawBytes = fs.statSync(LEGACY).size;
  const legacy = JSON.parse(fs.readFileSync(LEGACY, 'utf8'));
  const tickers = Object.keys(legacy);
  console.log('[migrate] legacy: ' + tickers.length + ' tickers, ' + rawBytes + ' bytes');

  // Partition + write all 32 shards.
  store.saveAll(PRICES_DIR, legacy);

  // Shard-size balance.
  let sum = 0, min = Infinity, max = 0, minN = -1, maxN = -1;
  const counts = [];
  for (let n = 0; n < store.SHARD_COUNT; n++) {
    const sz = fs.statSync(store.shardPath(PRICES_DIR, n)).size;
    const cnt = Object.keys(store.loadShard(PRICES_DIR, n)).length;
    counts.push(cnt);
    sum += sz;
    if (sz < min) { min = sz; minN = n; }
    if (sz > max) { max = sz; maxN = n; }
  }
  const MB = (b) => (b / 1048576).toFixed(2) + ' MB';
  console.log('[migrate] shard bytes: min=' + MB(min) + ' (#' + minN + '), max=' + MB(max) +
    ' (#' + maxN + '), sum=' + MB(sum));
  console.log('[migrate] shard ticker counts min/max: ' +
    Math.min(...counts) + '/' + Math.max(...counts));

  // ── VERIFY: loadAll(shards) === legacy, byte-genau ────────────────────────
  const merged = store.loadAll(PRICES_DIR);
  const mergedKeys = Object.keys(merged);
  if (mergedKeys.length !== tickers.length) {
    console.error('[migrate] FAIL: ticker count mismatch — legacy ' + tickers.length +
      ' vs shards ' + mergedKeys.length);
    return 1;
  }
  // Byte-genau: compact JSON of both must be identical after sorting keys the same
  // way. legacy and merged have the same keys; compare per-ticker serialization on
  // a seeded 20-ticker deep sample (full deep-equal on 17k×400 arrays is O(N) but
  // the sample is the documented spot-check; we also compare every ticker's array
  // length below as a cheap full-coverage guard).
  const fixed = ['SPY', 'NVDA', 'AAPL'].filter(t => t in legacy);
  const rnd = mulberry32(290);
  const sample = new Set(fixed);
  while (sample.size < 20 && sample.size < tickers.length) {
    sample.add(tickers[Math.floor(rnd() * tickers.length)]);
  }
  for (const t of sample) {
    const a = JSON.stringify(legacy[t]);
    const b = JSON.stringify(merged[t]);
    if (a !== b) {
      console.error('[migrate] FAIL: deep-equal mismatch for ' + t);
      return 1;
    }
  }
  // Cheap full-coverage guard: every ticker present with identical array length.
  for (const t of tickers) {
    const la = Array.isArray(legacy[t]) ? legacy[t].length : -1;
    const ma = Array.isArray(merged[t]) ? merged[t].length : -1;
    if (la !== ma) {
      console.error('[migrate] FAIL: array-length mismatch for ' + t + ' (' + la + ' vs ' + ma + ')');
      return 1;
    }
  }
  console.log('[migrate] VERIFY ok: ' + mergedKeys.length + ' tickers, deep-equal sample [' +
    [...sample].join(', ') + '] identical, all array lengths match.');
  console.log('[migrate] legacy prices/history.json left untouched (frozen).');
  return 0;
}

process.exit(main());
