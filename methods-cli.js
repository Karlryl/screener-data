#!/usr/bin/env node
/**
 * Tag 71 — Methods-CLI
 * Liste/Beschreibung der Methoden + aktuelle Pass-Stats.
 *
 * Usage: node methods-cli.js list
 *        node methods-cli.js describe METHOD-ID
 */
'use strict';
const fs = require('fs');
const Runner = require('./methods/runner.js');

const cmd = process.argv[2];
const arg = process.argv[3];

function getStats(methodId) {
  if (!fs.existsSync('./snapshots')) return null;
  const files = fs.readdirSync('./snapshots').filter(f => f.endsWith('.json') && f !== '_manifest.json');
  let pass = 0, comp = 0, total = files.length;
  const passing = [], failing = [];
  for (const f of files) {
    let stock;
    try { stock = JSON.parse(fs.readFileSync('./snapshots/' + f, 'utf8')); } catch (e) { continue; }
    const r = Runner.evaluateStock(stock)[methodId];
    if (!r.computable) continue;
    comp++;
    if (r.pass) { pass++; passing.push(stock.meta.ticker); }
    else failing.push(stock.meta.ticker);
  }
  return { total, comp, pass, passing, failing };
}

if (cmd === 'list') {
  const ms = Runner.getMethods();
  console.log('Active Methods (' + ms.length + '):');
  console.log('─'.repeat(70));
  for (const m of ms) {
    const stats = getStats(m.id);
    const passInfo = stats ? `(${stats.pass}/${stats.comp} pass)` : '';
    console.log(`  ${m.id.padEnd(28)} ${m.thresholdOp === 'gte' ? '≥' : (m.thresholdOp === 'lte' ? '≤' : '|·|≤')} ${String(m.threshold).padEnd(8)} ${passInfo}`);
  }
} else if (cmd === 'describe' && arg) {
  const m = Runner.getMethods().find(m => m.id === arg);
  if (!m) { console.error('Unknown method: ' + arg); process.exit(1); }
  console.log('Method: ' + m.label + ' (' + m.id + ')');
  console.log('Description: ' + m.description);
  console.log('Threshold: ' + m.thresholdOp + ' ' + m.threshold + ' (unit: ' + m.unit + ')');
  const stats = getStats(m.id);
  if (stats) {
    console.log('');
    console.log('Current Watchlist Stats:');
    console.log('  Computable: ' + stats.comp + ' / ' + stats.total);
    console.log('  Pass: ' + stats.pass + ' (' + (stats.comp ? (stats.pass/stats.comp*100).toFixed(0) : 0) + '%)');
    if (stats.passing.length) {
      console.log('  Passing tickers: ' + stats.passing.slice(0, 15).join(', ') + (stats.passing.length > 15 ? '...' : ''));
    }
  }
} else {
  console.log('Usage:');
  console.log('  node methods-cli.js list           — alle Methoden + Stats');
  console.log('  node methods-cli.js describe ID    — Detail-Beschreibung einer Methode');
}
