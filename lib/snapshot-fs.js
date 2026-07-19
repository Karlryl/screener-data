'use strict';
/**
 * Tag 219a (audit F-218b-01): Shared snapshot filename helper.
 *
 * Why: Three (and counting) callers — `scripts/prune-watchlist.js`,
 * `scripts/elliott-export.js`, and `pull-yahoo.js` — each carry their own
 * copy of the ticker → on-disk filename mapping with the Windows-reserved
 * prefix and `[^A-Z0-9.-]` sanitisation. A fourth caller
 * (`scripts/regional-oos-test.js`) did *not* carry the helper and silently
 * skipped any ticker whose snapshot was written with the safe-stem
 * (BRK.B → BRK.B.json is fine, but CON → _CON.json was invisible to a
 * naive `path.join(SNAP_DIR, t + '.json')`). The audit flagged this as P1.
 *
 * Centralising the helper here removes the drift surface and means future
 * snapshot-naming changes need to land in exactly one file.
 *
 * Usage:
 *   const { safeSnapshotFilename } = require('../lib/snapshot-fs.js');
 *   const fp = path.join(SNAP_DIR, safeSnapshotFilename(ticker));
 */

// audit F-A-2026-06-21: CONIN$/CONOUT$ added — modern Windows reserved console
// device names. (Note: the [^A-Z0-9.-] sanitiser already turns the trailing `$`
// into `_`, so a literal `CONIN$` ticker lands as `CONIN_.json` regardless; the
// forms are kept here so the guard stays correct if the sanitiser ever widens.)
const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9]|CONIN\$|CONOUT\$)$/i;

/**
 * Map a ticker to its on-disk snapshot filename.
 * - Sanitises `[^A-Z0-9.-]` → `_`
 * - Prefixes `_` when the stem (pre-dot) matches a Windows reserved name
 *   (CON, PRN, AUX, NUL, COM1-9, LPT1-9) so the file is portable.
 *
 * The ticker inside the JSON is unchanged — only the on-disk filename differs.
 */
function safeSnapshotFilename(ticker) {
  // audit/fix: nullish/empty + case-fold + sanitizer-collapse filename collisions (single source now)
  if (ticker === null || ticker === undefined) {
    throw new TypeError('safeSnapshotFilename: ticker is null/undefined');
  }
  // Uppercase the stem before building the name so case-variant dupes (nflx vs
  // NFLX) map to one stable on-disk file. Already-uppercase tickers are a no-op,
  // so existing snapshots are never orphaned. The JSON ticker field is untouched.
  const sanitized = String(ticker).toUpperCase().replace(/[^A-Z0-9.-]/gi, '_');
  if (sanitized === '' || /^_+$/.test(sanitized)) {
    throw new Error('safeSnapshotFilename: ticker empty after sanitisation: ' + JSON.stringify(ticker));
  }
  // audit F-A-2026-06-21: normalise the stem by stripping leading/trailing
  // dots before the reserved-name check. Without this, a ticker like `.DE`
  // (or a malformed `.`/`..`/empty) yields stem '' and falls through to a
  // leading-dot filename (`.DE.json`) — a hidden dotfile on POSIX and an
  // unwritable/odd name on Windows. Writer and reader share this one helper,
  // so the rename stays symmetric and no write/read divergence is introduced.
  const stem = sanitized.split('.')[0].replace(/^\.+|\.+$/g, '');
  // audit F-A-2026-06-21: prefix `_` when the stem is empty OR reserved.
  // Empty stem => prevents un-writable / hidden-dotfile snapshot (git checkout
  // breaks, naive path.join readers go blind). Reserved stem => prevents the
  // Windows device-name collision the guard already existed to stop.
  if (stem === '' || WINDOWS_RESERVED.test(stem)) return '_' + sanitized + '.json';
  return sanitized + '.json';
}

/**
 * Tag 356 (audit BH-132): shared "is this a metadata file, not a real ticker
 * snapshot" predicate. run-screener.js's loadUniverse (C3 fix) already skips
 * ONLY _manifest-prefixed files or _last_good_disk.json — a blanket
 * `!f.startsWith('_')` (used
 * by freshness/coverage/merge/watcher readers) also swallows real
 * Windows-reserved-ticker snapshots like _CON.json (safeSnapshotFilename
 * above), silently dropping them from every gate that uses the blanket form.
 * One predicate, shared by every reader that needs to skip metadata files.
 */
function isMetadataSnapshot(filename) {
  return filename.startsWith('_manifest') || filename === '_last_good_disk.json';
}

module.exports = { safeSnapshotFilename, WINDOWS_RESERVED, isMetadataSnapshot };
