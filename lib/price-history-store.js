'use strict';
/**
 * Tag 294: price-history-store — single source of truth for the on-disk layout
 * of the kumulative price history ({ ticker: [{date, close}, ...] }).
 *
 * ROOT CAUSE (CI run 29141088525, 2026-07-11): since Tag 289 (resumable
 * oldest-first pull with checkpoint writes) prices/history.json is written for
 * real again and grows structurally past GitHub's 100 MB push limit
 * (Vollausbau ~17-24k Ticker × 400 Tage ≈ 200-285 MB). The merge job's `git push`
 * is rejected ("File prices/history.json is 132.74 MB") → merge red → scoring
 * skipped → boards freeze. Every subsequent run fails identically.
 *
 * FIX (Muster wie Tag-280 17-Shard-Fundamentals-Pull): partition the store into
 * SHARD_COUNT files under prices/history/. Each shard stays well under 100 MB
 * (32 shards → ~6-9 MB each at full build), so a push never exceeds the limit.
 *
 * The shard assignment (djb2 % SHARD_COUNT) is STABLE and case-sensitive on the
 * exact ticker string as it appears as a KEY in history.json — changing it would
 * re-partition the whole store, so it is frozen here as the single owner.
 *
 * Usage:
 *   const store = require('./lib/price-history-store.js'); // or '../lib/...'
 *   const history = store.loadAll(pricesDir);              // merged { ticker: [...] }
 *   store.saveDirty(pricesDir, history, dirtyTickerSet);   // checkpoint: only touched shards
 *   store.saveAll(pricesDir, history);                     // final: all 32 shards
 *   const spySeries = store.loadShard(pricesDir, store.shardOf('SPY'))['SPY'];
 */
const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('./atomic-write.js');

const SHARD_COUNT = 32;
const HISTORY_DIRNAME = 'history';
const LEGACY_FILENAME = 'history.json';
const META_FILENAME = '_meta.json';

// djb2 (Bernstein) string hash. Deterministic, cheap, well-spread for short
// ticker strings. `>>> 0` after each step keeps the accumulator an unsigned
// 32-bit int so the result is stable across platforms (a signed overflow would
// otherwise flip the sign and change `% SHARD_COUNT`). Case-sensitive by design:
// the caller hashes the exact key string used in history.json.
function _djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0; // h*33 + c, unsigned 32-bit
  }
  return h >>> 0;
}

// Map a ticker string to its shard index 0..SHARD_COUNT-1.
function shardOf(ticker) {
  return _djb2(String(ticker)) % SHARD_COUNT;
}

// Two-digit zero-padded shard filename: history-00.json .. history-31.json.
function shardFilename(n) {
  return 'history-' + String(n).padStart(2, '0') + '.json';
}

function shardPath(dir, n) {
  return path.join(dir, HISTORY_DIRNAME, shardFilename(n));
}

function legacyPath(dir) {
  return path.join(dir, LEGACY_FILENAME);
}

function metaPath(dir) {
  return path.join(dir, HISTORY_DIRNAME, META_FILENAME);
}

// A7-b (2.3-Vorbedingung): every successful store write stamps _meta.json.
// The A7 failure mode was "pull step reports success but the store file is
// never written" (25-min timeout kill before the single end-of-loop write,
// masked by continue-on-error). The stamp is written ONLY by saveAll/saveDirty,
// so its age proves the store was actually persisted — the heartbeat (0.7
// channel) alarms when it goes stale.
function _stampMeta(dir, merged, shardsWritten) {
  writeJsonAtomic(metaPath(dir), {
    schema: 'price-history-store/1',
    updatedAt: new Date().toISOString(),
    tickerCount: Object.keys(merged).length,
    shardsWritten,
  }, { indent: 0 });
}

// Read the freshness stamp. Missing/corrupt → null (caller decides bootstrap vs alarm).
function loadMeta(dir) {
  try {
    return JSON.parse(fs.readFileSync(metaPath(dir), 'utf8'));
  } catch (_) {
    return null;
  }
}

function _anyShardExists(dir) {
  for (let n = 0; n < SHARD_COUNT; n++) {
    if (fs.existsSync(shardPath(dir, n))) return true;
  }
  return false;
}

// Load one shard as { ticker: [{date, close}, ...] }. Missing shard → {}.
// A corrupt shard throws (fail-loud) with `err.shardPath` set so the caller can
// back it up / honour RESET_HISTORY per shard — mirrors the monolith's guard.
function loadShard(dir, n) {
  const p = shardPath(dir, n);
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    e.shardPath = p; // audit/fix: label which shard failed so caller backs up the right file
    throw e;
  }
}

// Merge all shards into one { ticker: [...] } object.
// Legacy-Fallback: if NO shards exist but prices/history.json does, read that
// (read-only) — the migration reads the old monolith on the first run and this
// keeps consumers working in that window. Once any shard exists the legacy file
// is ignored (frozen on its last stand).
function loadAll(dir) {
  if (!_anyShardExists(dir)) {
    const lp = legacyPath(dir);
    if (fs.existsSync(lp)) {
      try {
        return JSON.parse(fs.readFileSync(lp, 'utf8'));
      } catch (e) {
        e.shardPath = lp; // legacy monolith is corrupt — caller backs it up
        throw e;
      }
    }
    return {};
  }
  // BH-139: once _meta.json is stamped, saveAll has run at least once and wrote
  // ALL SHARD_COUNT files (empty ones included — see saveAll comment). A shard
  // missing at that point is not "no tickers there", it's a partial checkout/sync
  // (e.g. OneDrive) — loadAll used to merge it in as {} and silently drop every
  // ticker in that shard. Fail loud instead so a truncated store never masquerades
  // as a complete one (mirrors the corrupt-shard throw right below).
  const meta = loadMeta(dir);
  if (meta) {
    const missing = [];
    for (let n = 0; n < SHARD_COUNT; n++) {
      if (!fs.existsSync(shardPath(dir, n))) missing.push(shardFilename(n));
    }
    if (missing.length > 0) {
      const err = new Error('price-history-store: _meta.json present but ' + missing.length +
        ' shard(s) missing (' + missing.join(', ') + ') — partial store, refusing to load');
      err.missingShards = missing;
      throw err;
    }
  }
  const merged = {};
  for (let n = 0; n < SHARD_COUNT; n++) {
    const shard = loadShard(dir, n); // propagates corrupt-shard throw with shardPath
    for (const t of Object.keys(shard)) merged[t] = shard[t];
  }
  return merged;
}

// Atomic write of one shard (compact JSON — read by scripts, not humans; the
// monolith was compact too for size). assertFinite catches a NaN/Infinity close
// that JSON.stringify would silently persist as null and poison forward returns.
function saveShard(dir, n, obj) {
  const shardDir = path.join(dir, HISTORY_DIRNAME);
  if (!fs.existsSync(shardDir)) fs.mkdirSync(shardDir, { recursive: true });
  writeJsonAtomic(shardPath(dir, n), obj, { indent: 0, assertFinite: true });
}

// Partition a merged { ticker: [...] } into SHARD_COUNT plain objects.
function _partition(merged) {
  const shards = new Array(SHARD_COUNT);
  for (let n = 0; n < SHARD_COUNT; n++) shards[n] = {};
  for (const t of Object.keys(merged)) shards[shardOf(t)][t] = merged[t];
  return shards;
}

// Partition + write ALL 32 shards atomically (empty shards written as {} so the
// layout is complete and loadAll never falls back to legacy afterwards).
function saveAll(dir, merged) {
  const shards = _partition(merged);
  for (let n = 0; n < SHARD_COUNT; n++) saveShard(dir, n, shards[n]);
  _stampMeta(dir, merged, SHARD_COUNT); // A7-b freshness stamp
}

// Write ONLY the shards that contain a changed ticker (checkpoint path — keeps
// write-amplification down vs. rewriting all 32 every ~100 batches). Each dirty
// shard is rebuilt COMPLETELY from `merged` (all its tickers, not just the dirty
// ones) because a shard file is overwritten whole. Returns the shard indices
// written (for logging/tests).
function saveDirty(dir, merged, dirtyTickers) {
  const dirtyShards = new Set();
  for (const t of dirtyTickers) dirtyShards.add(shardOf(t));
  if (dirtyShards.size === 0) return [];
  const byShard = {};
  for (const n of dirtyShards) byShard[n] = {};
  for (const t of Object.keys(merged)) {
    const n = shardOf(t);
    if (byShard[n]) byShard[n][t] = merged[t];
  }
  const written = [...dirtyShards].sort((a, b) => a - b);
  for (const n of written) saveShard(dir, n, byShard[n]);
  _stampMeta(dir, merged, written.length); // A7-b freshness stamp
  return written;
}

module.exports = {
  SHARD_COUNT,
  shardOf,
  shardFilename,
  shardPath,
  legacyPath,
  metaPath,
  loadMeta,
  loadShard,
  loadAll,
  saveShard,
  saveAll,
  saveDirty,
};
