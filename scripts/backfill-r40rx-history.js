#!/usr/bin/env node
/**
 * Historical R40/RX Backfill from Annual Data
 * =============================================
 * Generates approximate annual historical R40/RX entries from each stock's
 * annual data arrays. Provides 4-5 years of point-in-time annual snapshots
 * so the "R40/RX Historie" table is populated without waiting for daily
 * forward-banking snapshots.
 *
 * Algorithm (per stock):
 *   annualRev[i], annualFCF[i] — index 0 = most recent fiscal year
 *   For i = 0..min(len-2, 4):
 *     revGrowth  = (annualRev[i] - annualRev[i+1]) / |annualRev[i+1]| * 100
 *     fcfMargin  = annualFCF[i] != null ? (annualFCF[i] / annualRev[i]) * 100 : null
 *     r40        = revGrowth + (fcfMargin || 0)
 *     rx         = 1.5 * revGrowth + (fcfMargin || 0)
 *     quarter    = "${currentYear - 1 - i}-Q4"   (annual approximation;
 *                  annualRev[0] is last COMPLETED fiscal year, not the future)
 *     date       = "${currentYear - 1 - i}-12-31"
 *   Skips: null revenue, zero prior-year revenue, |revGrowth| > 500
 *
 * Merge policy: drops ALL existing 'annual-backfill' entries (their quarter labels
 * may be stale from prior buggy runs) and rewrites them from current annual data.
 * TTM entries from snapshot-r40rx-history.js are preserved; if a TTM entry and a
 * backfill entry collide on the same quarter, TTM wins. Safe to re-run.
 *
 * FCF source tag: "annual-backfill" — UI renders ~ prefix for approximate entries.
 *
 * Run: node scripts/backfill-r40rx-history.js [--snapshots ./snapshots] [--out ./r40rx-history]
 */
'use strict';
const fs   = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../lib/atomic-write.js');
const { SCHEMA_VERSION, MAX_QUARTERS } = require('./snapshot-r40rx-history.js');

const CURRENT_YEAR = new Date().getUTCFullYear();
const MAX_YEARS    = 4;                 // look back at most 4 completed years
const GROWTH_CAP   = 500;              // skip obviously-garbage data

function parseArgs(argv) {
  const args = { snapshots: './snapshots', out: './r40rx-history' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--snapshots' && argv[i + 1]) args.snapshots = argv[++i];
    else if (argv[i] === '--out'       && argv[i + 1]) args.out       = argv[++i];
  }
  return args;
}

/** Unwrap Yahoo-finance snapshot value: { value: N } | N | null → number|null */
function unwrap(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && Number.isFinite(v.value)) return v.value;
  return null;
}

function readHistoryFile(outDir, ticker) {
  const file = path.join(outDir, ticker + '.json');
  if (!fs.existsSync(file)) return { ticker, schemaVersion: SCHEMA_VERSION, entries: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION) {
      return { ticker, schemaVersion: SCHEMA_VERSION, entries: [] };
    }
    return { ticker, schemaVersion: SCHEMA_VERSION, entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
  } catch (e) {
    return { ticker, schemaVersion: SCHEMA_VERSION, entries: [] };
  }
}

/**
 * Compute historical entries from annual arrays.
 * Returns an array of entry objects (may be empty).
 */
function computeAnnualEntries(stock) {
  const annual = stock.annual || {};
  const rawRev = Array.isArray(annual.annualRev) ? annual.annualRev : [];
  const rawFCF = Array.isArray(annual.annualFCF) ? annual.annualFCF : [];

  const annualRev = rawRev.map(unwrap);
  const annualFCF = rawFCF.map(unwrap);

  const entries = [];
  const maxI = Math.min(annualRev.length - 2, MAX_YEARS - 1);

  for (let i = 0; i <= maxI; i++) {
    const rev     = annualRev[i];
    const revPrior = annualRev[i + 1];

    // Guard: need valid revenue in both years
    if (rev == null || revPrior == null || revPrior === 0) continue;

    const revGrowth = (rev - revPrior) / Math.abs(revPrior) * 100;

    // Guard: skip garbage / placeholder data
    if (Math.abs(revGrowth) > GROWTH_CAP) continue;

    const fcf       = annualFCF[i] != null ? annualFCF[i] : null;
    const fcfMargin = (fcf != null && rev !== 0) ? (fcf / rev) * 100 : null;

    const g   = Math.round(revGrowth * 10) / 10;
    const fm  = fcfMargin != null ? Math.round(fcfMargin * 10) / 10 : null;
    const r40 = Math.round((g + (fm != null ? fm : 0)) * 10) / 10;
    const rx  = Math.round((1.5 * g + (fm != null ? fm : 0)) * 10) / 10;

    // annualRev[0] is the most recently REPORTED fiscal year (last COMPLETED year),
    // never the current/future year. So i=0 → CURRENT_YEAR - 1.
    const year    = CURRENT_YEAR - 1 - i;
    const quarter = year + '-Q4';
    const date    = year + '-12-31';

    entries.push({
      quarter,
      date,
      r40,
      rx,
      growth: g,
      fcfMargin: fm,
      fcfMarginSource: 'annual-backfill'
    });
  }

  return entries;
}

async function loadSnapshotsAsync(dir) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  const BATCH  = 32;
  const stocks = [];
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const loaded = await Promise.all(batch.map(async f => {
      try {
        const raw   = await fs.promises.readFile(path.join(dir, f), 'utf8');
        const stock = JSON.parse(raw);
        return (stock && stock.meta && stock.meta.ticker) ? stock : null;
      } catch (e) { return null; }
    }));
    stocks.push(...loaded.filter(Boolean));
  }
  return stocks;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.out)) fs.mkdirSync(args.out, { recursive: true });

  if (!fs.existsSync(args.snapshots)) {
    console.error('[backfill] snapshots dir not found: ' + args.snapshots);
    process.exit(1);
  }

  console.log('[backfill] loading snapshots from ' + args.snapshots + ' ...');
  const stocks = await loadSnapshotsAsync(args.snapshots);
  console.log('[backfill] stocks=' + stocks.length);

  let written = 0, skipped = 0, failed = 0;

  for (const stock of stocks) {
    const ticker = stock.meta && stock.meta.ticker;
    if (!ticker) { skipped++; continue; }

    try {
      const entries = computeAnnualEntries(stock);
      if (entries.length === 0) { skipped++; continue; }

      const history = readHistoryFile(args.out, ticker);

      // Drop ALL existing backfill entries (they may have stale/buggy quarter labels);
      // preserve TTM entries from live snapshot-r40rx-history runs.
      // (null source = legacy entry from before the source tag existed → treat as TTM)
      const preservedEntries = (history.entries || []).filter(e =>
        e.fcfMarginSource === 'TTM' || !e.fcfMarginSource
      );

      // Merge preserved TTM + freshly computed backfill; dedupe by quarter,
      // with TTM winning over backfill when both exist for the same quarter.
      const byQuarter = new Map();
      for (const e of preservedEntries.concat(entries)) {
        const existing = byQuarter.get(e.quarter);
        if (!existing) { byQuarter.set(e.quarter, e); continue; }
        const eIsTTM        = e.fcfMarginSource === 'TTM' || !e.fcfMarginSource;
        const existingIsTTM = existing.fcfMarginSource === 'TTM' || !existing.fcfMarginSource;
        if (eIsTTM && !existingIsTTM) byQuarter.set(e.quarter, e);
      }

      const final = Array.from(byQuarter.values())
        .sort((a, b) => (a.quarter < b.quarter ? -1 : a.quarter > b.quarter ? 1 : 0));
      const trimmed = final.length > MAX_QUARTERS ? final.slice(final.length - MAX_QUARTERS) : final;

      const next = Object.assign({}, history, { entries: trimmed, schemaVersion: SCHEMA_VERSION });
      writeFileAtomic(path.join(args.out, ticker + '.json'), JSON.stringify(next));
      written++;
    } catch (e) {
      failed++;
      if (failed <= 10) console.error('[backfill] ERROR ' + ticker + ': ' + e.message);
    }
  }

  console.log('[backfill] stocks=' + stocks.length + ' written=' + written + ' skipped=' + skipped + ' failed=' + failed);
}

if (require.main === module) {
  main().catch(e => { console.error('backfill-r40rx-history failed: ' + e.message); process.exit(1); });
}
