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
  // audit F-A-2026-06-21: prevent silent total history loss. Previously a
  // JSON.parse failure was swallowed to `existing = {}`, so the merge below
  // wrote ONLY the current CSV and the atomic write durably replaced the
  // (still recoverable) corrupt file with a stripped-down version — destroying
  // all accumulated aktienfinder scores. Now mirror pull-historical-prices.js
  // (F-SC-028): back up the corrupt file, log loudly, and refuse to overwrite
  // unless RESET_AKTIENFINDER=1 is explicitly set.
  let existing = {};
  if (fs.existsSync(outPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    } catch (e) {
      const backup = outPath + '.corrupt.' + Date.now();
      try { fs.copyFileSync(outPath, backup); } catch (_) {}
      console.error('ERROR: aktienfinder.json is corrupt (' + e.message + '). Backup saved to ' + backup);
      if (process.env.RESET_AKTIENFINDER !== '1') {
        console.error('Refusing to overwrite — set RESET_AKTIENFINDER=1 to start fresh.');
        process.exit(1);
      }
      console.warn('RESET_AKTIENFINDER=1 set — proceeding with empty base history.');
    }
  }
  const merged = Object.assign(existing, data);
  writeFileAtomic(outPath, JSON.stringify(merged, null, 2));
  console.log(`✓ Imported ${Object.keys(data).length} aktienfinder scores → ${outPath}`);
  console.log(`  Total stocks tracked: ${Object.keys(merged).length}`);
}
main();
