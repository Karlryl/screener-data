'use strict';
/**
 * Tag 189: writeFileAtomic — single source of truth for "tmp + rename" writes.
 *
 * Why: numerous committed state files were written via plain `fs.writeFileSync`
 * (refresh-fx.js, watchlist.json, pull-sec-xbrl manifest, picks-history/_first-seen,
 * snapshot-picks latest.json + vintage.json, FTS cache). A SIGKILL / CI timeout
 * mid-write truncated the file; downstream pull-yahoo, prune-watchlist, etc.
 * then aborted on parse-error or worse, silently loaded a `{}` shape and
 * regenerated everything from scratch (alert-state baseline wipe pattern,
 * F-SM-015). Audit Group A enumerated ≥9 files sharing this defect.
 *
 * Pattern: write to `<path>.tmp.<pid>`, then atomic `rename` over the target.
 * POSIX rename is atomic on the same filesystem; on Windows the rename is
 * also atomic against readers as long as no handle is open.
 *
 * Usage:
 *   const { writeFileAtomic, writeJsonAtomic } = require('./lib/atomic-write.js');
 *   writeFileAtomic('foo.json', '{"k":"v"}');
 *   writeJsonAtomic('foo.json', { k: 'v' }, { indent: 2 });
 *
 * Both functions surface fs errors normally; callers handle them.
 */
const fs = require('fs');
const path = require('path');

function _tmpPath(targetPath) {
  // Sibling tmp file → same filesystem → atomic rename. Including pid + a
  // monotonic counter is enough to avoid collisions when the same process
  // calls writeFileAtomic on the same path twice in flight (rare; defensive).
  _tmpPath._n = (_tmpPath._n || 0) + 1;
  return targetPath + '.tmp.' + process.pid + '.' + _tmpPath._n;
}

function writeFileAtomic(targetPath, data, options) {
  const tmp = _tmpPath(targetPath);
  try {
    fs.writeFileSync(tmp, data, options || undefined);
    fs.renameSync(tmp, targetPath);
  } catch (err) {
    // best-effort cleanup of tmp on failure; swallow cleanup errors —
    // surfacing the original write/rename failure is what matters.
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw err;
  }
}

function writeJsonAtomic(targetPath, value, opts) {
  opts = opts || {};
  const indent = (opts.indent != null) ? opts.indent : 2;
  const payload = JSON.stringify(value, opts.replacer || null, indent);
  writeFileAtomic(targetPath, payload, { encoding: 'utf8' });
}

module.exports = { writeFileAtomic, writeJsonAtomic };
