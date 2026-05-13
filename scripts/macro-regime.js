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
 *   { asOf, ticker, regimes: { "YYYY-MM-DD": "BULL"|"BEAR"|"SIDEWAYS" } }
 *
 * Run:
 *   node scripts/macro-regime.js [--history prices/history.json]
 *                                [--out outputs/macro-regime.json]
 *                                [--ticker SPY]
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const PRICES_PATH  = path.join(__dirname, '..', 'prices', 'history.json');
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
  const regimes = {};
  for (let i = 0; i < series.length; i++) {
    if (i < maPeriod - 1) continue; // not enough data yet
    let sum = 0;
    for (let j = i - maPeriod + 1; j <= i; j++) sum += series[j].close;
    const sma = sum / maPeriod;
    const price = series[i].close;
    let regime;
    if (price > sma * BULL_MARGIN) regime = 'BULL';
    else if (price < sma * BEAR_MARGIN) regime = 'BEAR';
    else regime = 'SIDEWAYS';
    regimes[series[i].date] = { regime, price: Math.round(price * 100) / 100, sma200: Math.round(sma * 100) / 100 };
  }
  return regimes;
}

function main() {
  const args = parseArgs(process.argv);
  const history = JSON.parse(fs.readFileSync(args.history, 'utf8'));
  const series = history[args.ticker];

  if (!Array.isArray(series) || series.length === 0) {
    console.error('No price data for ' + args.ticker + ' in ' + args.history);
    process.exit(1);
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
  fs.writeFileSync(args.out, JSON.stringify(out, null, 2));
  console.log('Written: ' + args.out);
}

main();
