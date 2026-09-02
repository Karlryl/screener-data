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
 *
 * ACHTUNG (Karl-Entscheid 2026-08-16): methods-history/ und picks-history/ stehen auf der
 * Schutzliste und werden NUR mit ausdruecklichem --methods-keep-days / --picks-keep-days
 * angefasst — sie erben den generischen --keep-days-Default NICHT. picks-history/ ist
 * zusaetzlich dauerhaft eingefroren (picks-history/_FROZEN.md): jeder Flag-Wert, der dort
 * Vintages entfernen wuerde, bricht den Lauf laut ab.
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
const { writeFileAtomic } = require('../lib/atomic-write.js');

const ROOT = path.join(__dirname, '..');
const ARCHIVE_BASE = path.join(ROOT, 'external-data');

function parseKeepDaysValue(name, raw) {
  // Validate the raw token before conversion. parseInt accepts dangerous
  // prefixes such as "0junk", "1e3" and "3.5" as 0, 1 and 3.
  const value = typeof raw === 'string' && /^[0-9]+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value < 0) {
    const shown = raw === undefined ? '<missing>' : JSON.stringify(raw);
    console.error(`::error::archive-old-snapshots: invalid ${name} value (${shown} — must be a non-negative safe integer) — aborting before retention arithmetic`);
    process.exit(1);
  }
  return value;
}

function parseArgs(argv) {
  const args = { keepDays: 14, methodsKeepDays: null, picksKeepDays: null, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--keep-days') args.keepDays = parseKeepDaysValue(argv[i], argv[++i]);
    // Tag 153: per-directory overrides — methods-history is large (14 MB/file), picks-history
    // is small (65 KB) but walk-forward-perf needs 84+ days of vintages.
    else if (argv[i] === '--methods-keep-days') args.methodsKeepDays = parseKeepDaysValue(argv[i], argv[++i]);
    else if (argv[i] === '--picks-keep-days') args.picksKeepDays = parseKeepDaysValue(argv[i], argv[++i]);
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
    const baseDate = process.env.RUN_DATE_UTC || new Date().toISOString().slice(0, 10);
    const d = new Date(baseDate + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - keepDays);
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
    // F-SC-003 (Tag 180): append-mode without dedup → re-running on the same
    // month duplicates entries (CI retry, manual re-archive). Now: parse the
    // existing archive into a Map keyed by date, merge new entries, and write
    // the combined result atomically (fixes F-SM-002 non-atomic write and
    // F-SM-003 TOCTOU race together). If all entries are already present,
    // skip the write but still unlink originals.
    // Build a Map of existing entries keyed by date (preserves order via insertion).
    const merged = new Map();
    let toWrite = entries;
    if (fs.existsSync(ndjsonPath)) {
      // BH-142: no silent catch here — a corrupt existing line used to be dropped
      // from `merged` and then permanently lost when the atomic rewrite below
      // persisted the map without it. Let it throw (top-level catch → exit 1).
      const existingLines = fs.readFileSync(ndjsonPath, 'utf8').split('\n').filter(Boolean);
      for (const ln of existingLines) {
        const obj = JSON.parse(ln);
        if (obj && obj.date) merged.set(obj.date, ln);
      }
      // BH-190: a same-date collision is only truly "already archived" if the
      // content matches too. Without this, a corrected live snapshot (same date,
      // different content) would be filtered out of toWrite below and then, in
      // the toWrite.length===0 branch, its live original still gets unlinked —
      // silently keeping the stale v1 forever and losing the correction.
      for (const e of entries) {
        if (!merged.has(e.date)) continue;
        const newLine = JSON.stringify({ date: e.date, ...e.content });
        if (merged.get(e.date) !== newLine) {
          throw new Error('archive collision: ' + ndjsonPath + ' already has a DIFFERENT entry for ' +
            e.date + ' — refusing to silently keep the old version and delete the corrected live file');
        }
      }
      toWrite = entries.filter(e => !merged.has(e.date));
      if (toWrite.length === 0) {
        console.log('  all ' + entries.length + ' entries already archived in ' + ndjsonPath + ' — skipping append');
        // Still unlink originals since they're already archived
        for (const e of entries) {
          const orig = path.join(srcDir, e.date + '.json');
          try { fs.unlinkSync(orig); } catch (err) { console.warn('  unlink fail ' + e.date + ': ' + err.message); }
        }
        continue;
      }
    }
    // Add new entries to the map, then write the full merged result atomically.
    for (const e of toWrite) {
      merged.set(e.date, JSON.stringify({ date: e.date, ...e.content }));
    }
    const mergedLines = Array.from(merged.values()).join('\n') + '\n';
    writeFileAtomic(ndjsonPath, mergedLines);
    // F-SM-013 / Tag 232c-15 (audit F-SM-008 HIGH): verify the archive is
    // readable AND every NEWLY-APPENDED line parses, before unlinking the
    // originals. The prior verify only parsed FIRST line, which in append-
    // mode (the common case) means it parsed a line from a PREVIOUS append
    // — a tail-corruption from a SIGKILL mid-write would slip past the
    // check, and the originals get unlinked permanently. New: parse the
    // last N lines of the file (where N = toWrite.length) and confirm each
    // round-trips. NDJSON is line-delimited; we use raw split + parse for
    // tight memory use.
    try {
      const raw = fs.readFileSync(ndjsonPath, 'utf8');
      const allLines = raw.split('\n').filter(l => l.length > 0);
      if (allLines.length === 0) throw new Error('archive file is empty');
      JSON.parse(allLines[0]);  // first-line invariant (kept from prior verify)
      // Verify each just-appended line round-trips. In overwrite-mode (toWrite
      // was the only source), allLines.length === toWrite.length so checking
      // them all happens to match the prior-overwrite-mode contract.
      const expectedTail = Math.min(toWrite.length, allLines.length);
      for (let i = allLines.length - expectedTail; i < allLines.length; i++) {
        JSON.parse(allLines[i]);
      }
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

// Karl-Entscheid 2026-08-16: Schutzliste fail-closed. `keepDays` ist NICHT der Default
// fuer geschuetzte Verzeichnisse — ohne ausdrueckliches Flag passiert dort nichts.
// `frozen` (picks-history) blockt zusaetzlich JEDEN Flag-Wert, der Vintages entfernen
// wuerde: die Datei ist der unbestechliche Beleg der historischen Vorschlaege, eine
// laute Meldung nach dem Loeschen waere wertlos (der CI-Schritt laeuft continue-on-error).
// Gezaehlt wird mit dem echten archiveDirByDate im dry-run — so kann die Warnschwelle
// nie von der tatsaechlichen Cutoff-Rechnung abdriften.
function archiveProtectedDir(dirName, keepDays, dryRun, frozen) {
  const srcDir = path.join(ROOT, dirName);
  const archiveDir = path.join(ARCHIVE_BASE, dirName + '-archive');
  const flag = '--' + (dirName === 'picks-history' ? 'picks' : 'methods') + '-keep-days';

  if (keepDays == null) {
    console.log('\n' + dirName + '/ — SCHUTZLISTE, kein ' + flag +
      ' gesetzt → fail-closed: nichts archiviert, nichts geloescht.');
    return { archived: 0, kept: 0 };
  }

  console.log('\n' + dirName + '/ (keep=' + keepDays + 'd)');
  if (frozen) {
    const probe = archiveDirByDate(srcDir, archiveDir, keepDays, true);
    if (probe.archived > 0) {
      console.error('::error::archive-old-snapshots: ' + flag + ' ' + keepDays + ' wuerde ' +
        probe.archived + ' Vintages aus ' + dirName + '/ entfernen. ' + dirName +
        '/ ist seit 2026-07-02 EINGEFROREN und bleibt es dauerhaft (Karl-Entscheid 2026-08-16, ' +
        'siehe picks-history/_FROZEN.md) — abgebrochen, es wurde nichts geloescht.');
      throw new Error(dirName + ' ist eingefroren — ' + flag + ' ' + keepDays + ' abgelehnt');
    }
  }
  const res = archiveDirByDate(srcDir, archiveDir, keepDays, dryRun);
  console.log('  total: ' + res.archived + ' archived, ' + res.kept + ' kept');
  return res;
}

function main() {
  const args = parseArgs(process.argv);
  console.log('Archive Rotation — keepDays=' + args.keepDays + (args.dryRun ? ' (dry-run)' : ''));
  ensureDir(ARCHIVE_BASE);

  // Karl-Entscheid 2026-08-16 (dauerhaft): picks-history/ und methods-history/ stehen
  // auf der Schutzliste (CLAUDE.md/AGENTS.md), picks-history/ ist zusaetzlich inhaltlich
  // EINGEFROREN (picks-history/_FROZEN.md). Frueher erbten beide den generischen
  // `keepDays`-Default (14) — ein Hand-Aufruf `node scripts/archive-old-snapshots.js`
  // OHNE Flags hat damit saemtliche Vintages aelter als 14 Tage aus dem Repo in das
  // git-ignorierte external-data/-Archiv verschoben und die Originale geloescht. Die CI
  // ruft zwar korrekt mit 100000 auf, aber der Default darf den Verlust nicht ermoeglichen.
  // Jetzt fail-closed: ohne ausdrueckliches Flag wird an den geschuetzten Verzeichnissen
  // NICHTS archiviert. Nur `prices/` erbt weiter (nicht geschuetzt, echte Rotation).
  const mh = archiveProtectedDir('methods-history', args.methodsKeepDays, args.dryRun, false);
  const ph = archiveProtectedDir('picks-history', args.picksKeepDays, args.dryRun, true);

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
  // BH-142: was exit(0) — a genuine runtime failure (e.g. the corrupt-line /
  // collision throws above) rendered green under the workflow's continue-on-error
  // instead of surfacing. Fail loud with exit 1.
  try { main(); } catch (e) { console.error('archive failed: ' + e.message); process.exit(1); }
}

module.exports = { archiveDirByDate, parseArgs };
