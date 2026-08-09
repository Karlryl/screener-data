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

// audit fix BH-057: quoteSummary has no per-call timeout (undici's ~300s default
// header/body timeout is the only ceiling), so one non-responding call can occupy its
// Promise.all batch far longer than the batch pacing intends. Race it against a short
// local timeout so a hung call fails fast and frees its batch slot. Pure/generic —
// exported for TDD.
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`quoteSummary timeout after ${ms}ms`)), ms)),
  ]);
}

// audit fix BH-055/BH-056: pure decision — what earnings-calendar.json entry (if any) to
// write for a ticker this run, given its previous entry, this run's parsed date (or null
// on a failed/timed-out call), today, and the rollover-grace window. Extracted for TDD
// (repo pattern, see pull-yahoo.js needsFullPull/shouldRetryKosdaq).
//   BH-056: newDate === null (the call failed) => carry the previous entry forward
//     instead of losing a known date to a merely transient error.
//   BH-055: Yahoo can roll calendarEvents to the next quarter the same day it reports.
//     If that just happened — old date in the past, new date in the future — keep
//     serving the old (just-passed) date for `graceDays` so the report stays visible to
//     needsFullPull() (pull-yahoo.js:3176) instead of vanishing behind the future
//     rollover before a full pull ever fires. Bounded by the 30-day
//     FUNDAMENTALS_REFRESH_DAYS sweep either way, so a short window is enough.
function resolveEntry(prevEntry, newDate, today, graceDays) {
  if (!newDate) return prevEntry || null;
  const prevDate = prevEntry && prevEntry.date;
  let date = newDate;
  if (prevDate && prevDate < today && newDate > today) {
    const daysSincePrev = (new Date(today).getTime() - new Date(prevDate).getTime()) / 86400000;
    if (daysSincePrev <= graceDays) date = prevDate;
  }
  return { date, pulledAt: today };
}

function loadPreviousCalendar(filePath = './earnings-calendar.json') {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('ungueltiges Kalenderformat');
    return parsed;
  }
  catch (e) {
    if (e && e.code === 'ENOENT') return {};
    throw new Error(`earnings-calendar.json ist unlesbar: ${e && e.message || e}`);
  }
}

function carryEntryWithoutDate(prevEntry, today, graceDays) {
  return resolveEntry(prevEntry, null, today, graceDays);
}

// Nachzug Tag 622 (Review-Fund MITTEL): Frist per env verstellbar, Muster der
// Nachbar-Konstanten (EARNINGS_CONCURRENCY etc.) — sie haengt an
// FUNDAMENTALS_REFRESH_DAYS in pull-yahoo.js, das ebenfalls env-uebersteuerbar ist.
function isFreshEntry(entry, today, maxCarryDays = parseInt(process.env.EARNINGS_CARRY_FRESH_DAYS || '30', 10)) {
  if (!entry || !entry.pulledAt) return false;
  const age = (new Date(today).getTime() - new Date(entry.pulledAt).getTime()) / 86400000;
  return Number.isFinite(age) && age <= maxCarryDays;
}

async function main() {
  const wl = JSON.parse(fs.readFileSync('./watchlist.json', 'utf8'));
  // audit fix BH-055/BH-056: load the previous calendar once, up front — fed into
  // resolveEntry() above, and reused below for the collapse-guard count instead of a
  // second read.
  let prevCalendar;
  try { prevCalendar = loadPreviousCalendar(); }
  catch (e) {
    console.error(`::error::${e.message} — Bestand bleibt unangetastet`);
    process.exitCode = 1;
    return;
  }
  const result = {};
  let noDateCount = 0;
  // Tag-86: parallel earnings pulls
  const CONCURRENCY = parseInt(process.env.EARNINGS_CONCURRENCY || '15', 10);
  const ROLLOVER_GRACE_DAYS = parseInt(process.env.EARNINGS_ROLLOVER_GRACE_DAYS || '3', 10);
  const QUOTE_TIMEOUT_MS = parseInt(process.env.EARNINGS_QUOTE_TIMEOUT_MS || '20000', 10);
  async function processOne(stock) {
    const today = new Date().toISOString().slice(0, 10);
    try {
      const r = await withTimeout(yf.quoteSummary(stock.yahoo_symbol, { modules: ['calendarEvents'] }), QUOTE_TIMEOUT_MS);
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
        if (iso) {
          result[stock.ticker] = resolveEntry(prevCalendar[stock.ticker], iso.slice(0, 10), today, ROLLOVER_GRACE_DAYS);
        }
      } else {
        noDateCount++;
        const entry = carryEntryWithoutDate(prevCalendar[stock.ticker], today, ROLLOVER_GRACE_DAYS);
        if (entry) result[stock.ticker] = entry;
      }
    } catch (e) {
      // audit fix BH-056: a failed/timed-out call previously vanished the ticker from the
      // rebuilt-from-scratch `result`, silently dropping a known earnings date (and its
      // full-pull trigger) on a merely transient error.
      const entry = resolveEntry(prevCalendar[stock.ticker], null, today, ROLLOVER_GRACE_DAYS);
      if (entry) result[stock.ticker] = entry;
    }
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
  // The floor is max(1, prev*0.5) WITHOUT a `prev > 100` precondition: the earlier
  // `prev > 100` gate left two holes — (a) a small prior calendar (prev<=100) was unprotected,
  // and (b) a fresh/missing/corrupt prior (prev=0) let a total-outage empty result through and
  // exit 0. Now prev=0 blocks only a literally-empty result (have<1) so legitimate first runs
  // still write, while any populated prior is protected against a >50% collapse.
  const today = new Date().toISOString().slice(0, 10);
  const staleCarryCount = Object.values(result).filter(entry => !isFreshEntry(entry, today)).length;
  const have = Object.values(result).filter(entry => isFreshEntry(entry, today)).length;
  const prev = Object.values(prevCalendar).filter(entry => isFreshEntry(entry, today)).length;
  if (noDateCount > 0) console.warn(`::warning::${noDateCount} erfolgreiche Yahoo-Antworten ohne earningsDate; vorhandene Eintraege wurden weitergetragen`);
  if (staleCarryCount > 0) console.warn(`::warning::${staleCarryCount} weitergetragene Earnings-Eintraege sind aelter als 30 Tage und zaehlen nicht als frisch gedeckt`);
  if (have < Math.max(1, prev * 0.5)) {
    console.error(`::error::earnings coverage collapsed (${have} dates vs prev ${prev}) — refusing to overwrite earnings-calendar.json`);
    process.exit(1);
  }
  writeFileAtomic('./earnings-calendar.json', JSON.stringify(result, null, 2));
  console.log(`✓ Saved earnings-calendar.json (${Object.keys(result).length} stocks with date; ${have} frisch gedeckt)`);
}
// audit F-A-2026-06-21: guard against (1) silent failure — bare main() let a watchlist
// parse error (or any rejection) die as an unhandled rejection that exits 0 on older Node,
// so CI/cron treated a failed pull as success; now it logs and exits non-zero. And
// (2) auto-run-on-require — without the require.main check, merely require()'ing this
// module (e.g. from a test) kicked off a live Yahoo pull.
if (require.main === module) {
  main().catch(e => { console.error('pull-earnings-dates failed:', e.stack || e.message); process.exit(1); });
}

module.exports = { main, resolveEntry, withTimeout, loadPreviousCalendar, isFreshEntry, carryEntryWithoutDate };
