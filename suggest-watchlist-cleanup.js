#!/usr/bin/env node
/**
 * Tag 74 — Watchlist-Cleanup-Suggestions
 * Stocks die in den letzten N Runs konstant <X/total pass haben → Kandidaten für Removal.
 *
 * Usage: node suggest-watchlist-cleanup.js [--threshold-pct 30] [--min-runs 3]
 */
'use strict';
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = { thresholdPct: 30, minRuns: 3 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--threshold-pct' && argv[i+1]) args.thresholdPct = parseInt(argv[++i], 10);
    else if (argv[i] === '--min-runs' && argv[i+1]) args.minRuns = parseInt(argv[++i], 10);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const histDir = './methods-history';
  if (!fs.existsSync(histDir)) { console.error('No history.'); process.exit(1); }
  const files = fs.readdirSync(histDir).filter(f => f.endsWith('.json')).sort();
  if (files.length < args.minRuns) {
    console.log(`Need ≥${args.minRuns} runs (got ${files.length}). Skipping.`);
    return;
  }
  // Aggregate per ticker over last min-runs runs
  const recent = files.slice(-args.minRuns);
  const tickerStats = {};
  for (const f of recent) {
    const data = JSON.parse(fs.readFileSync(path.join(histDir, f), 'utf8'));
    for (const [ticker, info] of Object.entries(data.stocks)) {
      if (!tickerStats[ticker]) tickerStats[ticker] = { passes: [], comps: [] };
      tickerStats[ticker].passes.push(info.passing);
      tickerStats[ticker].comps.push(info.computable);
    }
  }
  const candidates = [];
  for (const [ticker, s] of Object.entries(tickerStats)) {
    if (s.passes.length < args.minRuns) continue;
    const totalPass = s.passes.reduce((a, b) => a + b, 0);
    const totalComp = s.comps.reduce((a, b) => a + b, 0);
    const ratio = totalComp > 0 ? totalPass / totalComp : 0;
    if (ratio * 100 < args.thresholdPct) {
      candidates.push({ ticker, ratio, avgPass: totalPass/s.passes.length, avgComp: totalComp/s.comps.length });
    }
  }
  candidates.sort((a, b) => a.ratio - b.ratio);
  console.log(`Cleanup-Candidates: ${candidates.length} stocks mit Pass-Rate < ${args.thresholdPct}% über letzte ${args.minRuns} Runs`);
  console.log('─'.repeat(60));
  for (const c of candidates) {
    console.log(`  ${c.ticker.padEnd(8)} ${c.avgPass.toFixed(1)} / ${c.avgComp.toFixed(1)} avg pass (${(c.ratio*100).toFixed(0)}%)`);
  }
  if (candidates.length === 0) console.log('Keine Kandidaten — alle Stocks sind über der Schwelle.');
  console.log('\nRemove via: node watchlist-cli.js remove TICKER');
}
main();
