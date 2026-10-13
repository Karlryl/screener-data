# Tag 230c — Infra-Modules Audit Wave 2

**Date**: 2026-05-17
**Branch**: main
**Scope**: `lib/atomic-write.js`, `lib/discord.js`, `methods/runner.js`.

This audit continues Tag 227c + 229c's coverage of under-audited
infrastructure modules. Wave 2 focuses on the three remaining
cross-cutting helpers: every state writer goes through atomic-write,
every alert through discord, every scoring run through methods/runner.

---

## Summary

| Severity | Findings | Fixed in 230c | Documented |
|----------|----------|---------------|------------|
| CRITICAL | 0        | —             | —          |
| HIGH     | 4        | 4             | —          |
| MEDIUM   | 3        | 1 (writeAll)  | 2          |
| LOW      | 2        | 0             | 2          |
| **Total**| **9**    | **5**         | **4**      |

### Fixed (separate commits)

- **Tag 230c-1**: `lib/atomic-write.js` — parent-dir fsync, Windows rename
  retry, partial-write loop (F-230c-01 HIGH + F-230c-02 HIGH + F-230c-03 MEDIUM).
- **Tag 230c-2**: `lib/discord.js` — payload truncation, 429 retry-after,
  5xx/network retry (F-230c-05 HIGH + F-230c-06 HIGH + F-230c-07 MEDIUM).

---

## lib/atomic-write.js (78 → 178 lines)

### F-230c-01 — **HIGH (FIXED in 230c-1)**: no parent-directory fsync

**File**: `lib/atomic-write.js:35-69` (pre-fix).

**Mechanism**: POSIX rename atomicity guarantees the directory-entry
swap is atomic against readers, but the metadata write that records the
new entry must itself be fsync'd on the **parent directory** for the
rename to survive a power loss or hard reboot. Without it, the on-disk
directory after recovery can show the OLD entry (or no entry at all) for
the renamed file even though the tmp file's bytes are durable from the
fd-fsync.

Pillai et al "All File Systems Are Not Created Equal" (OSDI 2014, §6.2)
catalogues this as the #1 mistake in atomic-update sequences across 11
production file systems. The danger surface for screener-data is every
post-pull state file: `alert-state.json`, `methods-history/*.json`,
`fx-rates.json`, `watchlist.json`, `_first-seen.json`, FTS cache.

**Fix**: `_fsyncParentDirBestEffort(targetPath)` opens the parent dir
read-only, fsync's the fd, closes. POSIX only (Windows neither requires
nor supports dir fsync — NTFS journals metadata separately). Failure
warns once per process-and-dir (so a misconfigured volume doesn't spam).
Best-effort because data is already durable via the tmp-file fsync; the
warning surfaces the integrity gap without blocking the write.

### F-230c-02 — **HIGH (FIXED in 230c-1)**: Windows rename EPERM retry

**File**: `lib/atomic-write.js:62` (pre-fix).

**Mechanism**: On Windows, `fs.renameSync` fails with EPERM/EBUSY/EACCES
when ANY process holds a handle on the target file — antivirus mid-scan,
OneDrive sync client, watchlist UI (open during a manual pull), or an
editor preview pane. The failure is transient (<50ms typically). The
previous code surfaced it as a hard exception → callers either crashed
the pull or (worse, in best-effort writers) silently lost the state
update.

Karl's local box runs all of these by default (OneDrive sync the repo
directory itself). The bug had no production impact (CI runs on Linux)
but every local `node scripts/refresh-fx.js` had a non-zero probability
of failing the file write while AV was scanning the directory.

**Fix**: `_renameWithRetry` tries once (POSIX behavior unchanged), then
on Windows retries on EPERM/EBUSY/EACCES with [10, 20, 50, 100, 200]ms
backoff = 380ms max total wait. Other error codes (ENOENT, ENOSPC)
surface immediately. Sync sleep via `Atomics.wait` on a SharedArrayBuffer
keeps the helper synchronous so callers don't have to refactor.

### F-230c-03 — **MEDIUM (FIXED in 230c-1)**: partial-write not handled

**File**: `lib/atomic-write.js:54` (pre-fix).

**Mechanism**: `fs.writeSync(fd, buf, 0, buf.length, 0)` with an explicit
file position is NOT guaranteed to write all bytes in one call on every
platform. EINTR mid-write, short writes on certain network filesystems,
or interrupted syscalls can return n < buf.length without throwing.
The previous code ignored the return value → file silently truncated.

**Fix**: `_writeAllSync(fd, buf)` loops `fs.writeSync(fd, buf, written,
remaining, written)` until `written === buf.length`, throwing on n <= 0
to surface unrecoverable cases (disk full mid-write, etc.).

### F-230c-NF-1 — **non-finding**: tmp filename collision risk

**File**: `lib/atomic-write.js:27-33`.

The `_tmpPath` function uses `pid + monotonic counter` which is unique
per process. Concurrent processes writing to the same path could collide
on `pid` (extremely unlikely — pid reuse requires the original process to
exit between calls), but the rename would still be atomic — the worst
case is one of two concurrent atomic writes "wins" and the other's tmp
file is orphaned (caught by the catch's unlink). Safe.

### F-230c-NF-2 — **non-finding**: tmp file orphan on SIGKILL

If the process is SIGKILL'd between `openSync(tmp)` and the catch's
`unlinkSync(tmp)`, an orphan `*.tmp.<pid>.<n>` remains on disk. No
cleanup happens on next boot. Cosmetic — these files are small (always <
1MB JSON) and easy to glob-clean (`git clean -fdx '*.tmp.*'`). Could add
a startup sweep but out of scope.

---

## lib/discord.js (47 → 126 lines)

### F-230c-05 — **HIGH (FIXED in 230c-2)**: no payload truncation

**File**: `lib/discord.js:33` (pre-fix).

**Evidence**: `body: JSON.stringify({ content: String(content) })`.

**Mechanism**: Discord enforces a 2000-character limit on the `content`
field; longer payloads are rejected with HTTP 400 and the alert
**silently never appears in the channel**. The previous code returned
`false` on the 400 — caller logged it to stdout but never re-tried with
a truncated payload.

`scripts/picks-regression-check.js:159` interpolates the full list of
new/dropped tickers into the message body. On a noisy day (10+ ticker
changes), the body easily exceeds 2000 chars → the regression alert
silently vanishes exactly when it's most actionable.

**Fix**: `_truncate(s)` slices to `2000 - "...(truncated)".length` and
appends the suffix. Caller never sees a 400 from oversized content.

### F-230c-06 — **HIGH (FIXED in 230c-2)**: no 429 retry-after handling

**File**: `lib/discord.js:36` (pre-fix).

**Mechanism**: Discord rate-limits webhook routes (~5 req/sec/route) and
returns HTTP 429 with either a `retry-after` header (seconds) or a JSON
body `{retry_after: <ms>}`. The previous `res.status >= 200 && < 300`
check treated 429 as failure → alert dropped.

The pipeline-health flow can burst 3+ alerts in quick succession (drift
+ regression + stats). The first two often 429 because the GitHub
Actions runner share an outbound NAT IP with thousands of other runners
on the same minute boundary.

**Fix**: On 429, read `retry-after` header (seconds → ms) AND parse JSON
body for `retry_after` (ms), take the max, sleep, retry. Capped at 10s
to avoid blocking CI step longer than the workflow timeout. Default
`maxRetries: 2`.

### F-230c-07 — **MEDIUM (FIXED in 230c-2)**: no transient-failure retry

**File**: `lib/discord.js:37-43` (pre-fix).

**Mechanism**: A single TLS handshake blip, DNS hiccup, or Discord 503
instantly dropped the alert. POSTs to Discord are effectively idempotent
within the rate-limit dedup window — a duplicate is far less harmful
than a missed alert.

**Fix**: One retry on network error (catch block) and one on 5xx, with
500ms backoff between attempts.

### F-230c-NF-3 — **non-finding**: AbortController cleanup

Each `_postOnce` creates a fresh AbortController + timer and clears in
the `finally`. No timer leaks even on the retry path (each attempt has
its own controller).

---

## methods/runner.js (96 lines)

### F-230c-08 — **MEDIUM**: `evaluateStock` filtered call leaks data-guard miss

**File**: `methods/runner.js:42-63`.

**Evidence**:
```js
for (const m of METHODS) {
  const methodType = MT.getType(m.id);
  if (filterType && methodType !== filterType) continue;  // skip non-matching
  if (onlyDefault && !MT.isDefaultActive(m.id)) continue;
  results[m.id] = H.wrapEvaluate(m, stock, { methodType });
}
const dq = MT.isDisqualifiedByDataGuards(results);
```

**Mechanism**: When `opts.type === 'CORE'`, only CORE methods are
evaluated, but `isDisqualifiedByDataGuards` is still called on the
filtered `results` map. Because no DATAGUARD entries are present, the
check always returns `disqualified: false`, regardless of whether the
stock would actually be disqualified.

A caller doing `Runner.evaluateStockExtended(stock, {type: 'CORE'})` and
then using `result.disqualified` for any gating decision gets a
silently-false negative. Today no production caller does this (all
callers use the full no-filter call), but the API contract is misleading
— the same function returns different gating answers depending on a
filter that conceptually has nothing to do with data-guards.

**Fix sketch**: When `filterType` is set, either (a) skip the dq check
entirely and surface `disqualified: null` (signal "unknown"), or (b)
always evaluate DATAGUARD methods irrespective of `filterType`. Option
(b) is more useful but increases work per call; option (a) is safer
because it forces callers to be explicit.

### F-230c-09 — **MEDIUM**: `_loadAllMethods` `optional: true` swallows missing-id bugs

**File**: `methods/runner.js:25-28`.

**Evidence**:
```js
if (!mod || typeof mod.evaluate !== 'function' || !mod.id) {
  const msg = '[methods/runner] Module ' + entry.file + ' missing evaluate() or id';
  if (entry.optional) { console.warn(msg + ' (optional, skipping)'); continue; }
  throw new Error(msg);
}
```

**Mechanism**: For `optional: true` entries, missing `evaluate` or `id`
falls through to skip + warn. The intent (per index.js header) is to
tolerate in-progress refactors, but in practice once a method is
registered, removing its `id` export would silently de-register it from
ALL downstream consumers. The Tag 134 motivation for the explicit
registry was specifically to prevent silent de-registration via typo.

Currently NO entry in `methods/index.js` uses `optional: true`, so the
risk is dormant. But if a future contributor adds `optional: true` to
mute a CI failure during a refactor, they can silently drop a scoring
method.

**Fix sketch**: Either remove the `optional` path entirely (the explicit
registry already provides the audit trail Tag 134 wanted) or require an
explicit `entry.expectedId` to cross-check loaded id against the
registry expectation.

### F-230c-10 — **LOW**: load-time `console.warn` in module init blocks reentrant `require`

**File**: `methods/runner.js:22, 27`.

**Mechanism**: `_loadAllMethods` runs at `require()` time (line 40:
`const METHODS = _loadAllMethods();`). If a method's load fails (optional
path warns and skips), the warn is emitted during the require chain.
Caller `require('./methods/runner.js')` blocks until all methods load
synchronously. Tests that require the runner have no way to inspect
the warn output before assertions.

Impact: cosmetic. Tag 134's loud-failure model deliberately runs at
import time so CI fails fast — the warn-and-continue path is the leaky
edge.

**Fix sketch**: Defer logging via `process.nextTick(() => console.warn(...))`
so callers can capture by overriding `console.warn` first. Out of scope.

### F-230c-11 — **LOW**: `evaluateStockLegacy` discards disqualification signal

**File**: `methods/runner.js:83-86`.

**Evidence**:
```js
function evaluateStockLegacy(stock) {
  const out = evaluateStock(stock);
  return out.results;  // discards disqualified, disqualifiedBy, counts
}
```

The default export `evaluateStock = evaluateStockLegacy` (line 90)
returns ONLY the results map. Any caller that uses the legacy default
import has no way to see `disqualified: true`. Today, score-aggregator
calls `evaluateStockExtended` explicitly, so production is safe. But
downstream tooling (tests, ad-hoc scripts) using the simple call get a
results map where a DATAGUARD-failed stock looks identical to a passing
one.

**Fix sketch**: Add a `_disqualified` synthetic entry to the results
map for legacy callers, or promote `evaluateStockExtended` to be the
default and migrate the few legacy call sites. Out of scope.

### F-230c-NF-4 — **non-finding**: deterministic iteration order

REGISTRY in `methods/index.js` is an array; `_loadAllMethods` iterates
in array order; `evaluateStock` iterates `METHODS` in the same order.
Results are inserted into a plain object whose key iteration order is
insertion order for string keys (per ES2015 spec). Order is
deterministic across runs as long as `methods/index.js` is unchanged.

### F-230c-NF-5 — **non-finding**: per-method exception isolation

`H.wrapEvaluate` (methods/_helpers.js:253-259) wraps `method.evaluate`
in try/catch and returns a `buildResult({computable:false, reason:
'error: ...'})` on throw. A single method's throw cannot kill the run
or contaminate other methods' results.

### F-230c-NF-6 — **non-finding**: duplicate id detection

`_loadAllMethods` uses `seenIds` Set and throws on duplicate — Tag 134
behavior intact.

---

## Verification

All three test suites pass after the two fix commits:

| Suite | Result |
|-------|--------|
| `tag28-tests.js` | 155/155 (fixture-hash stable) |
| `engine-cli-tests.js` | 10/10 |
| `tests/integration-anchor-test.js` | 10/10 |

Atomic-write smoke test confirmed: writeJsonAtomic + writeFileAtomic
(string + Buffer overloads) round-trip cleanly through the new
write-all-sync + dir-fsync path on Windows. Discord smoke test
confirmed: no-webhook returns false safely; 3000-char payload truncated
to 2000 with suffix; unreachable host returns false without throwing
after retry exhaustion.

---

## Coverage statement

All three target modules read end-to-end. Cross-checked against:
- `methods/_helpers.js` (wrapEvaluate try/catch contract)
- `methods/method-types.js` (REGISTRY + isDisqualifiedByDataGuards)
- `methods/index.js` (registry array — never edited per audit constraint)
- callers of `postDiscord` (3 scripts: check-pull-stats,
  picks-regression-check, lib/discord itself)
- writers using `atomic-write` (refresh-fx, watchlist, picks-history,
  snapshot-picks, FTS cache, alert-state, methodHistory)

No further HIGH findings remain in these three modules after the
applied fixes.
