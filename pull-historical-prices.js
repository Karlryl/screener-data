#!/usr/bin/env node
/**
 * Tag 39 — Historical-Price-Pull
 * Pullt für alle watchlist-Stocks die letzten 365 Tage Closing-Prices.
 * Output: prices/YYYY-MM-DD.json mit { ticker: { close, asOf } } (latest only)
 * Plus: prices-history.json (kumulativ) — ticker → array of {date, close}
 *
 * Run: node pull-historical-prices.js [--watchlist watchlist.json] [--out prices/]
 */
'use strict';
const fs = require('fs');
const path = require('path');
let yf;
try {
  const YF = require('yahoo-finance2').default;
  // Tag-39: yahoo-finance2 v3+ requires new instance
  yf = (typeof YF === 'function') ? new YF() : YF;
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
  for (const b of BENCHMARKS) {
    if (!wl.stocks.find(s => s.ticker === b.ticker)) wl.stocks.unshift(b);
  }
  const today = new Date().toISOString().slice(0, 10);

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
      const quotes = (result.quotes || []).filter(q => (q.adjclose ?? q.close) != null);
      if (!quotes.length) { failed++; return; }
      const latestClose = quotes[quotes.length - 1].adjclose ?? quotes[quotes.length - 1].close;
      todaysSnapshot[stock.ticker] = { close: latestClose, asOf: today, currency: result.meta && result.meta.currency };

      // Extend history: only add today's entry if not already there
      if (!history[stock.ticker]) history[stock.ticker] = [];
      const existing = history[stock.ticker].find(e => e.date === today);
      if (!existing) {
        history[stock.ticker].push({ date: today, close: latestClose }); // stored as 'close' for backward compat
      }
      // Trim to last 400 days
      history[stock.ticker] = history[stock.ticker].slice(-400);
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


  // Tag 134 — Phase 3.3 (guarantee): always ensure SPY is in history, even if the
  // benchmark-injection above was a no-op (e.g. history.json pre-dates that fix).
  // Only pull if SPY is missing from history OR missing from today's snapshot.
  if (!history['SPY'] || !todaysSnapshot['SPY']) {
    try {
      _log('INFO', 'SPY not in history — pulling dedicated SPY benchmark...');
      const period1 = new Date(Date.now() - 400 * 86400 * 1000);
      const period2 = new Date();
      const spyResult = await yf.chart('SPY', { period1, period2, interval: '1d' });
      const spyQuotes = (spyResult.quotes || []).filter(q => (q.adjclose ?? q.close) != null);
      if (spyQuotes.length) {
        const latestClose = spyQuotes[spyQuotes.length - 1].adjclose ?? spyQuotes[spyQuotes.length - 1].close;
        todaysSnapshot['SPY'] = { close: latestClose, asOf: today, currency: spyResult.meta && spyResult.meta.currency };
        if (!history['SPY']) history['SPY'] = [];
        const existing = history['SPY'].find(e => e.date === today);
        if (!existing) history['SPY'].push({ date: today, close: latestClose });
        history['SPY'] = history['SPY'].slice(-400);
        // Back-fill all available dates from this pull (so walk-forward has enough history)
        for (const q of spyQuotes) {
          const d = (q.date instanceof Date ? q.date : new Date(q.date)).toISOString().slice(0, 10);
          if (!history['SPY'].find(e => e.date === d)) {
            history['SPY'].push({ date: d, close: q.adjclose ?? q.close });
          }
        }
        history['SPY'].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
        history['SPY'] = history['SPY'].slice(-400);
        ok++;
        _log('INFO', `SPY dedicated pull: ${history['SPY'].length} history entries`);
      } else {
        _log('WARN', 'SPY dedicated pull returned no quotes');
      }
    } catch (e) {
      _log('WARN', `SPY dedicated pull failed: ${e.message}`);
    }
  }

  fs.writeFileSync(path.join(args.out, `${today}.json`), JSON.stringify(todaysSnapshot, null, 2));
  fs.writeFileSync(histPath, JSON.stringify(history, null, 2));
  _log('INFO', `Done: ${ok}/${wl.stocks.length} ok, ${failed} failed`);
}

main().catch(e => { _log('FATAL', e.stack || e.message); process.exit(1); });
