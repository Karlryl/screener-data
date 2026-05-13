#!/usr/bin/env node
/**
 * Tag 142: Watchlist Auto-Prune
 * ==============================
 * Removes delisted or permanently invalid tickers from watchlist.json.
 *
 * A ticker is pruned when its snapshot exists AND:
 *   - meta.delisted === true, OR
 *   - snapshot has no financial data at all (no revenue, no market cap, no sector)
 *     AND snapshot is older than --max-age-days (default: 60 days)
 *
 * Tickers WITHOUT a snapshot are KEPT (newly added, awaiting first pull).
 *
 * Run:
 *   node scripts/prune-watchlist.js [--watchlist watchlist.json] [--snapshots ./snapshots]
 *                                   [--max-age-days 60] [--dry-run]
 */
'use strict';
const fs   = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {
    watchlist:  path.join(__dirname, '..', 'watchlist.json'),
    snapshots:  path.join(__dirname, '..', 'snapshots'),
    maxAgeDays: 60,
    dryRun: false
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--watchlist' && argv[i+1])   args.watchlist  = argv[++i];
    else if (argv[i] === '--snapshots' && argv[i+1]) args.snapshots = argv[++i];
    else if (argv[i] === '--max-age-days' && argv[i+1]) args.maxAgeDays = parseInt(argv[++i], 10);
    else if (argv[i] === '--dry-run') args.dryRun = true;
  }
  return args;
}

// Windows reserved filename logic (mirror of pull-yahoo.js)
const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
function safeSnapshotFilename(ticker) {
  const sanitized = String(ticker).replace(/[^A-Z0-9.-]/gi, '_');
  const stem = sanitized.split('.')[0];
  if (WINDOWS_RESERVED.test(stem)) return '_' + sanitized + '.json';
  return sanitized + '.json';
}

function loadSnapshot(snapshotsDir, ticker) {
  const fp = path.join(snapshotsDir, safeSnapshotFilename(ticker));
  if (!fs.existsSync(fp)) return null;
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch (e) { return null; }
}

function isDeadSnapshot(snap, maxAgeDays) {
  if (!snap) return false; // no snapshot = not dead yet

  // Explicit delisted flag
  if (snap.meta && snap.meta.delisted === true) return true;

  // Check if snapshot is completely empty AND stale
  const fetchedAt = snap.meta && snap.meta.fetchedAt;
  if (fetchedAt) {
    const ageMs = Date.now() - new Date(fetchedAt).getTime();
    const ageDays = ageMs / 86400000;
    if (ageDays > maxAgeDays) {
      // Has any financial data at all?
      const hasMcap   = snap.marketCap && snap.marketCap.value != null && snap.marketCap.value > 0;
      const hasRev    = snap.annual && snap.annual.annualRev && snap.annual.annualRev.length > 0;
      const hasSector = snap.meta && snap.meta.sector;
      if (!hasMcap && !hasRev && !hasSector) return true;
    }
  }

  return false;
}

function main() {
  const args = parseArgs(process.argv);
  console.log('Watchlist Auto-Prune (Tag 142)');
  console.log('  watchlist:    ' + args.watchlist);
  console.log('  snapshots:    ' + args.snapshots);
  console.log('  max-age-days: ' + args.maxAgeDays);
  console.log('  dry-run:      ' + args.dryRun);

  const wl = JSON.parse(fs.readFileSync(args.watchlist, 'utf8'));
  const before = wl.stocks.length;
  console.log('\nTotal before: ' + before);

  const kept = [];
  const pruned = [];

  for (const entry of wl.stocks) {
    const snap = loadSnapshot(args.snapshots, entry.ticker);
    if (isDeadSnapshot(snap, args.maxAgeDays)) {
      const reason = (snap.meta && snap.meta.delisted) ? 'delisted' : 'stale+no-data';
      pruned.push({ ticker: entry.ticker, reason });
      console.log('  PRUNE ' + entry.ticker.padEnd(10) + ' (' + reason + ')');
    } else {
      kept.push(entry);
    }
  }

  console.log('\nPruned: ' + pruned.length + ' tickers');
  console.log('Kept:   ' + kept.length + ' tickers');

  if (pruned.length === 0) {
    console.log('Nothing to prune.');
    return;
  }

  if (args.dryRun) {
    console.log('\n[dry-run] No changes written.');
    return;
  }

  wl.stocks = kept;
  wl.lastAutoPrune = new Date().toISOString();
  wl.lastAutoPruneRemoved = pruned;
  fs.writeFileSync(args.watchlist, JSON.stringify(wl, null, 2));
  console.log('\nWritten: ' + args.watchlist);
}

main();
