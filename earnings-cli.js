#!/usr/bin/env node
/**
 * Tag 63 — Earnings-CLI
 * Listet stocks mit Earnings in den nächsten N Tagen.
 *
 * Usage: node earnings-cli.js [--days 30]
 */
'use strict';
const fs = require('fs');

let days = 30;
const idx = process.argv.indexOf('--days');
if (idx > 0 && process.argv[idx+1]) days = parseInt(process.argv[idx+1], 10);

if (!fs.existsSync('./earnings-calendar.json')) {
  console.error('No earnings-calendar.json — run pull-earnings-dates.js first.');
  process.exit(1);
}
const cal = JSON.parse(fs.readFileSync('./earnings-calendar.json', 'utf8'));
const today = new Date(); today.setHours(0,0,0,0);
const cutoff = new Date(today.getTime() + days * 86400 * 1000);

const upcoming = [];
for (const [ticker, info] of Object.entries(cal)) {
  if (!info.date) continue;
  const d = new Date(info.date);
  if (d >= today && d <= cutoff) {
    upcoming.push({ ticker, date: info.date, daysAway: Math.round((d - today) / 86400000) });
  }
}
upcoming.sort((a, b) => new Date(a.date) - new Date(b.date));

console.log(`Earnings in den nächsten ${days} Tagen (${upcoming.length} stocks):`);
console.log('─'.repeat(50));
for (const u of upcoming) {
  console.log(`  ${u.date}   ${u.ticker.padEnd(8)}  in ${u.daysAway} Tagen`);
}
