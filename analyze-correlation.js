#!/usr/bin/env node
/**
 * Tag 58 — Method-Correlation-Analyse
 * Pairwise Pearson correlation zwischen allen Methoden über aktuelle Snapshots.
 * Zeigt potenziell redundante Method-Pairs (|corr| > 0.8).
 */
'use strict';
const fs = require('fs');
const Runner = require('./methods/runner.js');

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const meanX = xs.reduce((a,b)=>a+b,0)/n;
  const meanY = ys.reduce((a,b)=>a+b,0)/n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX, dy = ys[i] - meanY;
    num += dx*dy; denX += dx*dx; denY += dy*dy;
  }
  if (denX === 0 || denY === 0) return null;
  return num / Math.sqrt(denX * denY);
}

const files = fs.readdirSync('./snapshots').filter(f => f.endsWith('.json') && f !== '_manifest.json');
const methods = Runner.getMethods();
const valuesByMethod = {};
for (const m of methods) valuesByMethod[m.id] = [];

const tickerOrder = [];
for (const f of files) {
  let stock;
  try { stock = JSON.parse(fs.readFileSync('./snapshots/' + f, 'utf8')); } catch (e) { continue; }
  tickerOrder.push(stock.meta && stock.meta.ticker);
  const r = Runner.evaluateStock(stock);
  for (const m of methods) {
    // F-GC-011 (Tag 185): null-check res. If a method threw and runner didn't
    // populate r[m.id], res.computable would crash. Treat missing entries as null.
    const res = r[m.id];
    valuesByMethod[m.id].push((res && res.computable) ? res.value : null);
  }
}

// Compute correlation matrix
const ids = methods.map(m => m.id);
console.log('Method-Correlation-Matrix (Pearson, |r| > 0.8 = potenzielle Redundanz)');
console.log('═'.repeat(80));

const high = [];
for (let i = 0; i < ids.length; i++) {
  for (let j = i+1; j < ids.length; j++) {
    const a = valuesByMethod[ids[i]], b = valuesByMethod[ids[j]];
    // Filter to pairs where both computable
    const xs = [], ys = [];
    for (let k = 0; k < a.length; k++) {
      if (a[k] != null && b[k] != null && Number.isFinite(a[k]) && Number.isFinite(b[k])) {
        xs.push(a[k]); ys.push(b[k]);
      }
    }
    if (xs.length < 5) continue;
    const r = pearson(xs, ys);
    if (r == null) continue;
    if (Math.abs(r) > 0.8) {
      high.push({ a: ids[i], b: ids[j], r, n: xs.length });
    }
  }
}
high.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));

if (high.length === 0) {
  console.log('Keine starke Korrelation (|r| > 0.8) gefunden.');
} else {
  console.log('| Method A | Method B | Pearson r | n |');
  console.log('|----------|----------|-----------|---|');
  for (const h of high) {
    console.log(`| ${h.a.padEnd(25)} | ${h.b.padEnd(25)} | ${h.r.toFixed(3).padStart(7)} | ${h.n} |`);
  }
}
