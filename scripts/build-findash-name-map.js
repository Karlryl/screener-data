#!/usr/bin/env node
'use strict';

/**
 * Deterministic local fallback names for the currently published Findash overview.
 *
 * Reads only the existing public v1 overview plus local allowed snapshot/watchlist
 * metadata. It never runs scoring and never changes the published export.
 *
 *   node scripts/build-findash-name-map.js
 *   node scripts/build-findash-name-map.js --check
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { writeJsonAtomic } = require('../lib/atomic-write.js');

const ROOT = path.join(__dirname, '..');
const OVERVIEW = path.join(ROOT, 'outputs', 'findash-export', 'v1', 'overview.json');
const SNAPSHOTS = path.join(ROOT, 'snapshots');
const WATCHLIST = path.join(ROOT, 'watchlist.json');
const OUTPUT = path.join(ROOT, 'external-data', 'findash-name-map.json');
const SCHEMA = 'findash-name-map/v1';

function normalizeTicker(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function normalizeName(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function marketBase(value) {
  return normalizeTicker(value).replace(/(\.[A-Z0-9]{1,4}|=[A-Z])$/, '');
}

function unsafeName(value) {
  return /[<>\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value);
}

function add(map, ticker, name) {
  if (!map.has(ticker)) map.set(ticker, new Set());
  map.get(ticker).add(name);
}

function safeCandidate(name, aliases, rejected) {
  const normalized = normalizeName(name);
  if (!normalized) {
    rejected.invalid++;
    return null;
  }
  if (aliases.some((alias) => normalizeTicker(normalized) === normalizeTicker(alias))) {
    rejected.placeholder++;
    return null;
  }
  if (unsafeName(normalized)) {
    rejected.unsafe++;
    return null;
  }
  return normalized;
}

function buildRegistries(snapshots, watchlist) {
  const rejected = { invalid: 0, placeholder: 0, unsafe: 0 };
  const snapshotExact = new Map();
  const watchlistExact = new Map();
  const instruments = [];

  for (const snapshot of snapshots || []) {
    const ticker = normalizeTicker(snapshot && snapshot.meta && snapshot.meta.ticker);
    if (!ticker) continue;
    const name = safeCandidate(snapshot.meta.name, [ticker], rejected);
    if (!name) continue;
    add(snapshotExact, ticker, name);
    instruments.push({ aliases: [ticker], name, provenance: 'snapshot' });
  }

  for (const item of watchlist || []) {
    const aliases = [...new Set([item && item.ticker, item && item.yahoo_symbol]
      .map(normalizeTicker).filter(Boolean))];
    if (!aliases.length) continue;
    const name = safeCandidate(item.name, aliases, rejected);
    if (!name) continue;
    for (const alias of aliases) add(watchlistExact, alias, name);
    instruments.push({ aliases, name, provenance: 'watchlist' });
  }

  return { snapshotExact, watchlistExact, instruments, rejected };
}

function exactChoice(map, ticker) {
  const names = [...(map.get(ticker) || [])].sort((a, b) => a.localeCompare(b, 'en'));
  if (names.length === 0) return { state: 'missing' };
  if (names.length > 1) return { state: 'ambiguous' };
  return { state: 'ok', name: names[0] };
}

function baseChoice(instruments, ticker) {
  const wanted = marketBase(ticker);
  const candidates = instruments.filter((item) => item.aliases.some((alias) => marketBase(alias) === wanted));
  if (!candidates.length) return { state: 'missing' };
  const names = [...new Set(candidates.map((item) => item.name))];
  if (candidates.length !== 1 || names.length !== 1) return { state: 'ambiguous' };
  return { state: 'ok', name: names[0], provenance: candidates[0].provenance + '-unique-base' };
}

function buildNameMap({ overviewBytes, snapshots, watchlist }) {
  const bytes = Buffer.isBuffer(overviewBytes) ? overviewBytes : Buffer.from(String(overviewBytes));
  const overview = JSON.parse(bytes.toString('utf8'));
  assert.equal(overview.schema, 'findash-export/v1', 'overview schema must be findash-export/v1');
  assert.ok(Array.isArray(overview.rows), 'overview.rows must be an array');

  const published = overview.rows.map((row) => ({
    ticker: String(row && row.ticker || '').trim(),
    normalizedTicker: normalizeTicker(row && row.ticker),
  }));
  assert.ok(published.every((row) => row.normalizedTicker), 'every published row needs a ticker');
  assert.equal(new Set(published.map((row) => row.normalizedTicker)).size, published.length,
    'published overview contains duplicate normalized tickers');

  const registry = buildRegistries(snapshots, watchlist);
  const entries = [];
  const unresolved = [];
  const ambiguous = [];

  for (const row of published) {
    const fromSnapshot = exactChoice(registry.snapshotExact, row.normalizedTicker);
    if (fromSnapshot.state === 'ok') {
      entries.push({ ...row, name: fromSnapshot.name, provenance: 'snapshot-exact' });
      continue;
    }
    if (fromSnapshot.state === 'ambiguous') {
      unresolved.push(row.normalizedTicker);
      ambiguous.push({ normalizedTicker: row.normalizedTicker, stage: 'snapshot-exact' });
      continue;
    }

    const fromWatchlist = exactChoice(registry.watchlistExact, row.normalizedTicker);
    if (fromWatchlist.state === 'ok') {
      entries.push({ ...row, name: fromWatchlist.name, provenance: 'watchlist-exact' });
      continue;
    }
    if (fromWatchlist.state === 'ambiguous') {
      unresolved.push(row.normalizedTicker);
      ambiguous.push({ normalizedTicker: row.normalizedTicker, stage: 'watchlist-exact' });
      continue;
    }

    const fromBase = baseChoice(registry.instruments, row.normalizedTicker);
    if (fromBase.state === 'ok') {
      entries.push({ ...row, name: fromBase.name, provenance: fromBase.provenance });
      continue;
    }
    unresolved.push(row.normalizedTicker);
    if (fromBase.state === 'ambiguous') {
      ambiguous.push({ normalizedTicker: row.normalizedTicker, stage: 'market-base' });
    }
  }

  entries.sort((a, b) => a.normalizedTicker.localeCompare(b.normalizedTicker, 'en'));
  unresolved.sort((a, b) => a.localeCompare(b, 'en'));
  ambiguous.sort((a, b) => a.normalizedTicker.localeCompare(b.normalizedTicker, 'en'));
  return {
    schema: SCHEMA,
    sourceOverviewSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    rowCount: published.length,
    mappedCount: entries.length,
    coveragePct: Number((100 * entries.length / Math.max(1, published.length)).toFixed(1)),
    rejectedCandidates: registry.rejected,
    entries,
    unresolved,
    ambiguous,
  };
}

function enrichRows(rows, artifact) {
  assert.equal(artifact && artifact.schema, SCHEMA, 'name-map schema mismatch');
  const names = new Map((artifact.entries || []).map((entry) => [entry.normalizedTicker, entry.name]));
  return (rows || []).map((row) => {
    if (normalizeName(row && row.name)) return row;
    const name = names.get(normalizeTicker(row && row.ticker));
    return name ? { ...row, name } : row;
  });
}

function loadSnapshots(dir) {
  const rows = [];
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith('.json') || file.startsWith('_manifest') || file === '_last_good_disk.json') continue;
    try { rows.push(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))); } catch (_) { /* unusable source is skipped */ }
  }
  return rows;
}

function loadWatchlist(file) {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(value) ? value : (value.stocks || value.items || []);
}

function withoutNames(rows) {
  return rows.map(({ name, ...row }) => row);
}

function generate() {
  const overviewBytes = fs.readFileSync(OVERVIEW);
  const overview = JSON.parse(overviewBytes.toString('utf8'));
  const artifact = buildNameMap({
    overviewBytes,
    snapshots: loadSnapshots(SNAPSHOTS),
    watchlist: loadWatchlist(WATCHLIST),
  });
  const enriched = enrichRows(overview.rows, artifact);
  assert.deepEqual(withoutNames(enriched), withoutNames(overview.rows),
    'adding and stripping name must preserve every existing published field');
  return artifact;
}

if (require.main === module) {
  const artifact = generate();
  if (process.argv.includes('--check')) {
    assert.deepEqual(JSON.parse(fs.readFileSync(OUTPUT, 'utf8')), artifact, 'tracked name-map is stale');
    console.log(`findash-name-map OK: ${artifact.mappedCount}/${artifact.rowCount} (${artifact.coveragePct}%), ${artifact.unresolved.length} unresolved`);
  } else {
    writeJsonAtomic(OUTPUT, artifact, { indent: 2 });
    console.log(`findash-name-map written: ${artifact.mappedCount}/${artifact.rowCount} (${artifact.coveragePct}%), ${artifact.unresolved.length} unresolved -> ${OUTPUT}`);
  }
}

module.exports = { buildNameMap, enrichRows, normalizeTicker, SCHEMA };
