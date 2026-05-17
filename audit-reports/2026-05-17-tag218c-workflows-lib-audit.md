# Tag 218c — Workflows + Lib Audit

**Date:** 2026-05-17
**Auditor:** Claude (read-only)
**Scope:** `.github/workflows/daily-pull.yml`, `.github/workflows/monthly-sec-xbrl.yml`, `lib/atomic-write.js`, `package.json`, `package-lock.json`

---

## 1. Executive Summary

The CI pipeline shows strong defensive engineering: multiple sanity gates (watchlist size, fx-rates freshness, snapshot freshness, manifest freshness, coverage gate, pipeline-health-check), retry-with-rebase push logic, atomic writers in scripts that touch committed state, and a serialization concurrency group that correctly prevents the daily and monthly workflows from clobbering each other.

That said, the audit found **11 findings** spread across the two workflow files, the atomic-write helper, and the package manifest. None are critical/data-loss class. Two are **HIGH** (silent skip of the coverage gate when the freshness gate exits non-zero; monthly-sec-xbrl still uses the pre-Tag-179 destructive rebase fallback). The remainder are **MEDIUM/LOW** — edge cases, doc/script drift, dependency hygiene.

**Severity breakdown:** 0 critical, 2 high, 5 medium, 4 low.

---

## 2. Files Audited

| Path | LOC | Status |
|------|----:|--------|
| `.github/workflows/daily-pull.yml` | 550 | 8 findings |
| `.github/workflows/monthly-sec-xbrl.yml` | 96 | 2 findings |
| `lib/atomic-write.js` | 56 | 1 finding (LOW) |
| `package.json` | 19 | 2 findings (LOW) |
| `package-lock.json` | 323 | scanned for known-vulnerable deps — clean |

---

## 3. Findings

### F-218c-01 — HIGH — daily-pull.yml: `Verify Snapshot Freshness` has `continue-on-error: true` while emitting an `::error::` and `process.exit(1)`

**File:** `.github/workflows/daily-pull.yml:170-195`

**Mechanism:** The Tag 192 freshness gate runs Node, prints `::error::F-CI-016 …`, and calls `process.exit(1)` when fewer than 50% of snapshots are fresh. But the step is annotated `continue-on-error: true # Tag 192: WARN initially; flip to fail-on-error after first cron observation`. The comment says "flip after first observation" — Tag 192 has long been in production (the workflow has since gone through Tag 207b, 215e, etc.). The gate is currently a no-op: stale-pull data still flows into snapshot-picks / detect-changes / walk-forward and contaminates vintages, which was the original design concern.

**Suggested fix:** Remove `continue-on-error: true` from this step, or convert the `process.exit(1)` to `process.exit(0)` so the warning state is honest. Recommend removing `continue-on-error` since the gate is conceptually a vintage-integrity guard.

---

### F-218c-02 — HIGH — monthly-sec-xbrl.yml: destructive `git reset --hard` fallback re-introduced

**File:** `.github/workflows/monthly-sec-xbrl.yml:73-85`

```
git rebase --autostash --strategy-option theirs origin/main || { git rebase --abort; git reset --hard origin/main; }
```

**Mechanism:** Tag 179 (F-CI-001 v2) removed exactly this pattern from daily-pull because it caused **silent data loss**: rebase fails → `git reset --hard origin/main` discards the just-made commit → subsequent `git push` succeeds as a no-op → workflow exits green with no data on remote. The daily-pull was fixed (`.github/workflows/daily-pull.yml:450-481` captures `COMMIT_SHA` and cherry-picks back on rebase failure), but monthly-sec-xbrl was never updated and still carries the original buggy pattern. Lower exposure (monthly cadence, manifest is tiny) but the failure mode is identical.

**Suggested fix:** Port the Tag 179 v2 pattern from daily-pull.yml: capture `$(git rev-parse HEAD)` before the rebase, abort cleanly on rebase failure, and cherry-pick back if the local commit is missing from history.

---

### F-218c-03 — MEDIUM — daily-pull.yml: `concurrency.cancel-in-progress: false` blocks manual `workflow_dispatch` re-runs

**File:** `.github/workflows/daily-pull.yml:15-17`

**Mechanism:** With `cancel-in-progress: false` plus an `main-push` group shared with monthly-sec-xbrl, a `workflow_dispatch` triggered while either workflow is running will sit **queued** for up to ~180 minutes (daily-pull timeout) waiting for the in-flight run. If the operator triggers a manual rerun believing the prior was stuck, the new run does not start until the old times out — and on free GitHub-Actions plans the queued job can be evicted entirely. The current pattern is correct for **scheduled** runs (don't lose the day's data), but operators should know manual dispatches queue, not preempt.

**Suggested fix:** Either accept the current behavior and document it explicitly in a comment, or switch to a per-event group: `group: ${{ github.event_name == 'workflow_dispatch' && format('manual-{0}', github.run_id) || 'main-push' }}` so manual runs get their own group while scheduled runs serialize.

---

### F-218c-04 — MEDIUM — daily-pull.yml: env-var drift between three "score-multiplier"-aware steps

**File:** `.github/workflows/daily-pull.yml:275-291` (Generate Screener Dashboard + Snapshot Score-History both set `AUDIT_SCORE_MULTIPLIERS: '1'`)

**Mechanism:** Snapshot Picks-History (`.github/workflows/daily-pull.yml:298-300`) and Snapshot Methods-History (`.github/workflows/daily-pull.yml:319-321`) write committed history but do **not** set `AUDIT_SCORE_MULTIPLIERS`. The Tag 203 design comment explicitly warns that "drift here produces a permanent fake 'score uplift today' artifact". If `snapshot-picks.js` or `snapshot-methods-history.js` happens to read score values into history, they record the un-multiplied scores, while screener.html and score-history record the multiplied scores. The Tag 199 comment says picks/modes-report should keep un-multiplied scores for fixture-hash stability — that's fine — but it means the score-history modal's ΔScore badges can show a +X delta against a different baseline than the picks-history file would suggest. Recommend documenting this design choice explicitly in a workflow comment near both steps.

**Suggested fix:** Add a comment block above Snapshot Picks-History stating "intentionally NOT setting AUDIT_SCORE_MULTIPLIERS — see Tag 199/203 design notes" so future contributors don't naively add it.

---

### F-218c-05 — MEDIUM — daily-pull.yml: Pipeline Health Check is unprotected — its failure permanently blocks GitHub Pages deploy

**File:** `.github/workflows/daily-pull.yml:490-497` + `:505-506`

**Mechanism:** Pipeline Health Check is the first hard-fail step after the commit; the Deploy step gates on `if: success()`. If health-check exits 1 (e.g. score-history failed >5% of stocks for one bad-Yahoo day), the deploy is **skipped silently**: stale gh-pages content lingers and the user reads yesterday's screener while the runner already committed today's fresh data to main. There is no Discord alert telling the user "data updated, pages NOT deployed". The current `Notify on failure` step does fire (`if: failure()`), but the message only says "Yahoo-Pull failed" — operators can't distinguish "data corrupted" from "data fine, only health gate tripped".

**Suggested fix:** Either (a) make Deploy run on `if: always() && steps.commit.outcome == 'success'` so the latest committed data always reaches gh-pages, or (b) add a step ID to Pipeline Health Check and have Notify-on-failure include `health-check.outcome` in its Discord payload so operators can interpret the failure.

---

### F-218c-06 — MEDIUM — daily-pull.yml: `Verify Pull Coverage` and `Verify FX-Rates Freshness` parse `stat -c %Y` without checking for empty/missing files

**File:** `.github/workflows/daily-pull.yml:118-133`, `:149-162`

**Mechanism:** `stat -c %Y file 2>/dev/null || echo 0` defaults to zero on missing file. The freshness check then computes `age_days=$(( (now - 0) / 86400 ))` ≈ 600,000 days, which trips the `> 30` hard-fail. For fx-rates this is masked by the `[ -f fx-rates.json ]` outer test, but the **manifest freshness** check at line 149-162 lacks the same outer guard at the right place: if `snapshots/_manifest.json` exists but `stat` errors (permission, race), `manifest_mtime=0` and the script silently `rm -f`'s the manifest, forcing the file-count fallback even when the manifest is perfectly fresh.

**Suggested fix:** Replace `|| echo 0` with `|| { echo "::warning::stat failed on $f — keeping file"; manifest_mtime=$now; }` so a stat error doesn't fall through to "treat as ancient → delete".

---

### F-218c-07 — MEDIUM — daily-pull.yml: `Run Method Tests` step uses pipe-to-`||` which masks tag22/tag28 if tag21 fails

**File:** `.github/workflows/daily-pull.yml:60-64`

```
echo "--- tag21 ---" && node tag21-tests.js && echo "tag21 PASS" || { echo "tag21 FAIL"; exit 1; }
echo "--- tag22 ---" && node tag22-tests.js && echo "tag22 PASS" || { echo "tag22 FAIL"; exit 1; }
echo "--- tag28 ---" && node tag28-tests.js && echo "tag28 PASS" || { echo "tag28 FAIL"; exit 1; }
```

**Mechanism:** The shell sequence works as intended (each line is independent in `bash`), but `set -e` is **not** enabled by default in GitHub Actions `run:` blocks unless `shell: bash` is specified — GHA runs bash with `--noprofile --norc -eo pipefail` by default. The `&& ... || { ...; exit 1 }` pattern actually short-circuits the `&&` chain because of `pipefail`, so the explicit `exit 1` is what protects you. Fine in practice, but fragile: if someone deletes one of the `|| { ... }` blocks during cleanup, the tests would silently pass on failure (the `echo "PASS"` would fire regardless of node's exit status if `set -e` isn't ensured).

**Suggested fix:** Replace with a simpler/safer form: `set -e; for t in tag21-tests.js tag22-tests.js tag28-tests.js; do echo "--- $t ---"; node "$t"; done`.

---

### F-218c-08 — MEDIUM — daily-pull.yml: `Snapshot Picks-History` lost the `Tag 134 hard-fail` semantics (now silent)

**File:** `.github/workflows/daily-pull.yml:298-300`

**Mechanism:** The comment above the step still reads "Tag 134: hard-fail. picks-history is the source of truth for backtest; a silent gap of even one week destroys vintage continuity" but the step is `continue-on-error: true`. The Tag 168 comment justifies this — Pipeline Health Check is supposed to enforce the 5% threshold. But Pipeline Health Check has `EXPECTED_SCRIPTS` of only four entries (`snapshot-picks`, `snapshot-methods-history`, `generate-modes-report`, `snapshot-score-history` per `scripts/pipeline-health-check.js:19-27`), and the threshold is per-script-soft-fail rate, not "did the script crash before writing". So if `snapshot-picks.js` crashes on a fatal error (e.g. ENOSPC, unhandled exception) it now exits non-zero, the step is masked by continue-on-error, **and** the F-CI-002 "missing report = 100% failure" logic in pipeline-health-check.js catches it. Acceptable — but the documentation drift between the comment and the actual behavior is a maintenance hazard.

**Suggested fix:** Rewrite the comment block to: "Tag 168: continue-on-error — Pipeline Health Check enforces 5% per-stock failure threshold AND F-CI-002 missing-report=100%-fail rule. Tag 134 hard-fail semantics now enforced indirectly."

---

### F-218c-09 — LOW — lib/atomic-write.js: no fsync before rename — power-loss corruption window on POSIX

**File:** `lib/atomic-write.js:35-46`

**Mechanism:** `fs.writeFileSync` returns once data has reached the OS page cache; `fs.renameSync` is atomic against concurrent readers but does not flush either the file content or the parent directory entry. On a CI runner that's losing power mid-write this is academic (the runner is gone anyway), but if `writeFileAtomic` is ever used in a long-running daemon or on a developer laptop, a power loss between `rename` and the kernel's writeback flush can leave the renamed file with zero content. Industry-standard atomic-rename helpers (`write-file-atomic` npm package, `pwrite` libraries) open the tmp file, write, `fsync(fd)`, close, `rename`, then `fsync(dirfd)`.

**Suggested fix:** Add `const fd = fs.openSync(tmp, 'w'); fs.writeSync(fd, data); fs.fsyncSync(fd); fs.closeSync(fd);` before the rename. Cost is one extra syscall per write; for the small JSON files written here it's negligible.

---

### F-218c-10 — LOW — package.json: `engines.node` says `>=22` but `package-lock.json` and `yahoo-finance2` say `>=20`

**File:** `package.json:12-14` vs `package-lock.json:14-16` and `package-lock.json:317-319`

**Mechanism:** `package.json` declares `"node": ">=22"` (matches the workflow's `node-version: '22'`). `package-lock.json` was generated when the engines field was `>=20` and never refreshed. The only consequence today is that `npm ci` will warn about engines mismatch on Node 20 if anyone runs it locally; with Node 22 in CI it's silent. Worth refreshing the lockfile on the next dependency change so the lockfile reflects the source-of-truth declaration.

**Suggested fix:** Run `npm install --package-lock-only` to regenerate the lockfile's engines metadata next time the deps are touched. Not urgent.

---

### F-218c-11 — LOW — package.json: scripts section is missing every operational script

**File:** `package.json:7-11`

**Mechanism:** `scripts` defines only `pull`, `pull:fast`, `pull:single` — none of the 25+ scripts referenced by the workflow have a npm-script alias. New contributors discovering the project via `npm run` see only the raw pull commands; they have to read `daily-pull.yml` to discover `refresh-universe.js`, `prune-watchlist.js`, `pipeline-health-check.js`, etc. Workflow itself uses `node script.js` directly so this is purely a discoverability/DX issue, not a correctness one.

**Suggested fix:** Add `test`, `refresh-fx`, `prune`, `pull:full` (chains the workflow's core steps), and at minimum a `start` or `help` script that prints a one-liner about available entry points.

---

## 4. Clean Elements

- **`lib/atomic-write.js`** path collision avoidance via `pid + monotonic counter` is correct for the in-process case; cleanup on rename failure is defensive and uses the right `try/catch` shape.
- **No path-traversal concern** in atomic-write — the helper is a thin wrapper, traversal-defense responsibility lies (correctly) with the caller.
- **No known-vulnerable transitive deps** found in `package-lock.json`. Dependency surface is minimal (only `yahoo-finance2@3.14.0` + transitive). `yahoo-finance2 < 3.0` had cookie-store issues — 3.14.0 is safe.
- **F-CI-001 v2 logic in daily-pull commit step** (`.github/workflows/daily-pull.yml:450-481`) is exemplary: captures SHA pre-rebase, detects commit loss, restores via cherry-pick. This is the pattern that should be ported to monthly-sec-xbrl (see F-218c-02).
- **Tag 207a/207b schema-aware watchlist size** (`.github/workflows/daily-pull.yml:100`, `:208`) correctly handles all three historical shapes (array, `{stocks:[…]}`, legacy object).
- **Manifest deletion at pull start** ensures `Check Manifest Freshness` and the file-count fallback give a truthful picture when a pull times out mid-run.
- **`concurrency: main-push` correctly shared** between daily-pull and monthly-sec-xbrl — the 1st-of-month overlap window is genuinely closed.
- **Action version pinning is correct**: `actions/checkout@v4` and `actions/setup-node@v4` are pinned to major versions, no `@latest` anywhere.
- **`npm ci --no-audit --no-fund`** is the right install command for CI (faster, deterministic, no network noise).

---

## 5. Workflow Data-Flow (Verbal Diagram)

```
                 ┌───────────────────────────────────────────────────────────┐
                 │                       daily-pull.yml                      │
                 └───────────────────────────────────────────────────────────┘

[Checkout + Setup Node + npm ci]
   │
   ▼
[Engine Tests + Method Tests]          (HARD-FAIL gate — never reaches pull on engine bugs)
   │
   ▼
[Refresh Universe] ──► watchlist.json (continue-on-error)
   │
   ▼
[Prune Watchlist] ──► watchlist.json (continue-on-error)
   │
   ▼
[Verify Watchlist Sanity]              (HARD-FAIL — Tag 207a schema-aware, ≥200)
   │
   ▼
[Refresh FX-Rates] ──► fx-rates.json (continue-on-error)
   │
   ▼
[Verify FX-Rates Freshness]            (HARD-FAIL if >30 days; WARN >7 days)
   │
   ▼
[Run Yahoo Pull] ──► snapshots/*.json, snapshots/_manifest.json (continue-on-error, 165min timeout)
   │
   ▼
[Check Manifest Freshness]             (deletes stale manifest >4h old → file-count fallback)
   │
   ▼
[Verify Snapshot Freshness]            ← F-218c-01 (gate gagged by continue-on-error)
   │
   ▼
[Verify Pull Coverage]                 (HARD-FAIL on <max(2500, 18% of total))
   │
   ▼
┌──────────────────────────────── PRODUCERS ────────────────────────────────┐
│  detect-changes ──► alert-state.json                                      │
│  sector-medians-compute                                                   │
│  generate-modes-report ──► modes-report.html, pipeline-health/            │
│  generate-screener (AUDIT_SCORE_MULTIPLIERS=1) ──► screener.html          │
│  snapshot-score-history (AUDIT_SCORE_MULTIPLIERS=1) ──► score-history/    │ ← F-218c-04
│  snapshot-picks (NOT multiplied) ──► picks-history/                       │ ← F-218c-04
│  picks-regression-check (reads picks-history)                             │
│  snapshot-methods-history ──► methods-history/                            │
│  pull-earnings-dates, pull-historical-prices ──► prices/                  │
│  macro-regime (reads prices), walk-forward-perf (reads picks + prices)    │
│  method-effectiveness, methodology-report (read all above)                │
│  pick-diff (reads picks-history), elliott-export                          │
│  check-pull-stats (Discord alert)                                         │
│  compute-method-drift, generate-diff-report, generate-dashboard           │
│  archive-old-snapshots (rewrites methods-history/, picks-history/)        │
└───────────────────────────────────────────────────────────────────────────┘
   │
   ▼
[Strip methodHistory from alert-state]  (HARD-FAIL on corrupt JSON; tmp+rename)
   │
   ▼
[Commit Snapshots + Alert-State]        (Tag 179 v2 — captures SHA, cherry-picks on rebase loss)
   │
   ▼
[Pipeline Health Check]                 (HARD-FAIL — 5% per-script threshold + F-CI-002 missing-report rule)
   │                                    ← F-218c-05 (failure here silently blocks Deploy)
   ▼
[Deploy to GitHub Pages]                (`if: success()` — skipped on ANY upstream failure)
   │
   ▼
[Notify on failure]                     (`if: failure()` — single Discord webhook, no per-step context)
```

**Where ordering could break:**

1. **`detect-changes` runs BEFORE `Pipeline Health Check`** — by design (commits first, gate second), but if detect-changes produces a Discord alert and the health-check then fails, the user sees a "new pick!" alert for data that did not deploy to gh-pages (F-218c-05).
2. **`archive-old-snapshots` mutates `methods-history/` and `picks-history/`** mid-pipeline, after `walk-forward-perf` / `method-effectiveness` consume them — order is correct, but a future contributor adding another consumer downstream of archive would silently miss the archived files. Recommend a comment block at the archive step listing "must run last among history-readers".
3. **`Verify Snapshot Freshness` failure (when un-gagged)** would block all of the producers below, including `detect-changes` — that's the intended Tag 192 design, but operators should know that a single bad-Yahoo day will silence the Discord alert path too.

---

## 6. Recommendations (priority order)

1. **Fix F-218c-01** — remove `continue-on-error: true` from `Verify Snapshot Freshness`. One-line change, restores the Tag 192 vintage-integrity guard that has been silently dormant.
2. **Fix F-218c-02** — port Tag 179 v2 rebase-loss recovery from daily-pull to monthly-sec-xbrl. Tiny code, removes a silent-data-loss class bug.
3. **Fix F-218c-05** — decouple gh-pages deploy from health-check outcome (option a) OR enrich Notify-on-failure (option b). Without this, "data drifts from screener" failure mode is invisible to operators.

Lower-priority items (F-218c-03, 04, 06–11) are documentation/hygiene fixes that can be batched.
