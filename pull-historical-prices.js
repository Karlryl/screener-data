#!/usr/bin/env node
/**
 * Tag 39 — Historical-Price-Pull
 * Pullt für alle watchlist-Stocks die letzten 365 Tage Closing-Prices.
 * Output: prices/YYYY-MM-DD.json mit { ticker: { close, asOf } } (latest only)
 * Plus: prices-history.json (kumulativ) — ticker → array of {date, close}
 *
 * audit F-A-2026-06-21: conflicting price semantics (raw close vs adjusted close
 * under the same `close` key). CANONICAL CONTRACT for prices/history.json and the
 * per-day prices/<date>.json: the `close` field stores the ADJUSTED close
 * (split/dividend-adjusted, `adjclose ?? close`), standardized in Tag 148 and
 * consumed by walk-forward-perf.js (which reads `e.close` blindly). This is the
 * single source of truth — any OTHER writer of these files (the manual
 * scripts/backfill-prices.js) MUST write the same adjusted-close semantic, NOT
 * the raw close, or the series would silently mix raw and adjusted prices and
 * corrupt returns.
 * audit/fix: pull-prices-bulk.js — a third, orphaned writer that stored RAW
 * close — was retired in the hypergrowth cleanup, removing that mixed-basis hazard.
 *
 * Run: node pull-historical-prices.js [--watchlist watchlist.json] [--out prices/]
 */
'use strict';
const fs = require('fs');
const path = require('path');
// Tag 217g (audit F-217a-02 HIGH fix): atomic writes for prices history.
// pull-historical-prices.js writes prices/history.json which is the single
// source of truth for backtest scripts and the dashboard's price-momentum
// computation. A SIGTERM mid-write corrupts it; the existing recovery branch
// (lines 60-75) refuses to run without RESET_HISTORY=1, which destroys
// months of accumulated price history when triggered.
const { writeFileAtomic } = require('./lib/atomic-write.js');
let yf;
try {
  const YF = require('yahoo-finance2').default;
  // Tag-39: yahoo-finance2 v3+ requires new instance
  // Tag 211m: silence schema-validation log spam (Tag 211c sibling fix).
  yf = (typeof YF === 'function')
    ? new YF({ validation: { logErrors: false, logOptionsErrors: false } })
    : YF;
}
catch (e) { console.error('yahoo-finance2 not installed'); process.exit(1); }

function _ts() { return new Date().toISOString(); }
function _log(level, msg) { console.log(`[${_ts()}] [${level}] ${msg}`); }

function parseArgs(argv) {
  const args = { watchlist: './watchlist.json', out: './prices', rateLimit: 1500 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--watchlist' && argv[i+1]) args.watchlist = argv[++i];
    else if (argv[i] === '--out' && argv[i+1]) args.out = argv[++i];
    else if (argv[i] === '--rate-limit' && argv[i+1]) args.rateLimit = parseInt(argv[++i], 10);
  }
  return args;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.out)) fs.mkdirSync(args.out, { recursive: true });
  const wl = JSON.parse(fs.readFileSync(args.watchlist, 'utf8'));
  // Tag 134 — Phase 3.3: ensure benchmark ETFs are always pulled so walk-forward-perf
  // can compute alpha vs SPY. Prepended to the watchlist (idempotent: skip if already present).
  const BENCHMARKS = [
    { ticker: 'SPY', yahoo_symbol: 'SPY', name: 'SPDR S&P 500 ETF', added_via: 'benchmark' },
    { ticker: 'QQQ', yahoo_symbol: 'QQQ', name: 'Invesco QQQ (Nasdaq-100)', added_via: 'benchmark' },
    { ticker: 'IWM', yahoo_symbol: 'IWM', name: 'iShares Russell 2000', added_via: 'benchmark' }
  ];
  // audit F-A-2026-06-21: duplicate benchmark row — dedupe case-insensitively so a
  // watchlist entry like 'spy' (lowercase) or a benchmark whose ticker differs only in
  // case can't slip past the exact-match guard and get processed twice under a divergent
  // ticker key. b.ticker is already upper-case in BENCHMARKS above.
  for (const b of BENCHMARKS) {
    if (!wl.stocks.some(s => (s.ticker || '').toUpperCase() === b.ticker)) wl.stocks.unshift(b);
  }
  // audit/fix: honor the workflow's frozen RUN_DATE_UTC for the per-day snapshot
  // filename + pulledOn provenance, instead of a self-computed wall-clock UTC date.
  // The daily-pull workflow freezes RUN_DATE_UTC at job start so all date-stamped
  // artifacts agree even across a UTC-midnight crossing; this mirrors what
  // archive-old-snapshots.js already does. (History-array entry dates are NOT touched
  // here — those correctly use the real exchange latestQuoteDate.)
  const today = process.env.RUN_DATE_UTC || new Date().toISOString().slice(0, 10);

  // Load existing kumulative history wenn vorhanden.
  // F-SC-028 (Tag 180): a JSON.parse failure previously silently reset to {} and the
  // run then overwrote the (possibly recoverable) corrupt file with one day of
  // prices — destroying months of accumulated history. Now: back up the corrupt
  // file, log loudly, and refuse to continue unless RESET_HISTORY=1 is explicit.
  const histPath = path.join(args.out, 'history.json');
  let history = {};
  if (fs.existsSync(histPath)) {
    try {
      history = JSON.parse(fs.readFileSync(histPath, 'utf8'));
    } catch (e) {
      const backup = histPath + '.corrupt.' + Date.now();
      try { fs.copyFileSync(histPath, backup); } catch (_) {}
      _log('ERROR', 'history.json is corrupt (' + e.message + '). Backup saved to ' + backup);
      if (process.env.RESET_HISTORY !== '1') {
        _log('ERROR', 'Refusing to overwrite — set RESET_HISTORY=1 to start fresh.');
        process.exit(1);
      }
      _log('WARN', 'RESET_HISTORY=1 set — proceeding with empty history.');
    }
  }

  const todaysSnapshot = {};
  let ok = 0, failed = 0;

  // Tag-84: parallel pulls
  const CONCURRENCY = parseInt(process.env.PRICE_CONCURRENCY || '10', 10);
  _log('INFO', `Parallel price pulls: ${CONCURRENCY} concurrent`);
  async function processOne(stock) {

    try {
      _log('INFO', `Pulling ${stock.ticker}...`);
      const period1 = new Date(Date.now() - 400 * 86400 * 1000);
      const period2 = new Date();
      const result = await yf.chart(stock.yahoo_symbol, {
        period1, period2, interval: '1d'
      });
      // Tag 148: use adjclose (dividend/split-adjusted) instead of raw close
      // audit/fix: reject NaN/Infinity closes (JSON.stringify rewrites them to null, poisoning history.json) — mirror backfill-prices.js isFinite filter
      // Bug 11: also reject <=0 closes (Yahoo adjclose-0 glitch) so a 0-close never
      // reaches history.json and gets booked as a -100% forward return downstream.
      const quotes = (result.quotes || []).filter(q => { const v = q.adjclose ?? q.close; return v != null && isFinite(v) && v > 0; });
      if (!quotes.length) { failed++; return; }
      const latestQuote = quotes[quotes.length - 1];
      const latestClose = latestQuote.adjclose ?? latestQuote.close;
      // Tag 231a-3 (audit HIGH fix): derive the actual trading date from the
      // latest quote rather than using UTC `today`. Previously: on a weekend
      // (today=Sat) the workflow would push {date:'Sat', close: Friday-price}
      // into history — a phantom row mapping Saturday to Friday's close. When
      // walk-forward looked up SPY at Saturday it got a real number that
      // wasn't actually an end-of-day quote for Saturday, breaking the
      // benchmark-canonical date pair (Tag 231a-2) for any vintage falling
      // on a weekend/holiday. Fix: store the date the exchange actually
      // reported, never a calendar date the market wasn't open on.
      const latestQuoteDate = latestQuote.date
        ? (latestQuote.date instanceof Date ? latestQuote.date : new Date(latestQuote.date)).toISOString().slice(0, 10)
        : today;
      // audit F-A-2026-06-21: weekend phantom-date — per-day snapshot now stamps the
      // real exchange trading date (latestQuoteDate, Tag 231a-3) instead of the calendar
      // run date `today`. On a Saturday/holiday run the prices/<date>.json file previously
      // labeled Friday's adjclose as asOf=Saturday, re-introducing the exact Sat→Fri
      // phantom-date mapping the history array was fixed to avoid. We keep the run date
      // explicitly as `pulledOn` for provenance.
      todaysSnapshot[stock.ticker] = { close: latestClose, asOf: latestQuoteDate, pulledOn: today, currency: result.meta && result.meta.currency };

      // Extend history: back-fill the full fetched series, not just the latest day.
      if (!history[stock.ticker]) history[stock.ticker] = [];
      // Tag 223c (audit F-222a-6 HIGH fix): replace O(N) .find() with O(1)
      // last-element check (array is sorted ascending by date in the steady
      // state — only today's entry can be appended). Also replace .slice(-400)
      // (which allocates a fresh array each call) with in-place .splice when
      // the array exceeds 400 entries. At 19k × 400 = 7.6M comparisons -> ~7.6k.
      const arr = history[stock.ticker];
      // audit F-A-2026-06-21: under-length series → null forward-return → survivorship-like
      // exclusion. Previously processOne fetched 400 days but appended ONLY the single
      // latest quote, so any freshly-discovered ticker had a 1-point history and grew by
      // 1/day — walk-forward had near-zero history for most of the universe and silently
      // dropped those tickers (null forward returns). Mirror the SPY back-fill (lines
      // below): insert every fetched quote whose date isn't already present, then sort+trim.
      // One-time this fills history for the whole universe; steady-state it's a no-op append.
      // audit/fix (A2 council+court, 2026-06-26): FETCHED-WINS merge (was existing-wins).
      // Yahoo's adjclose is BACK-adjusted: a forward split re-bases ALL prior dates, but
      // existing-wins only wrote the new basis onto NEW dates, freezing a split-ratio
      // discontinuity into the stored tail — a walk-forward window spanning the split then
      // returned p1/p0-1 wrong by the split ratio (NVDA/AVGO 10:1 in 2024 -> phantom -90%).
      // Overwrite each stored date's close with Yahoo's current authoritative value, mirroring
      // the already-blessed sibling writer backfill-prices.js (~line 156, 'fetched overwrites').
      // Self-correcting: we always re-derive from Yahoo, never from our own store, so a
      // transient bad bar is replaced next run (not a frozen fixed point). c is already
      // isFinite-filtered into `quotes` above; the guard below is defense-in-depth so no
      // non-finite value can ever reach JSON.stringify (Tag 122/124 invariant).
      const merged = new Map(arr.map(e => [e.date, e.close]));
      for (const q of quotes) {
        const d = (q.date instanceof Date ? q.date : new Date(q.date)).toISOString().slice(0, 10);
        const c = q.adjclose ?? q.close; // ADJUSTED close (split/dividend-adjusted), Tag 148
        if (c != null && isFinite(c) && c > 0) merged.set(d, c); // Bug 11: reject <=0 too; fetched overwrites stored -> re-base
      }
      arr.length = 0;
      for (const [d, c] of merged) arr.push({ date: d, close: c }); // 'close' = ADJUSTED (Tag 148)
      arr.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
      if (arr.length > 400) arr.splice(0, arr.length - 400);
      ok++;
    } catch (e) {
      _log('WARN', `  ${stock.ticker} failed: ${e.message}`);
      failed++;
    }

    }
  for (let batchStart = 0; batchStart < wl.stocks.length; batchStart += CONCURRENCY) {
    const batch = wl.stocks.slice(batchStart, batchStart + CONCURRENCY);
    await Promise.all(batch.map(s => processOne(s).catch(e => _log('WARN', `Batch ${s.ticker}: ${e.message}`))));
    if (batchStart + CONCURRENCY < wl.stocks.length) {
      await sleep(args.rateLimit);
      if (batchStart % 100 === 0) _log('INFO', `Price pull progress: ${batchStart + CONCURRENCY}/${wl.stocks.length}`);
    }
  }


  // Tag 134 — Phase 3.3 (guarantee): always ensure each benchmark is in history,
  // even if the benchmark-injection above was a no-op (e.g. history.json pre-dates
  // that fix). Only pull a benchmark if it is missing from history OR missing from
  // today's snapshot.
  // audit F-A-2026-06-21: single-point benchmark → invalid alpha. The dedicated
  // back-fill was hardcoded to SPY only; QQQ and IWM (both listed in BENCHMARKS and
  // unshifted into the watchlist) flowed solely through processOne and — before the
  // per-ticker back-fill fix above — accumulated a 1-point series. alpha-vs-QQQ/IWM in
  // walk-forward was therefore computed against a single-day benchmark. Generalize the
  // guarantee loop over the whole BENCHMARKS array so every benchmark gets a full series.
  for (const bench of BENCHMARKS) {
    const sym = bench.yahoo_symbol;
    const key = bench.ticker;
    if (history[key] && todaysSnapshot[key]) continue;
    try {
      _log('INFO', `${key} not in history — pulling dedicated ${key} benchmark...`);
      const period1 = new Date(Date.now() - 400 * 86400 * 1000);
      const period2 = new Date();
      const benchResult = await yf.chart(sym, { period1, period2, interval: '1d' });
      // audit/fix: reject NaN/Infinity closes (JSON.stringify rewrites them to null, poisoning history.json) — mirror backfill-prices.js isFinite filter
      // Bug 11: also reject <=0 closes (see processOne).
      const benchQuotes = (benchResult.quotes || []).filter(q => { const v = q.adjclose ?? q.close; return v != null && isFinite(v) && v > 0; });
      if (benchQuotes.length) {
        const latestBenchQuote = benchQuotes[benchQuotes.length - 1];
        const latestClose = latestBenchQuote.adjclose ?? latestBenchQuote.close;
        // audit F-A-2026-06-21: weekend phantom-date (see processOne) — stamp the real
        // exchange trading date, not the calendar run date, in the per-day snapshot.
        const latestBenchDate = latestBenchQuote.date
          ? (latestBenchQuote.date instanceof Date ? latestBenchQuote.date : new Date(latestBenchQuote.date)).toISOString().slice(0, 10)
          : today;
        todaysSnapshot[key] = { close: latestClose, asOf: latestBenchDate, pulledOn: today, currency: benchResult.meta && benchResult.meta.currency };
        if (!history[key]) history[key] = [];
        // Tag 223c (audit F-222a-9 MEDIUM fix): replace O(N²) .find() in
        // back-fill loop (~400 quotes × 400 history entries = ~160k compares)
        // with a single Set of known dates (O(N) total).
        // Tag 231a-3 (audit HIGH fix): rely entirely on the back-fill loop to
        // populate dates. Previously we pre-pushed {date: today, close: latestClose}
        // before the back-fill — if today was Saturday and latestQuote.date was
        // Friday, we'd then have BOTH {Saturday, Friday-price} (phantom) AND
        // {Friday, Friday-price} (real) in history. The back-fill loop below
        // already inserts the real dated entry; the pre-push was redundant at
        // best and date-corrupting at worst.
        // audit/fix (A2 council+court, 2026-06-26): FETCHED-WINS (see processOne). Overwrite
        // stored benchmark closes with Yahoo's current authoritative adjclose so a split
        // re-bases the whole series — benchmarks (SPY/QQQ/IWM) split too, and a wrong-basis
        // benchmark corrupts EVERY alpha computation in walk-forward.
        const benchMerged = new Map(history[key].map(e => [e.date, e.close]));
        for (const q of benchQuotes) {
          const d = (q.date instanceof Date ? q.date : new Date(q.date)).toISOString().slice(0, 10);
          const c = q.adjclose ?? q.close;
          if (c != null && isFinite(c) && c > 0) benchMerged.set(d, c); // Bug 11: reject <=0 too; fetched overwrites stored
        }
        history[key] = [];
        for (const [d, c] of benchMerged) history[key].push({ date: d, close: c }); // ADJUSTED (Tag 148)
        history[key].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
        history[key] = history[key].slice(-400);
        ok++;
        _log('INFO', `${key} dedicated pull: ${history[key].length} history entries`);
      } else {
        _log('WARN', `${key} dedicated pull returned no quotes`);
      }
    } catch (e) {
      _log('WARN', `${key} dedicated pull failed: ${e.message}`);
    }
  }

  writeFileAtomic(path.join(args.out, `${today}.json`), JSON.stringify(todaysSnapshot, null, 2));
  // Tag 222 (audit F-222a-1 BLOCKING): drop the pretty-print indent. At 19k
  // tickers × 400 days × ~40 bytes/entry = ~280MB single-string. V8 hard
  // limit is 512MB per string → OOM. Compact JSON = ~80MB, well within limits.
  // The history file is read by scripts not humans; readability not needed.
  writeFileAtomic(histPath, JSON.stringify(history));
  _log('INFO', `Done: ${ok}/${wl.stocks.length} ok, ${failed} failed`);

  // audit/fix: exit non-zero on total price-pull failure (was implicit exit 0, masking a dead Yahoo day) — mirrors backfill-prices.js
  if (ok === 0 && wl.stocks.length > 0) process.exit(1);
}

main().catch(e => { _log('FATAL', e.stack || e.message); process.exit(1); });
