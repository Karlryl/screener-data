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

// Tag 230c-1 (audit F-230c-01 HIGH / F-230c-02 HIGH): three durability gaps
// remained after Tag 219a's tmp-file fsync.
//
//   1. POSIX rename atomicity guarantees the DIRECTORY ENTRY swap is atomic,
//      but the metadata write that records the new entry must itself be
//      fsync'd on the PARENT DIRECTORY for the rename to survive a power
//      loss / hard reboot. Without it, the on-disk directory can still show
//      the old entry (or no entry at all) after the crash, even though the
//      tmp file's bytes are durable. Section 6.2 of "Crash Consistency"
//      (Pillai et al, OSDI 2014) catalogues this as the #1 mistake in
//      file-update sequences.
//
//   2. On Windows, `rename` fails with EPERM/EBUSY when ANY process has a
//      handle open on the target — common when an AV scanner, the OneDrive
//      sync client, the watchlist UI, or a developer's editor briefly opens
//      a state file mid-pull. The failure is transient (typically <50ms);
//      the existing code surfaced it as a hard error → silent state-write
//      loss on Karl's Windows box. We now retry the rename a few times with
//      backoff before giving up.
//
//   3. Partial-write handling: `fs.writeSync(fd, buf, 0, buf.length, 0)` with
//      explicit position is NOT guaranteed to write all bytes in one call on
//      every platform. We now loop until everything is written.
const IS_WINDOWS = process.platform === 'win32';
const RENAME_RETRY_DELAYS_MS = IS_WINDOWS ? [10, 20, 50, 100, 200] : [];

function _writeAllSync(fd, buf) {
  let written = 0;
  while (written < buf.length) {
    const n = fs.writeSync(fd, buf, written, buf.length - written, written);
    if (n <= 0) throw new Error('writeSync returned ' + n + ' before EOF');
    written += n;
  }
}

function _sleepSync(ms) {
  // Block the thread without async — keep writeFileAtomic strictly synchronous
  // so callers don't have to refactor to async/await. Atomics.wait is the
  // cleanest sync sleep on modern Node; falls back to a busy-spin only if
  // SharedArrayBuffer is unavailable (vanishingly rare in CI).
  try {
    const sab = new SharedArrayBuffer(4);
    Atomics.wait(new Int32Array(sab), 0, 0, ms);
  } catch (_) {
    const end = Date.now() + ms;
    while (Date.now() < end) { /* spin */ }
  }
}

function _renameWithRetry(tmp, targetPath) {
  // Fast path: try once. On non-Windows this is the only attempt.
  try { fs.renameSync(tmp, targetPath); return; }
  catch (e) {
    if (!IS_WINDOWS) throw e;
    // Windows EPERM/EBUSY/EACCES: brief retry loop. Anything else surfaces.
    if (e.code !== 'EPERM' && e.code !== 'EBUSY' && e.code !== 'EACCES') throw e;
    let lastErr = e;
    for (const delay of RENAME_RETRY_DELAYS_MS) {
      _sleepSync(delay);
      try { fs.renameSync(tmp, targetPath); return; }
      catch (e2) {
        if (e2.code !== 'EPERM' && e2.code !== 'EBUSY' && e2.code !== 'EACCES') throw e2;
        lastErr = e2;
      }
    }
    throw lastErr;
  }
}

function _fsyncParentDirBestEffort(targetPath) {
  // POSIX only — Windows neither requires nor supports fsync on a directory
  // handle (NTFS journals metadata separately). On POSIX we open the parent
  // dir and fsync it so the rename's directory-entry update is durable.
  // Best-effort: failure here doesn't roll back the rename (the data is
  // already on disk via the tmp-file fsync); we surface a WARN once per
  // process-and-dir to surface a misconfigured filesystem without spamming.
  if (IS_WINDOWS) return;
  const dir = path.dirname(path.resolve(targetPath));
  let dfd;
  try {
    dfd = fs.openSync(dir, 'r');
    fs.fsyncSync(dfd);
  } catch (e) {
    _warnDirSyncOnce(dir, e);
  } finally {
    if (dfd != null) { try { fs.closeSync(dfd); } catch (_) {} }
  }
}

const _dirSyncWarned = new Set();
function _warnDirSyncOnce(dir, err) {
  if (_dirSyncWarned.has(dir)) return;
  _dirSyncWarned.add(dir);
  console.warn('[atomic-write] dir-fsync failed for ' + dir + ': ' +
    (err && err.message || err) + ' (data is durable, rename metadata may not be — investigate filesystem)');
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
        _writeAllSync(fd, buf);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    } else {
      fs.writeFileSync(tmp, data, options || undefined);
    }
    _renameWithRetry(tmp, targetPath);
    _fsyncParentDirBestEffort(targetPath);
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
