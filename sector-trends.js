#!/usr/bin/env node
/**
 * Tag 73 — Sektor-Pass-Rate-Trends
 * Liest methods-history/, gruppiert pro Sektor + Run, zeigt Pass-Rate-Trend.
 *
 * Usage: node sector-trends.js [--snapshots ./snapshots]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Runner = require('./methods/runner.js');

function main() {
  const histDir = './methods-history';
  const snapDir = './snapshots';
  if (!fs.existsSync(histDir)) { console.error('No methods-history yet.'); process.exit(1); }

  // Build ticker → sector map from current snapshots
  const tickerToSector = {};
  if (fs.existsSync(snapDir)) {
    const sf = fs.readdirSync(snapDir).filter(f => f.endsWith('.json') && f !== '_manifest.json');
    for (const f of sf) {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(snapDir, f), 'utf8'));
        const t = s.meta && s.meta.ticker;
        if (t) tickerToSector[t] = s.meta.sector || 'Unknown';
      } catch (e) {}
    }
  }

  const histFiles = fs.readdirSync(histDir).filter(f => f.endsWith('.json')).sort();
  if (histFiles.length === 0) { console.error('No history yet.'); process.exit(1); }

  console.log(`Sektor-Pass-Rate-Trends (${histFiles.length} runs):`);
  console.log('═'.repeat(80));

  const sectorTrends = {};  // sector → array of {date, avgPassRate, count}
  for (const f of histFiles) {
    const data = JSON.parse(fs.readFileSync(path.join(histDir, f), 'utf8'));
    const bySec = {};
    for (const [ticker, info] of Object.entries(data.stocks)) {
      const sec = tickerToSector[ticker] || 'Unknown';
      if (!bySec[sec]) bySec[sec] = { totalPass: 0, totalComp: 0, n: 0 };
      bySec[sec].totalPass += info.passing;
      bySec[sec].totalComp += info.computable;
      bySec[sec].n++;
    }
    for (const [sec, d] of Object.entries(bySec)) {
      if (!sectorTrends[sec]) sectorTrends[sec] = [];
      sectorTrends[sec].push({
        date: data.date,
        avgPassRate: d.totalComp > 0 ? (d.totalPass / d.totalComp) : 0,
        count: d.n
      });
    }
  }

  // Print table — date columns
  const dates = histFiles.map(f => f.replace('.json',''));
  console.log('Sector'.padEnd(30) + dates.map(d => d.slice(5)).join('  '));
  for (const sec of Object.keys(sectorTrends).sort()) {
    const trends = sectorTrends[sec];
    const row = dates.map(d => {
      const e = trends.find(t => t.date === d);
      return e ? `${(e.avgPassRate*100).toFixed(0)}%`.padStart(5) : '   — ';
    });
    console.log(sec.padEnd(30) + row.join('  '));
  }
  if (histFiles.length === 1) {
    console.log('\nHinweis: Trends werden mit ≥2 Runs aussagekräftig.');
  }
}
main();
