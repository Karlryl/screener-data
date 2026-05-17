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
  // Tag 211m: silence schema-validation log spam (Tag 211c sibling fix).
  yf = (typeof YF === 'function')
    ? new YF({ validation: { logErrors: false, logOptionsErrors: false } })
    : YF;
} catch (e) { console.error('yahoo-finance2 not installed'); process.exit(1); }

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const wl = JSON.parse(fs.readFileSync('./watchlist.json', 'utf8'));
  const result = {};
  // Tag-86: parallel earnings pulls
  const CONCURRENCY = parseInt(process.env.EARNINGS_CONCURRENCY || '15', 10);
  async function processOne(stock) {

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

    }
  for (let batchStart = 0; batchStart < wl.stocks.length; batchStart += CONCURRENCY) {
    const batch = wl.stocks.slice(batchStart, batchStart + CONCURRENCY);
    await Promise.all(batch.map(s => processOne(s).catch(() => {})));
    if (batchStart + CONCURRENCY < wl.stocks.length) {
      await sleep(300);
    }
  }

  fs.writeFileSync('./earnings-calendar.json', JSON.stringify(result, null, 2));
  console.log(`✓ Saved earnings-calendar.json (${Object.keys(result).length} stocks with date)`);
}
main();
