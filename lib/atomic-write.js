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
    // Tag 219a (audit F-218c-09): fsync the tmp file before the rename so a
    // power loss / OS crash between the write and the rename can't leave the
    // renamed file with zero content. `fs.writeFileSync` only guarantees the
    // data hit the OS page cache — not the disk. The extra `openSync +
    // writeSync + fsyncSync + closeSync` pair is one extra syscall per write;
    // for the small JSON files this helper is used for it's microseconds.
    // We still keep `fs.writeFileSync` as the fallback in the rare case where
    // `data` is something exotic the manual write path can't handle (e.g.
    // certain Buffer subtypes); the fsync path covers strings and Buffers,
    // which is what every caller in the repo passes today.
    const enc = (options && typeof options === 'object' && options.encoding) ||
                (typeof options === 'string' ? options : 'utf8');
    if (typeof data === 'string' || Buffer.isBuffer(data)) {
      const fd = fs.openSync(tmp, 'w');
      try {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, enc);
        fs.writeSync(fd, buf, 0, buf.length, 0);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    } else {
      fs.writeFileSync(tmp, data, options || undefined);
    }
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
