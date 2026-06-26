#!/usr/bin/env node
/**
 * Tag 63 — Earnings-Date-Pull
 * Separater Pull für nextEarningsDate jeder Watchlist-Stock.
 * Output: earnings-calendar.json
 */
'use strict';
const fs = require('fs');
// audit/fix: route the persisted-state write through lib/atomic-write (was the only
// production writer doing a plain non-atomic writeFileSync — a SIGTERM/crash mid-write
// corrupted the committed earnings-calendar.json).
const { writeFileAtomic } = require('./lib/atomic-write.js');
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
        // audit F-A-2026-06-21: off-by-one earnings date — toISOString() is UTC, so
        // .slice(0,10) takes the UTC calendar date. A Yahoo earnings timestamp set to a
        // local US exchange date (e.g. evening ET) rolls into the next UTC day, shifting
        // the reported calendar date by ±1. We keep the UTC date string here on purpose so
        // pull and consumer agree on ONE zone: earnings-cli.js parses `info.date` via
        // `new Date(info.date)`, which interprets a bare YYYY-MM-DD as UTC midnight — i.e.
        // the consumer already reads this field as UTC. Emitting the UTC date keeps the
        // two sides internally consistent; switching to a local-zone slice here would
        // silently desync the pull from the UTC-based comparison downstream.
        const iso = (first instanceof Date) ? first.toISOString() : (first && first.raw ? new Date(first.raw * 1000).toISOString() : null);
        if (iso) result[stock.ticker] = { date: iso.slice(0, 10), pulledAt: new Date().toISOString().slice(0, 10) };
      }
    } catch (e) { /* skip */ }

    }
  // audit F-A-2026-06-21: rate-limit burst on fast batches — a fixed post-batch sleep
  // paces by the GAP, not the cadence. When a batch returns fast (cache hits / quick
  // network) CONCURRENCY quoteSummary calls fire, then only 300ms passes before the next
  // CONCURRENCY fire, so Yahoo sees bursts every ~300ms+batchtime. Pace by ELAPSED time:
  // sleep only the remainder of a minimum per-batch interval, so the inter-batch cadence
  // is bounded regardless of how fast the batch itself completed.
  const MIN_BATCH_INTERVAL_MS = 300;
  for (let batchStart = 0; batchStart < wl.stocks.length; batchStart += CONCURRENCY) {
    const batchStartedAt = Date.now();
    const batch = wl.stocks.slice(batchStart, batchStart + CONCURRENCY);
    await Promise.all(batch.map(s => processOne(s).catch(() => {})));
    if (batchStart + CONCURRENCY < wl.stocks.length) {
      const elapsed = Date.now() - batchStartedAt;
      await sleep(Math.max(0, MIN_BATCH_INTERVAL_MS - elapsed));
    }
  }

  // audit/fix: coverage floor — `result` is rebuilt from scratch each run, so a Yahoo
  // outage day (nearly all quoteSummary calls fail) would otherwise atomically replace a
  // good earnings-calendar.json with a near-empty one. Refuse to overwrite a populated
  // calendar with a collapsed result; the existing file is preserved and the run fails loud.
  const have = Object.keys(result).length;
  let prev = 0;
  try { prev = Object.keys(JSON.parse(fs.readFileSync('./earnings-calendar.json', 'utf8'))).length; } catch (_) {}
  if (prev > 100 && have < prev * 0.5) {
    console.error(`::error::earnings coverage collapsed (${have} dates vs prev ${prev}) — refusing to overwrite earnings-calendar.json`);
    process.exit(1);
  }
  writeFileAtomic('./earnings-calendar.json', JSON.stringify(result, null, 2));
  console.log(`✓ Saved earnings-calendar.json (${have} stocks with date)`);
}
// audit F-A-2026-06-21: guard against (1) silent failure — bare main() let a watchlist
// parse error (or any rejection) die as an unhandled rejection that exits 0 on older Node,
// so CI/cron treated a failed pull as success; now it logs and exits non-zero. And
// (2) auto-run-on-require — without the require.main check, merely require()'ing this
// module (e.g. from a test) kicked off a live Yahoo pull.
if (require.main === module) {
  main().catch(e => { console.error('pull-earnings-dates failed:', e.stack || e.message); process.exit(1); });
}

module.exports = { main };
