#!/usr/bin/env node
/**
 * Tag 48 — Aktienfinder-Score-Import
 * Karl exportiert via Bookmarklet eine CSV mit ticker,score (0-10).
 * Dieses Skript merged sie in external-data/aktienfinder.json
 *
 * Usage: node aktienfinder-import.js path/to/aktienfinder.csv
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./lib/atomic-write.js');

function main() {
  const csvPath = process.argv[2];
  if (!csvPath || !fs.existsSync(csvPath)) {
    console.error('Usage: aktienfinder-import.js <csv-path>');
    console.error('CSV format: ticker,score (e.g. "CRDO,8.5")');
    process.exit(1);
  }
  const lines = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const data = {};
  for (const line of lines) {
    if (line.toLowerCase().startsWith('ticker')) continue;  // header
    const [ticker, scoreStr] = line.split(',').map(s => s.trim());
    if (!ticker) continue;
    const score = parseFloat(scoreStr);
    if (isNaN(score)) continue;
    data[ticker.toUpperCase()] = { score, importedAt: new Date().toISOString().slice(0, 10) };
  }
  const outDir = './external-data';
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'aktienfinder.json');
  let existing = {};
  if (fs.existsSync(outPath)) {
    try { existing = JSON.parse(fs.readFileSync(outPath, 'utf8')); } catch (e) { console.warn('Failed to load aktienfinder.json:', e.message); }
  }
  const merged = Object.assign(existing, data);
  writeFileAtomic(outPath, JSON.stringify(merged, null, 2));
  console.log(`✓ Imported ${Object.keys(data).length} aktienfinder scores → ${outPath}`);
  console.log(`  Total stocks tracked: ${Object.keys(merged).length}`);
}
main();
