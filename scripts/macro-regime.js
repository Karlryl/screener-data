#!/usr/bin/env node
/**
 * Tag 139: Macro-Regime-Tagging
 * ==============================
 * Reads SPY price history from prices/history.json, computes 200-day SMA,
 * classifies each date as BULL / BEAR / SIDEWAYS, and writes
 * outputs/macro-regime.json.
 *
 * Regime rules (standard SPY 200d MA filter):
 *   price >  200d SMA * 1.02  → BULL
 *   price <  200d SMA * 0.98  → BEAR
 *   otherwise                 → SIDEWAYS
 *
 * Output format:
 *   { asOf, ticker, regimes: { "YYYY-MM-DD": { regime: "BULL"|"BEAR"|"SIDEWAYS", price, sma200, _convention } } }
 *   (historisch: bare-string-Werte "BULL"; Leser bleiben tolerant, siehe walk-forward-perf._regimeOf)
 *
 * Run:
 *   node scripts/macro-regime.js [--history prices/history.json]
 *                                [--out outputs/macro-regime.json]
 *                                [--ticker SPY]
 */
'use strict';
const fs   = require('fs');
const path = require('path');
// Tag 218: atomic output writes (audit F-218b-03)
const { writeFileAtomic } = require('../lib/atomic-write.js');
// Tag 294: price history is sharded — load ONLY SPY's shard (no full-store load).
const priceStore = require('../lib/price-history-store.js');

const PRICES_DIR   = path.join(__dirname, '..', 'prices');
const PRICES_PATH  = path.join(PRICES_DIR, 'history.json');
const OUT_PATH     = path.join(__dirname, '..', 'outputs', 'macro-regime.json');
const MA_PERIOD    = 200;
const BULL_MARGIN  = 1.02;
const BEAR_MARGIN  = 0.98;

function parseArgs(argv) {
  const args = { history: PRICES_PATH, out: OUT_PATH, ticker: 'SPY' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--history' && argv[i+1]) args.history = argv[++i];
    else if (argv[i] === '--out'     && argv[i+1]) args.out = argv[++i];
    else if (argv[i] === '--ticker'  && argv[i+1]) args.ticker = argv[++i];
  }
  return args;
}

function computeRegimes(series, maPeriod) {
  // series: [{date, close}, ...] sorted ascending (oldest first)
  // F-SC-001 (Tag 179): regimes[D] previously used SMA from D-199..D INCLUSIVE,
  // i.e. it incorporated day-D's close. Any backtest that filters on regimes[D]
  // before trading on day D would consume future information. New convention:
  // regimes[D] reflects state KNOWABLE AT OPEN OF D — i.e. SMA from D-200..D-1
  // and price = D-1's close. Compatible with walk-forward-perf.getRegimeAt(asOf).
  const regimes = {};
  for (let i = 0; i < series.length; i++) {
    if (i < maPeriod) continue; // need maPeriod prior closes (i-maPeriod .. i-1)
    let sum = 0;
    for (let j = i - maPeriod; j < i; j++) sum += series[j].close;
    const sma = sum / maPeriod;
    const price = series[i - 1].close;  // last *prior* close, not today's
    let regime;
    if (price > sma * BULL_MARGIN) regime = 'BULL';
    else if (price < sma * BEAR_MARGIN) regime = 'BEAR';
    else regime = 'SIDEWAYS';
    regimes[series[i].date] = { regime, price: Math.round(price * 100) / 100, sma200: Math.round(sma * 100) / 100, _convention: 'sma=t-200..t-1, price=t-1' };
  }
  return regimes;
}

// audit F-A-2026-06-21: write the present-but-empty regime output and exit 0,
// so a missing/corrupt prices file degrades gracefully instead of throwing and
// failing the daily-pull workflow step.
function writeEmptyFallback(args) {
  const outDir = path.dirname(args.out);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  writeFileAtomic(args.out, JSON.stringify({
    asOf: new Date().toISOString(),
    ticker: args.ticker,
    error: 'no_price_data',
    regimes: {},
    summary: { total: 0, BULL: 0, BEAR: 0, SIDEWAYS: 0 },
    current: null
  }));
}

function main() {
  const args = parseArgs(process.argv);
  // audit F-A-2026-06-21: unguarded JSON.parse of a missing/corrupt prices file
  // threw and failed the daily-pull job. Guard the read+parse and on failure emit
  // the same empty fallback the empty-series branch produces, then exit 0.
  // Tag 294: load only the shard that holds this ticker (SPY by default) instead
  // of the whole store. `--history` may be a shard dir or the legacy file path;
  // derive the prices dir either way. Legacy-Fallback lives in loadShard/loadAll.
  const pricesDir = args.history.endsWith('.json') ? path.dirname(args.history) : args.history;
  let series;
  try {
    series = priceStore.loadShard(pricesDir, priceStore.shardOf(args.ticker))[args.ticker];
    // pre-migration window: no shards yet → loadShard returned {} → read legacy
    if (series === undefined) series = priceStore.loadAll(pricesDir)[args.ticker];
  } catch (e) {
    console.error('[macro-regime] cannot read/parse price history in ' + pricesDir + ': ' + e.message + ' — writing empty fallback');
    writeEmptyFallback(args);
    console.log('No price data for ' + args.ticker + ' — wrote empty fallback to ' + args.out);
    process.exit(0);
  }

  if (!Array.isArray(series) || series.length === 0) {
    writeEmptyFallback(args);
    console.log('No price data for ' + args.ticker + ' — wrote empty fallback to ' + args.out);
    process.exit(0);
  }

  // Sort ascending by date
  const sorted = series.slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  console.log(args.ticker + ': ' + sorted.length + ' price points');
  console.log('Date range: ' + sorted[0].date + ' to ' + sorted[sorted.length - 1].date);

  const regimes = computeRegimes(sorted, MA_PERIOD);
  const dates = Object.keys(regimes);
  const counts = { BULL: 0, BEAR: 0, SIDEWAYS: 0 };
  for (const v of Object.values(regimes)) counts[v.regime]++;

  console.log('Regime dates computed: ' + dates.length);
  console.log('  BULL: ' + counts.BULL + ', BEAR: ' + counts.BEAR + ', SIDEWAYS: ' + counts.SIDEWAYS);

  const out = {
    asOf: new Date().toISOString(),
    ticker: args.ticker,
    maPeriod: MA_PERIOD,
    regimeCounts: counts,
    regimes
  };

  const outDir = path.dirname(args.out);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  writeFileAtomic(args.out, JSON.stringify(out, null, 2));
  console.log('Written: ' + args.out);
}

main();
