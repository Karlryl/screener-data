#!/usr/bin/env node
/**
 * scripts/backfill-prices.js
 *
 * Gap-free backfill for the sharded price store (prices/history/, 32 shards —
 * lib/price-history-store.js). Fetches ~400 days of daily closes from
 * yahoo-finance2 for a given set of tickers, merges them into the existing
 * history (fetched value wins on collision), deduplicates by date, sorts
 * ascending, caps at 400 entries.
 *
 * X1 (Tag 348): reads via store.loadAll(), writes via store.saveDirty() —
 * ONLY the shards touched by the requested tickers. Before this fix the
 * script read/wrote the legacy prices/history.json monolith directly; since
 * the shard migration (Tag 294) store.loadAll() ignores that file once any
 * shard exists (price-history-store.js:122-124), so a manual backfill wrote
 * a file nobody reads anymore — every migrated consumer (pull-historical-
 * prices.js, update-ath-state.js, rank-ic.js, …) reads the shards.
 *
 * CLI:
 *   node scripts/backfill-prices.js --tickers AAA,BBB,CCC
 *   node scripts/backfill-prices.js --ticker-file tickers.json
 *   (both flags may be combined; duplicates are deduplicated)
 *
 * Exit 0 = success (even if some tickers failed — see summary).
 * Exit 1 = bad args or fatal I/O error.
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const store = require('../lib/price-history-store.js');

// ── yahoo-finance2 — exact same import style as pull-historical-prices.js ──
let yf;
try {
  const YF = require('yahoo-finance2').default;
  yf = (typeof YF === 'function')
    ? new YF({ validation: { logErrors: false, logOptionsErrors: false } })
    : YF;
} catch (e) {
  console.error('yahoo-finance2 not installed');
  process.exit(1);
}

// ── helpers ────────────────────────────────────────────────────────────────
function _ts()           { return new Date().toISOString(); }
function _log(lvl, msg)  { console.log(`[${_ts()}] [${lvl}] ${msg}`); }
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── arg parsing ────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { tickers: [], tickerFile: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--tickers' && argv[i + 1])      args.tickers = argv[++i].split(',').map(t => t.trim()).filter(Boolean);
    else if (argv[i] === '--ticker-file' && argv[i + 1]) args.tickerFile = argv[++i];
  }
  return args;
}

function loadTickerFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  // JSON array or newline-delimited
  if (raw.startsWith('[')) {
    const arr = JSON.parse(raw);
    // audit F-A-2026-06-21: coerce/drop non-string & object-shaped JSON elements
    // identically to the newline branch — prevents non-string values flowing into
    // yf.chart() and history[ticker] keys, corrupting the store.
    return arr.map(t => (typeof t === 'string' ? t : (t && t.ticker) || '').trim()).filter(Boolean);
  }
  return raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
}

// ── date extraction — same pattern as pull-historical-prices.js ────────────
function quoteDate(q) {
  return (q.date instanceof Date ? q.date : new Date(q.date)).toISOString().slice(0, 10);
}

// ── store I/O (X1) — mirrors update-ath-state.js / pull-historical-prices.js:
// read/write the shard store, never the legacy monolith directly. ──────────
function loadHistory(pricesDir) {
  try {
    return store.loadAll(pricesDir);
  } catch (e) {
    _log('ERROR', `price store read error: ${e.message} — aborting to protect data.`);
    process.exit(1);
  }
}

function saveHistory(pricesDir, history, dirty) {
  if (dirty.size === 0) {
    _log('INFO', 'no ticker updated — no shard written.');
    return [];
  }
  const written = store.saveDirty(pricesDir, history, dirty);
  _log('INFO', `price store shards written: ${written.map(store.shardFilename).join(', ')}`);
  return written;
}

// ── main ───────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);

  // Merge tickers from --tickers and --ticker-file, dedup
  let tickers = [...args.tickers];
  if (args.tickerFile) {
    tickers = tickers.concat(loadTickerFile(args.tickerFile));
  }
  // Deduplicate preserving order
  tickers = [...new Set(tickers)];

  if (tickers.length === 0) {
    console.error('Usage: node scripts/backfill-prices.js --tickers AAA,BBB [--ticker-file tickers.json]');
    console.error('At least one ticker is required.');
    process.exit(1);
  }

  _log('INFO', `Backfill requested for ${tickers.length} tickers`);

  // ── load watchlist for optional yahoo_symbol overrides ────────────────────
  let wlSymbolMap = {};
  try {
    const wl = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../watchlist.json'), 'utf8'));
    for (const s of (wl.stocks || [])) {
      if (s.ticker && s.yahoo_symbol && s.yahoo_symbol !== s.ticker) {
        wlSymbolMap[s.ticker] = s.yahoo_symbol;
      }
    }
  } catch (_) { /* watchlist unavailable — proceed without it */ }

  // ── load existing history once (shard-aware store, X1) ─────────────────────
  const pricesDir = path.resolve(__dirname, '../prices');
  const history = loadHistory(pricesDir);
  if (Object.keys(history).length === 0) {
    _log('WARN', 'price store empty (no shards, no legacy history.json) — starting fresh.');
  }

  // ── process tickers in batches of 10 ──────────────────────────────────────
  const BATCH   = 10;
  const SLEEP   = 1500;

  let succeeded = 0;
  const failed  = [];
  const dirty   = new Set(); // X1: tickers actually written this run → saveDirty shard set
  let globalMaxDate = '';

  for (let batchStart = 0; batchStart < tickers.length; batchStart += BATCH) {
    const batch = tickers.slice(batchStart, batchStart + BATCH);

    await Promise.all(batch.map(async (ticker) => {
      try {
        const yahooSymbol = wlSymbolMap[ticker] || ticker;

        const period1 = new Date(Date.now() - 400 * 86400 * 1000);
        const period2 = new Date();

        const result = await yf.chart(yahooSymbol, { period1, period2, interval: '1d' });

        // Extract {date, close} — match pull-historical-prices.js:
        // prefer adjclose, fall back to close; skip null/NaN/non-finite closes.
        const quotes = (result.quotes || []);
        const fetched = [];
        for (const q of quotes) {
          const closeVal = q.adjclose ?? q.close;
          if (closeVal == null || !isFinite(closeVal)) continue;
          fetched.push({ date: quoteDate(q), close: closeVal });
        }

        if (fetched.length === 0) {
          _log('WARN', `${ticker}: no usable bars returned`);
          failed.push(ticker);
          return;
        }

        // ── MERGE: existing entries are the base; fetched wins on collision ──
        const existing = history[ticker] || [];
        const merged   = new Map();
        for (const e of existing) merged.set(e.date, e.close);
        for (const e of fetched)  merged.set(e.date, e.close); // fetched overwrites

        // Sort ascending, dedup by date (Map already deduped), cap at 400
        let arr = Array.from(merged.entries())
          .map(([date, close]) => ({ date, close }))
          .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        if (arr.length > 400) arr = arr.slice(arr.length - 400);

        history[ticker] = arr;
        dirty.add(ticker);

        const firstDate = arr[0].date;
        const lastDate  = arr[arr.length - 1].date;
        if (lastDate > globalMaxDate) globalMaxDate = lastDate;

        _log('INFO', `${ticker}: fetched ${fetched.length} bars, series now ${firstDate}..${lastDate}, ${arr.length} entries`);
        succeeded++;
      } catch (e) {
        _log('WARN', `${ticker}: FAILED — ${e.message}`);
        failed.push(ticker);
      }
    }));

    // Sleep between batches (not after the last one)
    if (batchStart + BATCH < tickers.length) {
      await sleep(SLEEP);
    }
  }

  // ── shard write — once, after all tickers processed; dirty shards only (X1) ─
  saveHistory(pricesDir, history, dirty);

  // ── summary ────────────────────────────────────────────────────────────────
  console.log('\n=== BACKFILL SUMMARY ===');
  console.log(`Requested : ${tickers.length}`);
  console.log(`Succeeded : ${succeeded}`);
  console.log(`Failed    : ${failed.length}${failed.length ? ' — ' + failed.join(', ') : ''}`);
  console.log(`Global max date among processed tickers: ${globalMaxDate || '(none)'}`);
  console.log('========================\n');

  if (succeeded === 0 && tickers.length > 0) process.exit(1);
}

// X1: guard like every other migrated caller (pull-historical-prices.js,
// update-ath-state.js) so the module can be require()'d for tests without
// immediately running main() against process.argv.
if (require.main === module) {
  main().catch(e => { _log('FATAL', e.stack || e.message); process.exit(1); });
}

module.exports = { parseArgs, loadTickerFile, quoteDate, loadHistory, saveHistory };
