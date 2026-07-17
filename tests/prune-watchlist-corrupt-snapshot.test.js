// Audit T2 (silent data loss) — prune-watchlist.js loadSnapshot() returned null both
// when a snapshot file was MISSING and when it existed but JSON.parse() threw (e.g.
// OneDrive post-write corruption, documented as real in this tree). main() treats every
// null as "ticker never pulled" and, once added_at is older than --prune-no-data-days,
// deletes it from watchlist.json (reason 'no-snapshot-after-30d') — so a corrupt-but-
// present snapshot was silently evicted, indistinguishable from a ticker that was never
// pulled at all. The over-prune floor (max(200, 50%)) does not protect a single corrupt
// ticker inside a large watchlist.
//
// This test runs the REAL script as a subprocess (spawnSync), exactly like CI does —
// no test seam / extraction needed, no production logic bent for testability.
//
// Run: node tests/prune-watchlist-corrupt-snapshot.test.js   (Exit 0/1)
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'prune-watchlist.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

const OLD_ISO = new Date(Date.now() - 40 * 86400000).toISOString(); // 40d > pruneNoDataDays(30)
const FRESH_ISO = new Date(Date.now() - 5 * 86400000).toISOString(); // 5d < 30 -> grace period control

function setupFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-corrupt-'));
  const snapDir = path.join(dir, 'snapshots');
  fs.mkdirSync(snapDir);
  // CORRUPT: snapshot file EXISTS but is truncated/invalid JSON.
  fs.writeFileSync(path.join(snapDir, 'CORRUPT.json'), '{ invalid json');
  // MISSING: no snapshot file at all — control case, must still be pruned (no regression).
  // FRESHNODATA: no snapshot, but within the grace period — control case, must be kept either way.
  const watchlistPath = path.join(dir, 'watchlist.json');
  fs.writeFileSync(watchlistPath, JSON.stringify({
    stocks: [
      { ticker: 'CORRUPT',     added_at: OLD_ISO },
      { ticker: 'MISSING',     added_at: OLD_ISO },
      { ticker: 'FRESHNODATA', added_at: FRESH_ISO },
    ],
  }, null, 2));
  return { dir, watchlistPath, snapDir };
}

const { dir, watchlistPath, snapDir } = setupFixture();

const r = spawnSync(process.execPath, [
  SCRIPT,
  '--watchlist', watchlistPath,
  '--snapshots', snapDir,
  '--prune-no-data-days', '30',
  '--force', // bypass the over-prune floor (irrelevant to this bug; fixture is tiny on purpose)
], { cwd: ROOT, encoding: 'utf8' });

const out = (r.stdout || '') + (r.stderr || '');
const survivors = JSON.parse(fs.readFileSync(watchlistPath, 'utf8')).stocks.map((e) => e.ticker);

check('script exits 0 (not a crash)', () => {
  assert.equal(r.status, 0, 'unexpected exit code ' + r.status + ':\n' + out);
});

// THE BUG: a snapshot that exists but fails to parse must NEVER be evicted as
// "no-snapshot-after-30d" — that reason is reserved for tickers with no file at all.
check('CORRUPT (snapshot exists, parse fails) is KEPT, not evicted', () => {
  assert.ok(survivors.includes('CORRUPT'),
    'CORRUPT was pruned from watchlist.json — a corrupt-but-present snapshot was silently ' +
    'treated as no-data. Survivors: ' + JSON.stringify(survivors) + '\nOutput:\n' + out);
});

check('a corruption warning is logged for CORRUPT, naming the parse error', () => {
  assert.match(out, /CORRUPT.*failed to parse/i,
    'no warning distinguishing the corrupt snapshot from a missing one:\n' + out);
});

check('CORRUPT is never logged with reason no-snapshot-after-30d', () => {
  assert.doesNotMatch(out, /PRUNE\s+CORRUPT\s+\(no-snapshot-after-30d\)/,
    'CORRUPT was classified with the missing-snapshot reason — same bug as before:\n' + out);
});

// Control: the legitimate no-snapshot-after-30d path must still work (no regression).
check('MISSING (no snapshot file at all, stale added_at) is still pruned', () => {
  assert.ok(!survivors.includes('MISSING'),
    'MISSING should still be pruned via no-snapshot-after-30d — regression in the legit path. ' +
    'Survivors: ' + JSON.stringify(survivors));
});

// Control: within the grace period, no-snapshot tickers stay regardless.
check('FRESHNODATA (no snapshot, within grace period) is kept', () => {
  assert.ok(survivors.includes('FRESHNODATA'),
    'FRESHNODATA should be kept (added_at within pruneNoDataDays). Survivors: ' + JSON.stringify(survivors));
});

fs.rmSync(dir, { recursive: true, force: true });
console.log(fail ? `\nprune-watchlist-corrupt-snapshot: ${fail} FAILED` : '\nprune-watchlist-corrupt-snapshot: all passed');
process.exit(fail ? 1 : 0);
