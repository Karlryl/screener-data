#!/usr/bin/env node
/**
 * Tag 102h — Level-2 Pseudo-Backtest (Look-Back-Sanity)
 * ======================================================
 * Nimmt die heutigen Mode-Picks (aus picks-history/latest.json) und berechnet
 * Total-Return über 1Y / 3Y / 5Y aus Yahoo historicalPrice.
 *
 * Vergleicht mit Benchmark (SPY default) und gibt Median + Outperformance.
 *
 * LIMITS (ehrlich):
 *   - Survivorship-Bias: Nur heute existierende Stocks. Delistete fehlen.
 *     → Ergebnisse OVERSTATEN tatsächliche Methodik-Performance.
 *   - Look-Ahead-Bias: Heutige Fundamentals, nicht damalige.
 *     → "Hypergrowth heute" ≠ "Hypergrowth damals".
 *   - Aussagewert: Sanity-Check — kein Beweis.
 *     → Wenn Median-Picks systematisch LANGSAMER als Benchmark wachsen,
 *       ist Methodik vermutlich Müll. Umgekehrt sagt's wenig.
 *
 * Input:  picks-history/latest.json + Yahoo historicalPrice
 * Output: picks-history/lookback-YYYY-MM-DD.json + console-Report
 */
'use strict';
const fs = require('fs');
const path = require('path');
let yf = null;
try { yf = require('yahoo-finance2').default; }
catch (e) { console.error('yahoo-finance2 nicht installiert:', e.message); process.exit(1); }

function parseArgs(argv) {
  const args = { picks: './picks-history/latest.json', out: './picks-history', benchmark: 'SPY', topN: 30 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--picks' && argv[i+1]) args.picks = argv[++i];
    else if (argv[i] === '--out' && argv[i+1]) args.out = argv[++i];
    else if (argv[i] === '--benchmark' && argv[i+1]) args.benchmark = argv[++i];
    else if (argv[i] === '--top' && argv[i+1]) args.topN = parseInt(argv[++i]);
  }
  return args;
}

async function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function totalReturn(symbol, lookbackYears) {
  const now = new Date();
  const past = new Date(now);
  past.setFullYear(past.getFullYear() - lookbackYears);
  try {
    const hist = await yf.historical(symbol, { period1: past, period2: now, interval: '1mo' });
    if (!Array.isArray(hist) || hist.length < 2) return null;
    const first = hist[0].adjClose || hist[0].close;
    const last = hist[hist.length - 1].adjClose || hist[hist.length - 1].close;
    if (!first || !last) return null;
    return (last / first - 1) * 100;
  } catch (e) { return null; }
}

function median(arr) {
  const v = arr.filter(x => Number.isFinite(x)).slice().sort((a,b)=>a-b);
  if (v.length === 0) return null;
  return v.length % 2 === 0 ? (v[v.length/2-1] + v[v.length/2]) / 2 : v[(v.length-1)/2];
}

function pct(v) { return v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%'; }

async function processMode(modeId, picks, benchmark, topN) {
  const top = picks.slice(0, topN);
  console.log(`\n━━━ ${modeId} — Top-${top.length} Picks ━━━`);
  const stats = { mode: modeId, count: top.length, benchmarks: {}, picks: [] };
  for (const lookback of [1, 3, 5]) {
    const returns = [];
    for (const p of top) {
      const r = await totalReturn(p.ticker, lookback);
      returns.push(r);
      await _sleep(150);
    }
    const med = median(returns);
    const computed = returns.filter(x => Number.isFinite(x)).length;
    stats[`r${lookback}y`] = { median: med, count: computed, total: top.length };
    console.log(`  ${lookback}Y median: ${pct(med)} (${computed}/${top.length} computable)`);
  }
  // Benchmark
  for (const lookback of [1, 3, 5]) {
    const r = await totalReturn(benchmark, lookback);
    stats.benchmarks[`${benchmark}_${lookback}y`] = r;
    console.log(`  ${benchmark} ${lookback}Y: ${pct(r)}`);
  }
  // Outperformance
  for (const lookback of [1, 3, 5]) {
    const m = stats[`r${lookback}y`].median;
    const b = stats.benchmarks[`${benchmark}_${lookback}y`];
    if (m != null && b != null) {
      const op = m - b;
      console.log(`  → Outperformance vs ${benchmark} (${lookback}Y): ${pct(op)}${op > 0 ? ' ✓' : ' ✗'}`);
      stats[`outperf${lookback}y`] = op;
    }
  }
  // Per-pick
  for (const p of top) {
    const row = { ticker: p.ticker, name: p.name, profState: p.profState, sector: p.sector };
    for (const lb of [1, 3, 5]) {
      const r = await totalReturn(p.ticker, lb);
      row[`r${lb}y`] = r;
      await _sleep(120);
    }
    stats.picks.push(row);
  }
  return stats;
}

async function main() {
  const args = parseArgs(process.argv);
  console.log('Loading picks from', args.picks);
  const picks = JSON.parse(fs.readFileSync(args.picks, 'utf8'));
  console.log('  asOf: ' + picks.asOf);
  console.log('  universe: ' + picks.universeSize);

  const out = { asOf: picks.asOf, runAt: new Date().toISOString(), benchmark: args.benchmark, modes: {} };

  for (const modeId of Object.keys(picks.modes)) {
    if (!picks.modes[modeId] || picks.modes[modeId].length === 0) continue;
    out.modes[modeId] = await processMode(modeId, picks.modes[modeId], args.benchmark, args.topN);
  }

  const dateStr = (picks.asOf || new Date().toISOString()).slice(0, 10);
  const outFile = path.join(args.out, 'lookback-' + dateStr + '.json');
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log('\nWritten: ' + outFile);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { totalReturn };
