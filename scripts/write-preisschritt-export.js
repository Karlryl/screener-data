#!/usr/bin/env node
'use strict';

// Additive, display-only price-step file (A5 package P240).
// Per filter-universe ticker the last two FINISHED stored daily bars of the price store (prices/history/), so that
// c1 / c0 is the total return of that step. Finished = dated strictly before the UTC day of the store stamp
// (priceStoreUpdatedAt): the pulls run during European trading hours, so the bar of the stamp day is an intraday
// value, and a previous-day bar can still vanish or change at the next pull. Raw numbers only: nothing is ranked,
// scored or judged here.
// It sits next to filter/universum.json and never touches it.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { writeJsonAtomic } = require('../lib/atomic-write.js');
const store = require('../lib/price-history-store.js');

const ROOT = path.resolve(__dirname, '..');
const SCHEMA = 'findash-export/v1';
const MAX_BYTES = 4_000_000;
const ROW_KEYS = ['t', 'd0', 'c0', 'd1', 'c1'];
// Why a universe ticker has no row. Every ticker is either a row or counted here, so rows + skipped = universeCount.
const SKIP_REASONS = ['not-in-store', 'fewer-than-two-bars', 'fewer-than-two-finished-bars', 'invalid-date', 'invalid-close', 'dates-not-increasing'];
const finite = Number.isFinite;
const text = v => typeof v === 'string' && v.trim() ? v.trim() : null;
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
// A real calendar day (YYYY-MM-DD); anything else, including a full timestamp, is null.
const day = v => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const t = Date.parse(v);
  return finite(t) && new Date(t).toISOString().slice(0, 10) === v ? v : null;
};
// The UTC calendar day of a store stamp; bars of this day and later are not finished.
const cutoffOf = stamp => new Date(stamp).toISOString().slice(0, 10);
// A stored close is a positive finite number; a string, zero or negative value is a feed glitch, never a price.
const goodClose = v => typeof v === 'number' && finite(v) && v > 0;

/**
 * Reduce a stored series to what the file needs: its length and its last two finished bars. A bar whose date is a string
 * on or after the cutoff day is not finished and is dropped; anything else (including an unreadable date) stays, so that
 * the row checks can name it.
 * @param {Array<{date: string, close: number}>} bars The stored series, oldest first.
 * @param {string} cutoffDay UTC day of the store stamp (YYYY-MM-DD).
 * @returns {{total: number, tail: Array<{date: string, close: number}>}} Stored bar count and the last two finished bars.
 */
function tailOf(bars, cutoffDay) {
  return { total: bars.length, tail: bars.filter(b => !(typeof b?.date === 'string' && b.date >= cutoffDay)).slice(-2) };
}

/**
 * Turn the last two finished bars of one ticker into a row, or name the reason why there is none.
 * The bars are taken exactly as stored, never filled or replaced by older ones. They need not be consecutive trading
 * days: the row states both dates and the consumer judges the gap.
 * @param {string} ticker Universe ticker.
 * @param {{total: number, tail: Array<{date: string, close: number}>}|undefined} entry Result of tailOf; undefined when the ticker is not in the store.
 * @returns {{row: object}|{skip: string}} Row `{t, d0, c0, d1, c1}` or one of SKIP_REASONS.
 */
function stepFor(ticker, entry) {
  if (!entry || !Array.isArray(entry.tail)) return { skip: 'not-in-store' };
  if (entry.total < 2) return { skip: 'fewer-than-two-bars' };
  if (entry.tail.length < 2) return { skip: 'fewer-than-two-finished-bars' };
  const [a, b] = entry.tail, d0 = day(a?.date), d1 = day(b?.date);
  if (!d0 || !d1) return { skip: 'invalid-date' };
  if (!goodClose(a.close) || !goodClose(b.close)) return { skip: 'invalid-close' };
  if (!(d1 > d0)) return { skip: 'dates-not-increasing' };
  return { row: { t: ticker, d0, c0: a.close, d1, c1: b.close } };
}

/**
 * Build the v1 envelope for a universe and the stored tails of its tickers.
 * @param {object} input Universe tickers, `entries` (ticker to tailOf result), the generation (generated_at) copied from the board index and the store stamp.
 * @returns {object} Envelope with the cutoff day derived from the stamp, rows sorted by ticker (code point order) and a `skipped` count per reason; the input is never mutated.
 */
function buildFeed({ tickers, entries, generatedAt, priceStoreUpdatedAt }) {
  if (!text(generatedAt) || !finite(Date.parse(generatedAt))) throw new Error('Invalid generation');
  if (!text(priceStoreUpdatedAt) || !finite(Date.parse(priceStoreUpdatedAt))) throw new Error('Invalid price store stamp');
  const skipped = Object.fromEntries(SKIP_REASONS.map(reason => [reason, 0])), rows = [];
  for (const ticker of tickers) {
    const result = stepFor(ticker, Object.hasOwn(entries, ticker) ? entries[ticker] : undefined);
    if (result.row) rows.push(result.row); else skipped[result.skip]++;
  }
  // Code point order, not localeCompare: the byte order must not depend on the ICU data of the Node version.
  rows.sort((x, y) => (x.t < y.t ? -1 : x.t > y.t ? 1 : 0));
  return { schema: SCHEMA, generated_at: generatedAt, priceStoreUpdatedAt, cutoffDay: cutoffOf(priceStoreUpdatedAt), universeCount: tickers.length, skipped, rows };
}

/**
 * Check the contract of a parsed preisschritt file, including the uncompressed size budget.
 * @param {object} feed Parsed filter/preisschritt.json.
 * @param {number} bytes Exact UTF-8 file size.
 * @param {string} [generatedAt] generated_at of the board index next to the file; any other generation is a breach.
 * @param {string[]} [universe] Tickers of filter/universum.json; when given, the count and membership are checked too.
 * @returns {string[]} Contract breaches; an empty array means valid.
 */
function validate(feed, bytes, generatedAt, universe) {
  const errors = [], seen = new Set();
  if (!Number.isInteger(bytes) || bytes < 1 || bytes > MAX_BYTES) errors.push('Size must be between 1 and ' + MAX_BYTES + ' bytes');
  if (feed?.schema !== SCHEMA || !text(feed?.generated_at) || !finite(Date.parse(feed.generated_at))) errors.push('Invalid envelope');
  if (generatedAt !== undefined && feed?.generated_at !== generatedAt) errors.push('Generation mismatch with the board index');
  if (!text(feed?.priceStoreUpdatedAt) || !finite(Date.parse(feed.priceStoreUpdatedAt))) errors.push('Invalid priceStoreUpdatedAt');
  if (!Array.isArray(feed?.rows)) return errors.concat('Missing rows');
  const cutoff = feed.cutoffDay, stampOk = text(feed.priceStoreUpdatedAt) && finite(Date.parse(feed.priceStoreUpdatedAt));
  if (day(cutoff) !== cutoff || (stampOk && cutoff !== cutoffOf(feed.priceStoreUpdatedAt))) errors.push('Invalid cutoffDay');
  const skipped = feed.skipped;
  if (!skipped || typeof skipped !== 'object' || Array.isArray(skipped) || Object.keys(skipped).join() !== SKIP_REASONS.join()
    || !SKIP_REASONS.every(reason => Number.isInteger(skipped[reason]) && skipped[reason] >= 0)) {
    return errors.concat('Invalid skipped counts');
  }
  const skippedTotal = SKIP_REASONS.reduce((sum, reason) => sum + skipped[reason], 0);
  if (!Number.isInteger(feed.universeCount) || feed.universeCount <= 0 || feed.rows.length + skippedTotal !== feed.universeCount) errors.push('Universe count mismatch');
  if (universe && feed.universeCount !== universe.length) errors.push('Universe count differs from universum.json');
  const members = universe ? new Set(universe) : null;
  let previous = null;
  for (const row of feed.rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) { errors.push('Invalid row'); continue; }
    const where = text(row.t) || '?';
    if (Object.keys(row).join() !== ROW_KEYS.join()) errors.push(where + ': row shape');
    if (!text(row.t) || seen.has(row.t)) errors.push(where + ': missing/duplicate ticker');
    seen.add(row.t);
    if (previous !== null && text(row.t) && !(previous < row.t)) errors.push(where + ': rows not sorted by ticker');
    if (text(row.t)) previous = row.t;
    if (day(cutoff) === cutoff && day(row.d1) === row.d1 && row.d1 >= cutoff) errors.push(where + ': d1 not before cutoffDay (unfinished bar)');
    if (members && !members.has(row.t)) errors.push(where + ': not in universum.json');
    for (const key of ['d0', 'd1']) if (day(row[key]) !== row[key]) errors.push(where + ': invalid ' + key);
    for (const key of ['c0', 'c1']) if (!goodClose(row[key])) errors.push(where + ': ' + key + ' not a positive finite number');
    if (day(row.d0) && day(row.d1) && !(row.d1 > row.d0)) errors.push(where + ': dates not increasing');
  }
  return errors;
}

/**
 * Read the universe tickers from filter/universum.json and check that it belongs to the same generation as the board index.
 * @param {string} v1Dir Export v1 directory holding index.json and filter/universum.json.
 * @param {object} index Parsed board index.
 * @returns {string[]} Unique tickers of the universe, in file order.
 */
function universeTickers(v1Dir, index) {
  const file = readJson(path.join(v1Dir, 'filter', 'universum.json'));
  if (file.schema !== SCHEMA || file.generated_at !== index.generated_at || !Array.isArray(file.rows) || !file.rows.length) throw new Error('Invalid or foreign filter universe');
  const tickers = file.rows.map(row => text(row?.t));
  if (tickers.some(t => t === null) || new Set(tickers).size !== tickers.length) throw new Error('Filter universe with a missing or duplicate ticker');
  return tickers;
}

/**
 * Read the finished tails of the given tickers shard by shard (one shard in memory at a time). All 32 shards are read so
 * that their ticker count can be held against `_meta.json` (a truncated shard fails like in the store loader).
 * @param {string} pricesDir Price-store root (holds history/history-NN.json and history/_meta.json).
 * @param {string[]} tickers Wanted tickers.
 * @returns {{entries: object, updatedAt: string}} tailOf result per ticker found, and the store stamp.
 */
function readStore(pricesDir, tickers) {
  const meta = store.loadMeta(pricesDir);
  if (!meta) throw new Error('Price store has no _meta.json');
  // Same partial-store guard as the store loader: a stamped store always has all shard files.
  const missing = Array.from({ length: store.SHARD_COUNT }, (_, n) => n).filter(n => !fs.existsSync(store.shardPath(pricesDir, n)));
  if (missing.length) throw new Error('Price store is partial: ' + missing.length + ' shard file(s) missing');
  if (!text(meta.updatedAt) || !finite(Date.parse(meta.updatedAt))) throw new Error('Price store stamp is not a date');
  const cutoffDay = cutoffOf(meta.updatedAt), byShard = new Map();
  for (const ticker of tickers) {
    const n = store.shardOf(ticker);
    if (!byShard.has(n)) byShard.set(n, []);
    byShard.get(n).push(ticker);
  }
  const entries = {};
  let stored = 0;
  for (let n = 0; n < store.SHARD_COUNT; n++) {
    const shard = store.loadShard(pricesDir, n);
    stored += Object.keys(shard).length;
    for (const ticker of byShard.get(n) || []) if (Object.hasOwn(shard, ticker) && Array.isArray(shard[ticker])) entries[ticker] = tailOf(shard[ticker], cutoffDay);
  }
  if (stored !== meta.tickerCount) throw new Error('Price store carries ' + stored + ' ticker(s) but _meta.json stamps ' + meta.tickerCount + ' (truncated shard?)');
  return { entries, updatedAt: meta.updatedAt };
}

/**
 * Read the price store and the filter universe of one generation and atomically write filter/preisschritt.json.
 * @param {object} options Price-store root and the v1 export directory.
 * @returns {object} Written feed and its exact byte size.
 */
function build({ pricesDir, v1Dir }) {
  const index = readJson(path.join(v1Dir, 'index.json'));
  if (index.schema !== SCHEMA || !text(index.generated_at)) throw new Error('Invalid board index');
  // The filter step removes its folder when it fails; this file must not bring the folder back on its own.
  if (!fs.existsSync(path.join(v1Dir, 'filter'))) throw new Error('filter/ folder missing (filter universe step failed); not recreating it');
  const tickers = universeTickers(v1Dir, index);
  const { entries, updatedAt } = readStore(pricesDir, tickers);
  const feed = buildFeed({ tickers, entries, generatedAt: index.generated_at, priceStoreUpdatedAt: updatedAt });
  const bytes = Buffer.byteLength(JSON.stringify(feed));
  const errors = validate(feed, bytes, undefined, tickers);
  if (errors.length) throw new Error(errors.slice(0, 10).join('; ') + ' (measured ' + bytes + ' bytes)');
  writeJsonAtomic(path.join(v1Dir, 'filter', 'preisschritt.json'), feed, { indent: 0 });
  return { feed, bytes };
}

/**
 * Offline self-check on a hand series (100 then 102 gives a step of 1.02) and one tampered copy.
 * @returns {void} Throws an assertion error when the arithmetic or the validator is wrong.
 */
function selfTest() {
  const bars = { HAND: [{ date: '2026-10-13', close: 100 }, { date: '2026-10-14', close: 102 }, { date: '2026-10-15', close: 999 }], SOLO: [{ date: '2026-10-14', close: 5 }] };
  const entries = Object.fromEntries(Object.entries(bars).map(([t, b]) => [t, tailOf(b, '2026-10-15')]));
  const feed = buildFeed({ tickers: ['HAND', 'SOLO'], entries, generatedAt: '2026-10-15T08:00:00Z', priceStoreUpdatedAt: '2026-10-15T08:00:00Z' });
  assert.equal(feed.rows[0].c1 / feed.rows[0].c0, 1.02);
  assert.equal(feed.skipped['fewer-than-two-bars'], 1);
  assert.deepEqual(validate(feed, Buffer.byteLength(JSON.stringify(feed))), []);
  feed.rows[0].rank = 1;
  assert.ok(validate(feed, 1000).length);
}

/**
 * Run the offline writer, the read-only validator or the self-test.
 * @param {string[]} argv CLI arguments.
 * @returns {number} Zero on success, one on a source or contract error.
 */
function main(argv) {
  try {
    const options = { pricesDir: path.join(ROOT, 'prices'), v1Dir: path.join(ROOT, 'outputs', 'findash-export', 'v1') };
    const names = { '--prices-dir': 'pricesDir', '--v1-dir': 'v1Dir' };
    let check = false, self = false;
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '--check') check = true;
      else if (argv[i] === '--selftest') self = true;
      else if (names[argv[i]] && argv[i + 1] && !argv[i + 1].startsWith('--')) options[names[argv[i]]] = path.resolve(argv[++i]);
      else throw new Error('Unknown/incomplete argument ' + argv[i]);
    }
    if (self) { selfTest(); console.log('[preisschritt] selftest OK'); }
    else if (check) {
      const index = readJson(path.join(options.v1Dir, 'index.json'));
      const bytes = fs.readFileSync(path.join(options.v1Dir, 'filter', 'preisschritt.json'));
      const errors = validate(JSON.parse(bytes.toString('utf8')), bytes.length, index.generated_at, universeTickers(options.v1Dir, index));
      if (errors.length) throw new Error(errors.slice(0, 10).join('; '));
      console.log('[preisschritt] check OK (' + bytes.length + ' bytes)');
    } else {
      const { feed, bytes } = build(options);
      console.log('[preisschritt] ' + feed.rows.length + ' rows of ' + feed.universeCount + ' universe tickers, ' + bytes + ' bytes, skipped ' + JSON.stringify(feed.skipped));
    }
    return 0;
  } catch (error) { console.error('[preisschritt] ' + error.message); return 1; }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { cutoffOf, tailOf, stepFor, buildFeed, validate, universeTickers, readStore, build, selfTest, main, ROW_KEYS, SKIP_REASONS, MAX_BYTES };
