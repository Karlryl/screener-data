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

const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

/**
 * Map a ticker to its on-disk snapshot filename.
 * - Sanitises `[^A-Z0-9.-]` → `_`
 * - Prefixes `_` when the stem (pre-dot) matches a Windows reserved name
 *   (CON, PRN, AUX, NUL, COM1-9, LPT1-9) so the file is portable.
 *
 * The ticker inside the JSON is unchanged — only the on-disk filename differs.
 */
function safeSnapshotFilename(ticker) {
  const sanitized = String(ticker).replace(/[^A-Z0-9.-]/gi, '_');
  const stem = sanitized.split('.')[0];
  if (WINDOWS_RESERVED.test(stem)) return '_' + sanitized + '.json';
  return sanitized + '.json';
}

module.exports = { safeSnapshotFilename, WINDOWS_RESERVED };
