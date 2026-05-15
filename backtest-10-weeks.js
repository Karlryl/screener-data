#!/usr/bin/env node
/**
 * Tag 76 — 10-Wochen Approximate Backtest
 *
 * Methodik:
 *   1. Pull historical prices für jeden watchlist stock (365 Tage)
 *   2. Berechne aktuelle Methoden-Werte (proxy für what-we-know)
 *   3. Build cohorts: pass-≥N/total-methods vs. fail
 *   4. Compute 10-week return per cohort
 *   5. Compare: alpha = pass - fail
 *
 * Limitierung: Forward-Looking-Bias. Methoden-Werte sind HEUTE, nicht vor 10w.
 *              Bei stable fundamentals (kein Q-Earnings dazwischen) ist das okay.
 *              Bei volatile Hypergrowth-Earnings könnten Werte gedreht haben.
 *
 * Run: node backtest-10-weeks.js [--threshold-pct 50] [--horizon-days 70]
 */
'use strict';
const fs = require('fs');
let yf;
try {
  const YF = require('yahoo-finance2').default;
  yf = (typeof YF === 'function') ? new YF() : YF;
} catch (e) { console.error('yahoo-finance2 not installed'); process.exit(1); }

const Runner = require('./methods/runner.js');

function parseArgs(argv) {
  const args = { thresholdPct: 50, horizonDays: 70, watchlist: './watchlist.json', rateLimit: 800 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--threshold-pct' && argv[i+1]) args.thresholdPct = parseInt(argv[++i], 10);
    else if (argv[i] === '--horizon-days' && argv[i+1]) args.horizonDays = parseInt(argv[++i], 10);
  }
  return args;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function pullPrices(ticker, daysBack) {
  try {
    const period1 = new Date(Date.now() - (daysBack + 30) * 86400 * 1000);
    const period2 = new Date();
    const r = await yf.chart(ticker, { period1, period2, interval: '1d' });
    return (r.quotes || []).filter(q => q.close != null);
  } catch (e) { return null; }
}

function findClosestPrice(quotes, targetDate) {
  // quotes: array of {date, close}, sorted by date asc
  const target = new Date(targetDate).getTime();
  let best = null;
  let bestDiff = Infinity;
  for (const q of quotes) {
    const d = q.date instanceof Date ? q.date.getTime() : new Date(q.date).getTime();
    const diff = Math.abs(d - target);
    if (diff < bestDiff) { bestDiff = diff; best = q; }
  }
  // Only accept if within 7 days
  return bestDiff <= 7 * 86400 * 1000 ? best : null;
}

async function main() {
  const args = parseArgs(process.argv);
  const wl = JSON.parse(fs.readFileSync(args.watchlist, 'utf8'));
  const today = new Date();
  const targetPast = new Date(Date.now() - args.horizonDays * 86400 * 1000);
  console.log(`10-Wochen-Backtest (${args.horizonDays} Tage)`);
  console.log(`From: ${targetPast.toISOString().slice(0,10)}  To: ${today.toISOString().slice(0,10)}`);
  console.log(`Pass-Threshold: ≥${args.thresholdPct}% der computable methods`);
  console.log('═'.repeat(70));

  const stocks = [];
  for (let i = 0; i < wl.stocks.length; i++) {
    const s = wl.stocks[i];
    process.stdout.write(`[${i+1}/${wl.stocks.length}] ${s.ticker}... `);
    // Get current method evaluation from snapshot
    const snapPath = './snapshots/' + s.ticker + '.json';
    if (!fs.existsSync(snapPath)) { console.log('skip (no snapshot)'); continue; }
    const stockData = JSON.parse(fs.readFileSync(snapPath));
    const r = Runner.evaluateStock(stockData);
    let pass = 0, comp = 0;
    for (const x of Object.values(r)) { if (x.computable) comp++; if (x.computable && x.pass) pass++; }
    if (comp === 0) { console.log('skip (no computable methods)'); continue; }

    // Pull prices
    const quotes = await pullPrices(s.yahoo_symbol, args.horizonDays + 30);
    await sleep(args.rateLimit);
    if (!quotes || quotes.length < 5) { console.log('skip (no prices)'); continue; }

    const startQ = findClosestPrice(quotes, targetPast);
    const endQ = quotes[quotes.length - 1];
    if (!startQ || !endQ) { console.log('skip (no matched prices)'); continue; }
    const ret = (endQ.close - startQ.close) / startQ.close;
    const passRatio = pass / comp;
    stocks.push({ ticker: s.ticker, pass, comp, passRatio, startPrice: startQ.close, endPrice: endQ.close, ret });
    console.log(`${pass}/${comp} pass, ret=${(ret*100).toFixed(1)}%`);
  }

  console.log('\n' + '═'.repeat(70));
  // Cohort splits
  const passCohort = stocks.filter(s => s.passRatio * 100 >= args.thresholdPct);
  const failCohort = stocks.filter(s => s.passRatio * 100 < args.thresholdPct);

  function avgRet(cohort) {
    if (!cohort.length) return null;
    return cohort.reduce((a, b) => a + b.ret, 0) / cohort.length;
  }
  function medianRet(cohort) {
    if (!cohort.length) return null;
    const sorted = cohort.map(c => c.ret).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
  }

  const passAvg = avgRet(passCohort);
  const passMed = medianRet(passCohort);
  const failAvg = avgRet(failCohort);
  const failMed = medianRet(failCohort);

  console.log(`Pass-Cohort (≥${args.thresholdPct}% pass): ${passCohort.length} stocks`);
  if (passAvg != null) console.log(`  Avg return:    ${(passAvg*100).toFixed(2)}%`);
  if (passMed != null) console.log(`  Median return: ${(passMed*100).toFixed(2)}%`);

  console.log(`\nFail-Cohort: ${failCohort.length} stocks`);
  if (failAvg != null) console.log(`  Avg return:    ${(failAvg*100).toFixed(2)}%`);
  if (failMed != null) console.log(`  Median return: ${(failMed*100).toFixed(2)}%`);

  if (passAvg != null && failAvg != null) {
    console.log(`\nAlpha (Pass - Fail, avg): ${((passAvg - failAvg)*100).toFixed(2)}%`);
    console.log(`Alpha (Pass - Fail, median): ${((passMed - failMed)*100).toFixed(2)}%`);
  }

  console.log('\n─── Top 10 Performer ───');
  stocks.sort((a, b) => b.ret - a.ret);
  for (const s of stocks.slice(0, 10)) {
    console.log(`  ${s.ticker.padEnd(8)} ${s.pass}/${s.comp}  ${(s.ret*100).toFixed(1)}%`);
  }
  console.log('\n─── Bottom 10 ───');
  for (const s of stocks.slice(-10).reverse()) {
    console.log(`  ${s.ticker.padEnd(8)} ${s.pass}/${s.comp}  ${(s.ret*100).toFixed(1)}%`);
  }

  // F-BT-002/F-GC-002 (Tag 179): this script evaluates methods on TODAY's snapshot
  // and measures historical returns. That's textbook look-ahead bias — results are
  // optimistic relative to what could've been traded. Stamp the output JSON with
  // an explicit bias flag so any downstream consumer can detect/filter.
  // Save full result
  fs.writeFileSync('./backtest-10w-result.json', JSON.stringify({
    generatedAt: new Date().toISOString(),
    _bias: {
      lookAheadBias: true,
      reason: 'methods evaluated on TODAY snapshot, returns measured retroactively',
      preferredAlternative: 'walk-forward-perf.js (uses frozen vintage methods-history)'
    },
    horizonDays: args.horizonDays,
    thresholdPct: args.thresholdPct,
    stocksTotal: stocks.length,
    passCohortSize: passCohort.length,
    failCohortSize: failCohort.length,
    passAvgReturn: passAvg, passMedianReturn: passMed,
    failAvgReturn: failAvg, failMedianReturn: failMed,
    // F-GC-013 (Tag 179): only compute alpha when both cohorts non-empty.
    alphaAvg: (passAvg != null && failAvg != null && passCohort.length > 0 && failCohort.length > 0) ? passAvg - failAvg : null,
    stocks
  }, null, 2));
  console.log('\n✓ Saved to backtest-10w-result.json');
  console.log('\nLimitierung: Forward-Looking-Bias. Methoden-Werte sind HEUTE.');
  console.log('Bei stable fundamentals (kein Q-Earnings) ist das okay. Bei volatilen Hypergrowth aber nicht.');
}
main();
