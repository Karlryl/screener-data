#!/usr/bin/env node
/**
 * Tag 35 — History-CLI: lookup historische Methoden-Werte für einen Stock.
 *
 * Usage: node history-cli.js TICKER [--methods ./methods-history]
 */
'use strict';
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = { methods: './methods-history' };
  args.ticker = (argv[2] || '').toUpperCase();
  for (let i = 3; i < argv.length; i++) {
    if (argv[i] === '--methods' && argv[i+1]) args.methods = argv[++i];
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.ticker) { console.error('Usage: history-cli.js TICKER'); process.exit(1); }
  if (!fs.existsSync(args.methods)) { console.error(`No history at ${args.methods}`); process.exit(1); }
  const files = fs.readdirSync(args.methods).filter(f => f.endsWith('.json')).sort();
  if (!files.length) { console.error('No history files'); process.exit(1); }
  console.log(`History für ${args.ticker} (${files.length} Runs):`);
  console.log('─'.repeat(80));
  // Build matrix: dates × methods
  const allDates = files.map(f => f.replace('.json', ''));
  const methodValues = {};
  for (const f of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(args.methods, f), 'utf8'));
      const stockData = data.stocks[args.ticker];
      if (!stockData) continue;
      for (const [mid, r] of Object.entries(stockData.results)) {
        methodValues[mid] = methodValues[mid] || {};
        methodValues[mid][data.date] = r;
      }
    } catch (e) { /* skip */ }
  }
  // Print table
  console.log('Method               ' + allDates.map(d => d.slice(5)).join('  '));
  for (const [mid, byDate] of Object.entries(methodValues)) {
    const row = allDates.map(d => {
      const v = byDate[d];
      if (!v || v.value == null) return '   —  ';
      const passSym = v.pass === true ? '✓' : (v.pass === false ? '✗' : '?');
      return `${v.value.toFixed(1).padStart(5)}${passSym}`;
    });
    console.log(mid.padEnd(20) + row.join(' '));
  }
}
main();
