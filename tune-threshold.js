#!/usr/bin/env node
/**
 * Tag 59 — Threshold-Tuning-CLI
 * Für eine Methode zeigt Pass-Count bei verschiedenen Threshold-Werten.
 *
 * Usage: node tune-threshold.js METHOD-ID [--steps 10] [--range +-50%]
 * Example: node tune-threshold.js roic
 */
'use strict';
const fs = require('fs');
const Runner = require('./methods/runner.js');

const methodId = process.argv[2];
if (!methodId) {
  console.error('Usage: tune-threshold.js METHOD-ID');
  console.error('Available methods: ' + Runner.getMethods().map(m => m.id).join(', '));
  process.exit(1);
}
const method = Runner.getMethods().find(m => m.id === methodId);
if (!method) {
  console.error(`Unknown method: ${methodId}`);
  console.error('Available: ' + Runner.getMethods().map(m => m.id).join(', '));
  process.exit(1);
}

const files = fs.readdirSync('./snapshots').filter(f => f.endsWith('.json') && f !== '_manifest.json');
const values = [];
for (const f of files) {
  let stock;
  try { stock = JSON.parse(fs.readFileSync('./snapshots/' + f, 'utf8')); } catch (e) { continue; }
  const r = Runner.evaluateStock(stock)[methodId];
  if (r.computable && r.value != null && Number.isFinite(r.value)) {
    values.push({ ticker: stock.meta && stock.meta.ticker, value: r.value });
  }
}

if (values.length === 0) {
  console.log(`No computable values for ${methodId}`);
  process.exit(1);
}

values.sort((a, b) => a.value - b.value);
const minV = values[0].value, maxV = values[values.length-1].value;

// Build threshold sweep around current default
const defaultT = method.threshold;
const op = method.thresholdOp;
const sweep = [];
for (let pct = -50; pct <= 50; pct += 10) {
  const t = defaultT * (1 + pct/100);
  let pass = 0;
  for (const v of values) {
    const ok = (op === 'gte') ? v.value >= t : (op === 'lte') ? v.value <= t : Math.abs(v.value) <= t;
    if (ok) pass++;
  }
  sweep.push({ threshold: t, pct, pass, ratio: pass / values.length });
}

console.log(`Threshold-Sweep: ${method.label} (${methodId})`);
console.log(`Default threshold: ${defaultT} (${op}). Computable: ${values.length}/${files.length} stocks.`);
console.log(`Value range: min=${minV.toFixed(3)}, max=${maxV.toFixed(3)}, median=${values[Math.floor(values.length/2)].value.toFixed(3)}`);
console.log('─'.repeat(60));
console.log('Threshold     %     Pass-Count   Pass-Rate');
for (const s of sweep) {
  const marker = s.pct === 0 ? ' ← default' : '';
  console.log(`${s.threshold.toFixed(3).padStart(8)}   ${(s.pct >= 0 ? '+' : '') + s.pct + '%'}   ${s.pass.toString().padStart(3)} / ${values.length}   ${(s.ratio*100).toFixed(0)}%${marker}`);
}
