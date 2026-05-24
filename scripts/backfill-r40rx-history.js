#!/usr/bin/env node
/**
 * One-time backfill: compute historical R40/RX from existing snapshots.
 *
 * Uses timeseries.revenueQ for historical revenue (up to 8Q) and annual
 * FCF data as a margin proxy. Writes backfill entries to r40rx-history/
 * ONLY for quarters not already present (safe to re-run).
 *
 * FCF margin for backfilled entries uses annual FCF/revenue as an approximation
 * (tagged fcfMarginSource:'annual-approx') because per-quarter FCF is not
 * in the snapshot. Live forward-banked entries (from snapshot-r40rx-history.js)
 * use the exact same definition as the live filter (fcfMarginSource:'TTM').
 *
 * Run: node scripts/backfill-r40rx-history.js [--snapshots ./snapshots] [--out ./r40rx-history]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../lib/atomic-write.js');
const { appendAndPrune, isoToQuarter, SCHEMA_VERSION } = require('./snapshot-r40rx-history.js');

function parseArgs(argv) {
  const args = { snapshots: './snapshots', out: './r40rx-history' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--snapshots' && argv[i+1]) args.snapshots = argv[++i];
    else if (argv[i] === '--out' && argv[i+1]) args.out = argv[++i];
  }
  return args;
}

function unwrap(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && Number.isFinite(v.value)) return v.value;
  return null;
}

function arrayIndexToApproxQuarter(fetchedAt, i) {
  const dateStr = fetchedAt ? fetchedAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() - i * 3);
  return isoToQuarter(d.toISOString().slice(0, 10));
}

function computeHistoricalEntries(stock) {
  const fetchedAt = stock.meta && stock.meta.fetchedAt;
  const ts = stock.timeseries || {};
  const annual = stock.annual || {};

  const revQ = Array.isArray(ts.revenueQ) ? ts.revenueQ.map(unwrap) : [];
  const annualFCF = Array.isArray(annual.annualFCF) ? annual.annualFCF.map(unwrap) : [];
  const annualRev = Array.isArray(annual.annualRev) ? annual.annualRev.map(unwrap) : [];

  const annualFcfMargins = [];
  for (let y = 0; y < Math.min(annualFCF.length, annualRev.length, 4); y++) {
    const f = annualFCF[y], r = annualRev[y];
    annualFcfMargins.push((f != null && r != null && r > 0) ? (f / r) * 100 : null);
  }

  const entries = [];
  for (let i = 0; i < 4 && i + 4 < revQ.length; i++) {
    const qRev = revQ[i];
    const priorRev = revQ[i + 4];
    if (qRev == null || priorRev == null || priorRev === 0) continue;
    const growth = (qRev - priorRev) / Math.abs(priorRev) * 100;
    if (Math.abs(growth) <= 1) continue;

    const fcfMargin = annualFcfMargins[Math.min(i, annualFcfMargins.length - 1)];
    if (fcfMargin == null) continue;

    const r40 = Math.round((growth + fcfMargin) * 10) / 10;
    const rx  = Math.round((1.5 * growth + fcfMargin) * 10) / 10;
    const quarter = arrayIndexToApproxQuarter(fetchedAt, i);
    entries.push({
      quarter,
      date: fetchedAt ? fetchedAt.slice(0, 10) : new Date().toISOString().slice(0, 10),
      r40, rx,
      growth: Math.round(growth * 10) / 10,
      fcfMargin: Math.round(fcfMargin * 10) / 10,
      fcfMarginSource: 'annual-approx'
    });
  }
  return entries;
}

function readHistoryFile(outDir, ticker) {
  const file = path.join(outDir, ticker + '.json');
  if (!fs.existsSync(file)) return { ticker, schemaVersion: SCHEMA_VERSION, entries: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION) return { ticker, schemaVersion: SCHEMA_VERSION, entries: [] };
    return { ticker, schemaVersion: SCHEMA_VERSION, entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
  } catch (e) { return { ticker, schemaVersion: SCHEMA_VERSION, entries: [] }; }
}

async function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.out)) fs.mkdirSync(args.out, { recursive: true });

  if (!fs.existsSync(args.snapshots)) { console.error('snapshots dir not found: ' + args.snapshots); process.exit(1); }
  const files = fs.readdirSync(args.snapshots).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  console.log('[backfill] processing ' + files.length + ' snapshots');

  let filled = 0, skipped = 0, failed = 0;
  for (const f of files) {
    let stock;
    try { stock = JSON.parse(fs.readFileSync(path.join(args.snapshots, f), 'utf8')); } catch (e) { failed++; continue; }
    const ticker = stock && stock.meta && stock.meta.ticker;
    if (!ticker) { skipped++; continue; }

    const historical = computeHistoricalEntries(stock);
    if (historical.length === 0) { skipped++; continue; }

    const history = readHistoryFile(args.out, ticker);
    const existingQuarters = new Set((history.entries || []).map(e => e.quarter));

    let changed = false;
    let current = history;
    for (const entry of historical) {
      if (existingQuarters.has(entry.quarter)) continue;
      current = appendAndPrune(current, entry);
      changed = true;
    }

    if (changed) {
      writeFileAtomic(path.join(args.out, ticker + '.json'), JSON.stringify(current));
      filled++;
    } else {
      skipped++;
    }
  }

  console.log('[backfill] filled=' + filled + ' skipped=' + skipped + ' failed=' + failed);
}

if (require.main === module) {
  main().catch(e => { console.error('backfill-r40rx-history failed: ' + e.message); process.exit(1); });
}
