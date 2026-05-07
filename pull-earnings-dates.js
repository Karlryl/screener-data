#!/usr/bin/env node
/**
 * Tag 63 — Earnings-Date-Pull
 * Separater Pull für nextEarningsDate jeder Watchlist-Stock.
 * Output: earnings-calendar.json
 */
'use strict';
const fs = require('fs');
let yf;
try {
  const YF = require('yahoo-finance2').default;
  yf = (typeof YF === 'function') ? new YF() : YF;
} catch (e) { console.error('yahoo-finance2 not installed'); process.exit(1); }

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const wl = JSON.parse(fs.readFileSync('./watchlist.json', 'utf8'));
  const result = {};
  for (const stock of wl.stocks) {
    try {
      const r = await yf.quoteSummary(stock.yahoo_symbol, { modules: ['calendarEvents'] });
      const d = r.calendarEvents && r.calendarEvents.earnings && r.calendarEvents.earnings.earningsDate;
      if (d) {
        const arr = Array.isArray(d) ? d : [d];
        const first = arr[0];
        const iso = (first instanceof Date) ? first.toISOString() : (first && first.raw ? new Date(first.raw * 1000).toISOString() : null);
        if (iso) result[stock.ticker] = { date: iso.slice(0, 10), pulledAt: new Date().toISOString().slice(0, 10) };
      }
    } catch (e) { /* skip */ }
    await sleep(800);
  }
  fs.writeFileSync('./earnings-calendar.json', JSON.stringify(result, null, 2));
  console.log(`✓ Saved earnings-calendar.json (${Object.keys(result).length} stocks with date)`);
}
main();
