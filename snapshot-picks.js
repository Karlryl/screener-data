#!/usr/bin/env node
/**
 * Tag 102g — Walk-Forward Picks-History
 * Friert die aktuellen Mode-Picks ein als JSON in picks-history/YYYY-MM-DD.json
 * Wird im Workflow nach Modes-Report-Generation ausgefuehrt.
 */
'use strict';
const fs = require('fs');
const path = require('path');

// Server-Layout: methods/ enthaelt alle methods + runner + strategy-modes
const Runner = require('./methods/runner.js');
const SM = require('./methods/strategy-modes.js');

function parseArgs(argv) {
  const args = { snapshots: './snapshots', out: './picks-history' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--snapshots' && argv[i+1]) args.snapshots = argv[++i];
    else if (argv[i] === '--out' && argv[i+1]) args.out = argv[++i];
  }
  return args;
}

function loadStocks(dir) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  const stocks = [];
  for (const f of files) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (s && s.meta && s.meta.ticker) stocks.push(s);
    } catch (e) {}
  }
  return stocks;
}

function getMcap(stock) {
  const m = stock.marketCap || (stock.meta && stock.meta.marketCap);
  if (typeof m === 'number') return m;
  if (m && typeof m === 'object' && 'value' in m) return m.value;
  return null;
}

function getProfState(results) {
  const ps = results['profitability-state'];
  return (ps && ps.computable && ps.components && ps.components.state) || 'UNKNOWN';
}

function primaryMetricFor(modeId, results) {
  const sortMethod = (SM.MODES[modeId] && SM.MODES[modeId].defaultSortMethod) || 'rule-of-40';
  const r = results[sortMethod];
  return { id: sortMethod, value: r && r.computable ? r.value : null };
}

function pickStockForMode(stock, modeId) {
  const results = Runner.evaluateStock(stock);
  const ev = SM.evaluateMode(stock, modeId, results);
  if (!ev || !ev.passed) return null;
  return {
    ticker: stock.meta.ticker,
    name: stock.meta.name || '',
    sector: stock.meta.sector || '',
    industry: stock.meta.industry || '',
    profState: getProfState(results),
    primaryMetric: primaryMetricFor(modeId, results),
    marketCap: getMcap(stock),
    mustPassCount: ev.mustPassCount,
    mustTotal: ev.mustTotal
  };
}

function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.out)) fs.mkdirSync(args.out, { recursive: true });
  console.log('Loading snapshots from', args.snapshots);
  const stocks = loadStocks(args.snapshots);
  console.log('  ' + stocks.length + ' stocks loaded');

  const result = {
    asOf: new Date().toISOString(),
    universeSize: stocks.length,
    modes: {},
    benchmarks: ['SPY', 'QQQ', 'IWM']
  };

  for (const modeId of ['HYPERGROWTH', 'QUALITY_COMPOUNDER']) {
    const mode = SM.MODES[modeId];
    if (!mode || mode.enabled === false) { result.modes[modeId] = []; continue; }
    const picks = [];
    for (const stock of stocks) {
      const p = pickStockForMode(stock, modeId);
      if (p) picks.push(p);
    }
    picks.sort((a, b) => {
      const va = a.primaryMetric.value, vb = b.primaryMetric.value;
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return vb - va;
    });
    result.modes[modeId] = picks;
    console.log('  ' + modeId + ': ' + picks.length + ' picks');
  }

  const dateStr = result.asOf.slice(0, 10);
  const outFile = path.join(args.out, dateStr + '.json');
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
  console.log('Written: ' + outFile);
  fs.writeFileSync(path.join(args.out, 'latest.json'), JSON.stringify(result, null, 2));
}

if (require.main === module) main();
module.exports = { pickStockForMode, loadStocks };
