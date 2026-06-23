#!/usr/bin/env node
/**
 * Quarterly R40/RX Point-in-Time History
 * ========================================
 * For each ticker: appends/updates the current quarter's
 * { quarter, date, r40, rx, growth, fcfMargin, fcfMarginSource }
 * entry in r40rx-history/<TICKER>.json.
 *
 * Keyed by calendar quarter ("2026-Q2") so re-runs within the same
 * quarter overwrite rather than append — the last value of the quarter
 * freezes at the quarter boundary naturally.
 *
 * MAX_QUARTERS: retain last 20 quarters (5 years).
 *
 * Run: node scripts/snapshot-r40rx-history.js [--snapshots ./snapshots] [--out ./r40rx-history]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Runner = require('../methods/runner.js');
const { writeFileAtomic } = require('../lib/atomic-write.js');

const SCHEMA_VERSION = 1;
const MAX_QUARTERS = 20;

function parseArgs(argv) {
  const args = { snapshots: './snapshots', out: './r40rx-history' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--snapshots' && argv[i+1]) args.snapshots = argv[++i];
    else if (argv[i] === '--out' && argv[i+1]) args.out = argv[++i];
  }
  return args;
}

function isoToQuarter(iso) {
  // audit F-A-2026-06-21: validate the ISO date. A malformed RUN_DATE_UTC previously
  // yielded month=NaN -> 'YYYY-QNaN', poisoning every history key for the day. Fail loud.
  const s = String(iso);
  const month = parseInt(s.slice(5, 7), 10);
  if (!Number.isFinite(month) || month < 1 || month > 12) {
    throw new Error('isoToQuarter: invalid ISO date "' + iso + '"');
  }
  const q = Math.ceil(month / 3);
  return s.slice(0, 4) + '-Q' + q;
}

async function loadSnapshotsAsync(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  const BATCH = 200;
  const results = [];
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const loaded = await Promise.all(batch.map(async f => {
      try {
        const raw = await fs.promises.readFile(path.join(dir, f), 'utf8');
        const stock = JSON.parse(raw);
        return (stock && stock.meta && stock.meta.ticker) ? stock : null;
      } catch (e) { return null; }
    }));
    results.push(...loaded.filter(Boolean));
  }
  return results;
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

function appendAndPrune(history, entry) {
  const filtered = (history.entries || []).filter(e => e.quarter !== entry.quarter);
  filtered.push(entry);
  filtered.sort((a, b) => (a.quarter < b.quarter ? -1 : a.quarter > b.quarter ? 1 : 0));
  const trimmed = filtered.length > MAX_QUARTERS ? filtered.slice(filtered.length - MAX_QUARTERS) : filtered;
  return Object.assign({}, history, { entries: trimmed, schemaVersion: SCHEMA_VERSION });
}

function computeEntry(stock, today, quarter) {
  const allResults = Runner.evaluateStock(stock);
  const r40Res = allResults['rule-of-40'];
  const rxRes  = allResults['rule-of-x'];

  const r40 = (r40Res && r40Res.computable && Number.isFinite(r40Res.value))
    ? Math.round(r40Res.value * 10) / 10 : null;
  const rx = (rxRes && rxRes.computable && Number.isFinite(rxRes.value))
    ? Math.round(rxRes.value * 10) / 10 : null;

  if (r40 == null && rx == null) return null;

  const growth = (r40Res && r40Res.components && r40Res.components.growth != null)
    ? Math.round(r40Res.components.growth * 10) / 10 : null;
  const fcfMargin = (r40Res && r40Res.components && r40Res.components.fcfMargin != null)
    ? Math.round(r40Res.components.fcfMargin * 10) / 10 : null;
  const fcfMarginSource = (r40Res && r40Res.components && r40Res.components.fcfMarginSource) || 'TTM';

  return { quarter, date: today, r40, rx, growth, fcfMargin, fcfMarginSource };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.out)) fs.mkdirSync(args.out, { recursive: true });

  const today = process.env.RUN_DATE_UTC || new Date().toISOString().slice(0, 10);
  const quarter = isoToQuarter(today);
  console.log('[r40rx-history] date=' + today + ' quarter=' + quarter);

  const stocks = await loadSnapshotsAsync(args.snapshots);
  console.log('[r40rx-history] stocks loaded: ' + stocks.length);

  let written = 0, skipped = 0, failed = 0;
  for (const stock of stocks) {
    const ticker = stock.meta && stock.meta.ticker;
    if (!ticker) { skipped++; continue; }
    try {
      const entry = computeEntry(stock, today, quarter);
      if (!entry) { skipped++; continue; }
      const history = readHistoryFile(args.out, ticker);
      const next = appendAndPrune(history, entry);
      writeFileAtomic(path.join(args.out, ticker + '.json'), JSON.stringify(next));
      written++;
    } catch (e) {
      failed++;
      if (failed <= 10) console.error('[r40rx-history] ERROR ' + ticker + ': ' + e.message);
    }
  }

  const healthDir = './pipeline-health';
  if (!fs.existsSync(healthDir)) fs.mkdirSync(healthDir, { recursive: true });
  writeFileAtomic(
    path.join(healthDir, 'snapshot-r40rx-history.json'),
    JSON.stringify({ script: 'snapshot-r40rx-history', date: today, quarter, written, skipped, failed })
  );
  console.log('[r40rx-history] written=' + written + ' skipped=' + skipped + ' failed=' + failed);
  if (stocks.length > 0 && failed / stocks.length > 0.05) {
    console.error('::error::snapshot-r40rx-history failure rate > 5%');
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(e => { console.error('snapshot-r40rx-history failed: ' + e.message); process.exit(1); });
}

module.exports = { computeEntry, appendAndPrune, isoToQuarter, SCHEMA_VERSION, MAX_QUARTERS };
