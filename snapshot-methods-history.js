#!/usr/bin/env node
/**
 * Tag 35 — Methods-History-Snapshot
 * Pro Run: speichert methods-history/YYYY-MM-DD.json mit allen Stock × Methoden Ergebnissen.
 * Über Zeit kummuliert dies → Backtest-Datenbasis.
 *
 * Run: node snapshot-methods-history.js [--snapshots ./snapshots] [--out methods-history/]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Runner = require('./methods/runner.js');

function parseArgs(argv) {
  const args = { snapshots: './snapshots', out: './methods-history' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--snapshots' && argv[i+1]) args.snapshots = argv[++i];
    else if (argv[i] === '--out' && argv[i+1]) args.out = argv[++i];
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.out)) fs.mkdirSync(args.out, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const outFile = path.join(args.out, `${today}.json`);

  const files = fs.readdirSync(args.snapshots).filter(f => f.endsWith('.json') && f !== '_manifest.json');
  const data = { date: today, stocks: {} };
  let allPass = 0, anyComputable = 0;

  for (const file of files) {
    let stock;
    try { stock = JSON.parse(fs.readFileSync(path.join(args.snapshots, file), 'utf8')); }
    catch (e) { continue; }
    const ticker = (stock.meta && stock.meta.ticker) || file.replace(/\.json$/, '');
    const results = Runner.evaluateStock(stock);
    const compact = {};
    let computableCount = 0, passCount = 0;
    for (const [mid, r] of Object.entries(results)) {
      compact[mid] = { value: r.computable ? r.value : null, pass: r.computable ? r.pass : null };
      if (r.computable) computableCount++;
      if (r.computable && r.pass) passCount++;
    }
    data.stocks[ticker] = { results: compact, computable: computableCount, passing: passCount };
    if (computableCount > 0) anyComputable++;
    if (computableCount === Object.keys(results).length && passCount === computableCount) allPass++;
  }
  data.summary = {
    totalStocks: files.length,
    anyComputable, allPass,
    methodCount: Runner.getMethods().length
  };
  fs.writeFileSync(outFile, JSON.stringify(data, null, 2));
  console.log(`✓ History-Snapshot: ${outFile}`);
  console.log(`  ${files.length} stocks, ${anyComputable} mit ≥1 computable, ${allPass} stocks pass alle Methoden`);
}
main();
