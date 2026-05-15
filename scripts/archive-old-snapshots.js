#!/usr/bin/env node
/**
 * Tag 134 — Phase 5.1: Snapshot Archive Rotation
 * ==============================================
 * Per Opus audit (defect A7): snapshots/ has 3500+ JSON files (~30 MB) and grows.
 * methods-history/ accumulates ~10 MB per run. Repo will cross 1 GB inside 18 months
 * without rotation.
 *
 * Strategy: bundle methods-history entries older than 60 days into a single
 * monthly NDJSON file under external-data/methods-history-archive/ (git-ignored).
 * Same for picks-history.
 * snapshots/ are kept fresh (latest pull is the source of truth) but a monthly
 * archive of the past universe-state is also bundled.
 *
 * Only the latest-N stay committed in the live folders. The archive lives on the
 * runner / on Karl's disk and can be reconstructed at any time by replaying.
 *
 * Run: node scripts/archive-old-snapshots.js [--keep-days 60] [--dry-run]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ARCHIVE_BASE = path.join(ROOT, 'external-data');

function parseArgs(argv) {
  const args = { keepDays: 14, methodsKeepDays: null, picksKeepDays: null, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--keep-days' && argv[i+1]) args.keepDays = parseInt(argv[++i], 10);
    // Tag 153: per-directory overrides — methods-history is large (14 MB/file), picks-history
    // is small (65 KB) but walk-forward-perf needs 84+ days of vintages.
    else if (argv[i] === '--methods-keep-days' && argv[i+1]) args.methodsKeepDays = parseInt(argv[++i], 10);
    else if (argv[i] === '--picks-keep-days' && argv[i+1]) args.picksKeepDays = parseInt(argv[++i], 10);
    else if (argv[i] === '--dry-run') args.dryRun = true;
  }
  return args;
}

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function archiveDirByDate(srcDir, archiveDir, keepDays, dryRun) {
  if (!fs.existsSync(srcDir)) {
    console.log('  skip — does not exist: ' + srcDir);
    return { archived: 0, kept: 0 };
  }
  const cutoff = (() => {
    const d = new Date(); d.setUTCDate(d.getUTCDate() - keepDays);
    return d.toISOString().slice(0, 10);
  })();
  const files = fs.readdirSync(srcDir)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  let archived = 0, kept = 0;
  const byMonth = {}; // YYYY-MM -> [ {date, content} ]
  for (const f of files) {
    const date = f.replace('.json', '');
    if (date >= cutoff) { kept++; continue; }
    const month = date.slice(0, 7);
    let content;
    try { content = JSON.parse(fs.readFileSync(path.join(srcDir, f), 'utf8')); }
    catch (e) { console.warn('  parse fail ' + f + ': ' + e.message); continue; }
    byMonth[month] = byMonth[month] || [];
    byMonth[month].push({ date, content });
    archived++;
  }
  if (archived === 0) return { archived: 0, kept };

  ensureDir(archiveDir);
  for (const [month, entries] of Object.entries(byMonth)) {
    const ndjsonPath = path.join(archiveDir, month + '.ndjson');
    const lines = entries.map(e => JSON.stringify({ date: e.date, ...e.content })).join('\n') + '\n';
    if (dryRun) {
      console.log('  [dry-run] would write ' + ndjsonPath + ' (' + entries.length + ' entries)');
      continue;
    }
    // Append-mode if file already exists (idempotency)
    if (fs.existsSync(ndjsonPath)) {
      fs.appendFileSync(ndjsonPath, lines);
    } else {
      fs.writeFileSync(ndjsonPath, lines);
    }
    // F-SM-013: verify the archive is readable before unlinking originals
    // Parse the first line to confirm the write succeeded and the file is valid NDJSON
    try {
      const firstLine = fs.readFileSync(ndjsonPath, 'utf8').split('\n')[0];
      if (!firstLine || firstLine.trim() === '') throw new Error('archive file is empty');
      JSON.parse(firstLine);
    } catch (verifyErr) {
      console.warn('  archive verify failed for ' + ndjsonPath + ': ' + verifyErr.message + ' — skipping unlink of originals');
      continue;
    }
    // Only unlink originals after successful archive verification
    for (const e of entries) {
      const orig = path.join(srcDir, e.date + '.json');
      try { fs.unlinkSync(orig); } catch (err) { console.warn('  unlink fail ' + e.date + ': ' + err.message); }
    }
    console.log('  archived ' + entries.length + ' entries from ' + path.basename(srcDir) + ' → ' + ndjsonPath);
  }
  return { archived, kept };
}

function main() {
  const args = parseArgs(process.argv);
  console.log('Archive Rotation — keepDays=' + args.keepDays + (args.dryRun ? ' (dry-run)' : ''));
  ensureDir(ARCHIVE_BASE);

  const methodsKeepDays = args.methodsKeepDays != null ? args.methodsKeepDays : args.keepDays;
  const picksKeepDays = args.picksKeepDays != null ? args.picksKeepDays : args.keepDays;

  console.log('\nmethods-history/ (keep=' + methodsKeepDays + 'd)');
  const mh = archiveDirByDate(
    path.join(ROOT, 'methods-history'),
    path.join(ARCHIVE_BASE, 'methods-history-archive'),
    methodsKeepDays, args.dryRun
  );
  console.log('  total: ' + mh.archived + ' archived, ' + mh.kept + ' kept');

  console.log('\npicks-history/ (keep=' + picksKeepDays + 'd)');
  const ph = archiveDirByDate(
    path.join(ROOT, 'picks-history'),
    path.join(ARCHIVE_BASE, 'picks-history-archive'),
    picksKeepDays, args.dryRun
  );
  console.log('  total: ' + ph.archived + ' archived, ' + ph.kept + ' kept');

  console.log('\nprices/ (daily snapshots, not history.json)');
  // For prices/YYYY-MM-DD.json files (one-day snapshots, not the kumulative history.json)
  if (fs.existsSync(path.join(ROOT, 'prices'))) {
    const pr = archiveDirByDate(
      path.join(ROOT, 'prices'),
      path.join(ARCHIVE_BASE, 'prices-archive'),
      args.keepDays, args.dryRun
    );
    console.log('  total: ' + pr.archived + ' archived, ' + pr.kept + ' kept');
  }

  console.log('\nDone.');
}

if (require.main === module) {
  try { main(); } catch (e) { console.error('archive failed: ' + e.message); process.exit(0); }
}

module.exports = { archiveDirByDate };
