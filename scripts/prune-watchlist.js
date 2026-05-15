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
// Tag 189: F-SM-021 — atomic watchlist write (other writer is refresh-universe.js).
const { writeFileAtomic } = require('../lib/atomic-write.js');

function parseArgs(argv) {
  const args = {
    watchlist:      path.join(__dirname, '..', 'watchlist.json'),
    snapshots:      path.join(__dirname, '..', 'snapshots'),
    maxAgeDays:     60,
    // F-DP-022: tickers with no snapshot after this many days are flagged/removed
    pruneNoDataDays: 30,
    dryRun: false
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--watchlist' && argv[i+1])   args.watchlist  = argv[++i];
    else if (argv[i] === '--snapshots' && argv[i+1]) args.snapshots = argv[++i];
    else if (argv[i] === '--max-age-days' && argv[i+1]) args.maxAgeDays = parseInt(argv[++i], 10);
    // F-DP-022: new flag to control how long no-snapshot tickers are tolerated
    else if (argv[i] === '--prune-no-data-days' && argv[i+1]) args.pruneNoDataDays = parseInt(argv[++i], 10);
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

// F-DP-023: Returns a specific reason string rather than a boolean, so callers can use
// accurate labels. Returns null when the ticker should be kept.
function deadReason(snap, maxAgeDays) {
  if (!snap) return null; // no snapshot = handled separately by no-data grace period logic

  // F-DP-023: Explicit delisted flag — label accurately
  if (snap.meta && snap.meta.delisted === true) return 'delisted';

  // No active quote: has a snapshot but no market cap and no recent price
  const hasMcap   = snap.marketCap && snap.marketCap.value != null && snap.marketCap.value > 0;
  const hasRev    = snap.annual && snap.annual.annualRev && snap.annual.annualRev.length > 0;
  const hasSector = snap.meta && snap.meta.sector;
  const hasPrice  = snap.meta && snap.meta.regularMarketPrice != null;

  // Check if snapshot is completely empty AND stale
  const fetchedAt = snap.meta && snap.meta.fetchedAt;
  if (fetchedAt) {
    const ageMs = Date.now() - new Date(fetchedAt).getTime();
    const ageDays = ageMs / 86400000;
    if (ageDays > maxAgeDays) {
      if (!hasMcap && !hasRev && !hasSector) {
        // F-DP-023: distinguish between no-financial-data and no-active-quote
        return hasPrice ? 'no-financial-data' : 'no-active-quote';
      }
    }
  }

  return null;
}

// Kept for backward compatibility — wraps deadReason
function isDeadSnapshot(snap, maxAgeDays) {
  return deadReason(snap, maxAgeDays) !== null;
}

function main() {
  const args = parseArgs(process.argv);
  console.log('Watchlist Auto-Prune (Tag 142)');
  console.log('  watchlist:          ' + args.watchlist);
  console.log('  snapshots:          ' + args.snapshots);
  console.log('  max-age-days:       ' + args.maxAgeDays);
  // F-DP-022: show new threshold
  console.log('  prune-no-data-days: ' + args.pruneNoDataDays);
  console.log('  dry-run:            ' + args.dryRun);

  const wl = JSON.parse(fs.readFileSync(args.watchlist, 'utf8'));
  const before = wl.stocks.length;
  console.log('\nTotal before: ' + before);

  const kept = [];
  const pruned = [];
  const now = Date.now();

  for (const entry of wl.stocks) {
    const snap = loadSnapshot(args.snapshots, entry.ticker);

    // F-DP-022: prune tickers with no snapshot that have been in the watchlist too long
    if (!snap) {
      const addedAt = entry.added_at || entry.addedAt || null;
      if (addedAt) {
        const ageDays = (now - new Date(addedAt).getTime()) / 86400000;
        if (ageDays > args.pruneNoDataDays) {
          const reason = 'no-snapshot-after-' + args.pruneNoDataDays + 'd';
          pruned.push({ ticker: entry.ticker, reason });
          console.log('  PRUNE ' + entry.ticker.padEnd(10) + ' (' + reason + ')');
          continue;
        }
      }
      kept.push(entry);
      continue;
    }

    // F-DP-023: use deadReason() for accurate labels instead of hardcoded 'stale+no-data'
    const reason = deadReason(snap, args.maxAgeDays);
    if (reason !== null) {
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
  // F-SM-021 (Tag 189): same atomic-write rationale as refresh-universe.js.
  writeFileAtomic(args.watchlist, JSON.stringify(wl, null, 2));
  console.log('\nWritten: ' + args.watchlist);
}

main();
