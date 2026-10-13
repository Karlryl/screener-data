# Tag 218b — `scripts/` Folder Audit (in-scope subset)

**Date:** 2026-05-17
**Scope:** All `scripts/*.js` files **NOT** already audited under Tag 216 / Tag 217. The eight files previously audited (`walk-forward-perf.js`, `method-effectiveness.js`, `snapshot-score-history.js`, `pipeline-health-check.js`, `refresh-fx.js`, `pull-historical-prices.js`, `pull-insider-form4.js`, `pull-13f-institutional.js`) are excluded.
**Audited by:** Read-only audit agent. No code modified.

---

## 1. Executive Summary

Twelve scripts read end-to-end (1,861 LOC). Most are mature with substantial prior bug-hunt scar tissue (Tag 168 health-reports, Tag 179 schema-aware fallbacks, Tag 189 atomic-write rollout). **No P0** (data-corruption-this-run) defects found. **One P1** (silent data loss in `regional-oos-test.js`) and a **systematic P2** finding: nine scripts still write committed JSON / MD / CSV / HTML artifacts with plain `fs.writeFileSync` instead of `writeFileAtomic` — the same class of defect that Tag 217e closed in four other puller scripts. A SIGKILL or CI timeout mid-write on any of these will commit a truncated/zero-byte file into git that downstream consumers (Dashboard, methodology cross-references) will either parse-error on or read as empty.

| Severity | Count |
|----------|-------|
| P0 (immediate data corruption / wrong picks) | 0 |
| P1 (silent data loss / wrong report)         | 2 |
| P2 (atomic-write inconsistency / robustness) | 9 |
| P3 (cosmetic / dead-code / doc drift)        | 5 |
| **Total**                                    | **16** |

The Tag 168 pipeline-health contract is **not** violated: every script enumerated in `EXPECTED_SCRIPTS` (`snapshot-picks`, `snapshot-methods-history`, `generate-modes-report`, `snapshot-score-history`) lives outside this audit's scope, and the in-scope scripts are not required to emit health reports.

---

## 2. Files Audited

| File | LOC | Workflow step (daily-pull.yml) |
|------|-----|--------------------------------|
| `scripts/methodology-report.js`     | 174 | Methodology Report |
| `scripts/prune-watchlist.js`        | 163 | Prune Watchlist |
| `scripts/check-pull-stats.js`       | 166 | Pull-Stats Check |
| `scripts/compute-method-drift.js`   | 136 | Compute Method-Drift |
| `scripts/macro-regime.js`           | 112 | Compute Macro Regime |
| `scripts/pick-diff.js`              | 211 | Pick Diff + Jaccard |
| `scripts/elliott-export.js`         | 143 | Elliott CSV Export |
| `scripts/archive-old-snapshots.js`  | 167 | Archive Old Snapshots |
| `scripts/picks-regression-check.js` | 185 | Picks-Regression Check |
| `scripts/regional-oos-test.js`      |  94 | (ad-hoc; not in daily-pull) |
| `scripts/threshold-audit.js`        | 113 | (ad-hoc; not in daily-pull) |
| `scripts/data-quality-report.js`    | 197 | (ad-hoc; not in daily-pull) |
| **Total**                           | **1,861** | |

---

## 3. Findings

### F-218b-01 (P1) — `regional-oos-test.js` silently skips dotted-stem and Windows-reserved tickers

- **File:** `scripts/regional-oos-test.js:31`
- **Mechanism:** Snapshot loader is naive: `JSON.parse(fs.readFileSync(path.join(SNAP_DIR, t + '.json'), 'utf8'))`. `pull-yahoo.js` (and the in-scope `prune-watchlist.js` / `elliott-export.js`) all wrap ticker→filename through `safeSnapshotFilename`, which (a) sanitises `[^A-Z0-9.-]` to `_`, and (b) prefixes the file with `_` when the stem matches `^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$` on Windows. None of that is applied here, so `BRK.B`, `CON` (Conn's), and any ticker whose write-side path was sanitised will silently `continue` past the try/catch on line 32. Result: under-counts the HG-passing universe, and any single-ticker analysis Karl does from the OOS report is silently incomplete.
- **Severity:** P1. The script is ad-hoc, but it is documented as the OOS test that defends Karl's threshold-tuning discipline (Tag 129). A silently truncated OOS view is the worst-case input to that decision.
- **Fix sketch:** Replace ticker→filename with a copy of `safeSnapshotFilename()` (already exists in `prune-watchlist.js:46-51` and `elliott-export.js:32-39`). Long-term: lift `safeSnapshotFilename` into `lib/snapshot-fs.js` and have all four call-sites import it.

### F-218b-02 (P1) — `regional-oos-test.js` US regex excludes dotted US listings

- **File:** `scripts/regional-oos-test.js:17`
- **Mechanism:** `US: /^[A-Z]{1,5}$/` matches only undotted 1-5-letter symbols. Real US tickers with class suffixes (`BRK.B`, `BF.B`, `RDS.A`, `GOOG`/`GOOGL` are fine but `BRK.B` is not) fall through into the `OTHER` bucket, where the report drops them entirely (line 71's loop iterates `['US', 'JP', 'AU', 'KR', 'OTHER']` but the section header `## Top-20 pro Region` on line 78 only iterates US/JP/AU/KR — `OTHER` is computed but never rendered).
- **Severity:** P1 (silent data loss in OOS report; magnitude small but exactly the class of bias the script claims to defend against).
- **Fix sketch:** Either `US: /^[A-Z]{1,5}(\.[A-Z])?$/` or rule by *exclusion*: if no other regex matches, classify as US.

### F-218b-03 (P2) — Non-atomic writes to nine committed output files

The Tag 189 `writeFileAtomic` helper was rolled out across the puller scripts (Tag 217e closed four more occurrences). The following committed-into-git artifacts still use plain `fs.writeFileSync` and are vulnerable to SIGKILL / CI timeout mid-write:

| File:Line | Output | Committed? |
|-----------|--------|-----------|
| `scripts/methodology-report.js:166`        | `outputs/methodology-report.md`              | yes |
| `scripts/check-pull-stats.js:131,133`      | `outputs/pull-stats/history.json` + per-day  | yes |
| `scripts/compute-method-drift.js:66,124`   | `outputs/method-drift.json` + `.html`        | yes |
| `scripts/macro-regime.js:73,108`           | `outputs/macro-regime.json`                  | yes |
| `scripts/pick-diff.js:146,149,196`         | `outputs/pick-diff-*.json`, `pick-diff.json`, `pick-diff.html` | yes |
| `scripts/picks-regression-check.js:130`    | `outputs/picks-regression-*.json`            | yes |
| `scripts/elliott-export.js:134`            | `outputs/elliott-export-<MODE>.csv`          | yes |
| `scripts/data-quality-report.js:190`       | `outputs/data-quality-report.md`             | yes |
| `scripts/regional-oos-test.js:89`          | `outputs/regional-oos-*.md`                  | yes |

- **Mechanism:** Identical to F-SM-021 / F-SC-003 (the rationale cited inside `lib/atomic-write.js`): a partial write commits a truncated file. Downstream `walk-forward-perf.js` and the Pages deploy step both `cp -r outputs/.` so the corrupted output ships to the public Pages site.
- **Severity:** P2 collectively. Likelihood per run is low; impact when it happens is a visibly broken downstream artifact. Tag 217e already established the precedent and the one-line fix.
- **Fix sketch:** `const { writeFileAtomic } = require('../lib/atomic-write.js')` at the top of each file; replace each `fs.writeFileSync(p, body)` with `writeFileAtomic(p, body)`. Mechanical, no behavioural change.

### F-218b-04 (P2) — `archive-old-snapshots.js` `appendFileSync` is non-atomic

- **File:** `scripts/archive-old-snapshots.js:101` (also `:103` writeFileSync)
- **Mechanism:** `fs.appendFileSync(ndjsonPath, linesNew)` is append-buffered: a SIGKILL during the write can leave a half-line at the end of the NDJSON. The next run's parse-loop on line 86 (`for (const ln of existingLines) { try { JSON.parse(ln) } catch (_) {} }`) silently swallows that line, then the `existingDates` Set is missing the truncated entry → that date re-archives next time, but worse, the existing partial line *stays in the file* indefinitely.
- **Severity:** P2. The archive lives in `external-data/` which is gitignored, so it never propagates to the repo, but Karl's local archive accumulates rot. The verify-then-unlink guard on lines 107-114 only checks line 1 — it does not detect a corrupt tail.
- **Fix sketch:** Either (a) keep appendFileSync but verify with `fs.readFileSync` + `split('\n').forEach(JSON.parse)` before unlinking originals; or (b) read existing, concat in memory, `writeFileAtomic` the whole file. (b) is safer.

### F-218b-05 (P2) — `prune-watchlist.js` crashes on legacy / corrupt watchlist shape

- **File:** `scripts/prune-watchlist.js:105-106`
- **Mechanism:** `const wl = JSON.parse(fs.readFileSync(args.watchlist, 'utf8'));` then `wl.stocks.length` with zero defensive checks. The workflow's own "Verify Watchlist Sanity" gate (daily-pull.yml:100) explicitly handles three shapes — array, `{stocks:[...]}`, and bare-object — because Tag 207a documented this exact crash mode. Prune-watchlist trusts only the middle shape and `TypeError: Cannot read properties of undefined (reading 'length')` on the others. The step has `continue-on-error: true` so CI marches on, but the prune was silently skipped.
- **Severity:** P2. Failure mode is "watchlist grows unbounded for one run" — recovers on the next run if shape is fixed upstream.
- **Fix sketch:** Mirror the workflow's schema-aware loader on line 105:
  ```js
  const wl = JSON.parse(fs.readFileSync(args.watchlist, 'utf8'));
  const stocks = Array.isArray(wl) ? wl
              : Array.isArray(wl && wl.stocks) ? wl.stocks
              : null;
  if (!stocks) { console.error('watchlist shape unrecognised'); process.exit(0); }
  ```

### F-218b-06 (P2) — `macro-regime.js` crashes when `prices/history.json` missing

- **File:** `scripts/macro-regime.js:67`
- **Mechanism:** `const history = JSON.parse(fs.readFileSync(args.history, 'utf8'))` — no try/catch, no `main` wrapper. The script does handle the *empty-series* case (lines 70-83) with a graceful empty fallback, but the *missing-file* case explodes before reaching that branch. The workflow step uses `continue-on-error: true`, so the next downstream step (`walk-forward-perf`) reads stale `outputs/macro-regime.json` indefinitely without producing the "no_price_data" sentinel that the empty-series branch emits.
- **Severity:** P2.
- **Fix sketch:** Wrap `main()` in `try { … } catch (e) { writeEmptyFallback(); }` symmetric to the empty-series branch.

### F-218b-07 (P3) — `archive-old-snapshots.js` default `--keep-days 14` contradicts header comment

- **File:** `scripts/archive-old-snapshots.js:7` ("older than 60 days") vs. `:28` (`keepDays: 14`)
- **Mechanism:** Comment drift from Tag 134 → Tag 153 (which lowered the default to 14 and added per-directory overrides). The daily-pull workflow overrides all three explicitly so production behaviour is correct, but a maintainer reading the header is misled.
- **Severity:** P3. Cosmetic.
- **Fix sketch:** Update the header to say "default 14 days, see Tag 153 for per-directory overrides".

### F-218b-08 (P3) — `pick-diff.js` HG/QC/TURNAROUND mode list is hardcoded twice

- **File:** `scripts/pick-diff.js:101, 128, 167, 201`
- **Mechanism:** Four call-sites duplicate `['HYPERGROWTH', 'QUALITY_COMPOUNDER', 'TURNAROUND']`. If a fourth mode is ever added to `methods/strategy-modes.js`, this script silently ignores it and the pick-diff HTML shows no diff for it.
- **Severity:** P3. Latent bug, dormant until a new mode is added.
- **Fix sketch:** `const MODES = Object.keys(latest.modes);` once per call, then iterate.

### F-218b-09 (P3) — `elliott-export.js` hard-codes the same three-mode list implicitly through `latest.modes`

- **File:** `scripts/elliott-export.js:78`
- **Mechanism:** This one is actually OK — iterates `Object.entries(latest.modes)` so a new mode IS picked up. Noted here only because the *companion* pick-diff.js does not. Marking F-218b-08 as the canonical fix-site.
- **Severity:** P3 (informational; clean).

### F-218b-10 (P3) — `picks-regression-check.js` Infinity-drift edge case never logged

- **File:** `scripts/picks-regression-check.js:67-69`
- **Mechanism:** When median is 0 but today > 0, the script pushes `drift: Infinity`. Later, line 165's template uses `(a.drift*100).toFixed(0)` which on Infinity renders as `"Infinity"`. The Discord alert message thus contains `"…drift=Infinity% up…"`. Cosmetic.
- **Severity:** P3.
- **Fix sketch:** `drift: med === 0 ? '∞' : roundedDrift` and special-case the formatter.

### F-218b-11 (P3) — `compute-method-drift.js` HTML totalStocks denominator can be misleading

- **File:** `scripts/compute-method-drift.js:91-92`
- **Mechanism:** `computablePct = last.computableCount / last.totalStocks`. `totalStocks` is `Object.keys(file.stocks).length` for the *latest* vintage only. If the universe shrinks/grows between vintages, the sparkline trend tells a different story than the % indicator. Documented as informational; not a defect per se but worth pinning down semantically.
- **Severity:** P3 (semantic-clarity).

### F-218b-12 (P3) — `check-pull-stats.js` falls open when watchlist is legacy-array shape

- **File:** `scripts/check-pull-stats.js:67`
- **Mechanism:** `wl && Array.isArray(wl.stocks) ? wl.stocks.length : null`. Legacy array-form watchlist returns null → `universeSize` metric becomes null → drift detection ignores it. Behaviour is graceful but inconsistent with the schema-aware workflow gate on daily-pull.yml:100.
- **Severity:** P3.
- **Fix sketch:** Mirror the three-shape check.

---

## 4. Clean Files

The following files are clean against all standard-10 bug categories and the script-specific patterns I looked for:

- `scripts/threshold-audit.js` — pure read-only git scraper; no file writes; defensive `sh()` swallows execSync failures intentionally; clean.
- `scripts/data-quality-report.js` — modulo F-218b-03 (atomic-write), the grading logic is correctly defensive (try/catch around `f.get(s)`, schema-aware exchange fallback, parse-error counter); F-SC-032 already hardened the require()-on-grading-module path.

---

## 5. Cross-Script Data-Flow Notes

### 5.1 Pipeline-Health-Contract (Tag 168)

`EXPECTED_SCRIPTS` in `scripts/pipeline-health-check.js:19-27` lists exactly four: `snapshot-picks`, `snapshot-methods-history`, `generate-modes-report`, `snapshot-score-history`. **None of the twelve in-scope scripts are required to emit a health report**, and the contract is intact. (Verified by `grep` for `pipeline-health` across the repo — only `snapshot-score-history.js` and `pipeline-health-check.js` in `scripts/` mention it, and that's by design.)

### 5.2 Atomic-Write Inconsistency

The repo has three classes of `writeFileSync` callers:

1. **Migrated to `writeFileAtomic`:** `refresh-fx.js`, `prune-watchlist.js:159`, the four files closed by Tag 217e, and several root-level pullers.
2. **Tag 217e-style candidates remaining:** the nine call-sites enumerated in F-218b-03 above. All write committed-into-git output files (under `outputs/`).
3. **Acceptable as-is:** `method-effectiveness.js` (cache file `pipeline-health/method-effectiveness-cache.json` — survives loss), `walk-forward-perf.js` (Tag 217 reviewed), the archive NDJSON in `external-data/` (gitignored, F-218b-04 covers the corruption-tail issue).

Recommend folding the nine F-218b-03 sites into one follow-up commit (mirroring Tag 217e's pattern: `require('../lib/atomic-write.js')` + s/writeFileSync/writeFileAtomic/g per file).

### 5.3 `safeSnapshotFilename` duplication

Three copies exist in scope (`prune-watchlist.js:46-51`, `elliott-export.js:32-39`, and missing-but-needed in `regional-oos-test.js:31`). Plus one in `pull-yahoo.js`. **Recommend extraction** into `lib/snapshot-fs.js` to eliminate F-218b-01 and similar future drift.

### 5.4 Discord-Webhook Pattern Consistency

`check-pull-stats.js` and `picks-regression-check.js` each carry their own private `postDiscord(content)` implementation (lines 102-117 and 82-99 respectively). Both implement the same fire-and-forget pattern that Tag 181 / F-SC-007 explicitly hardened in `pipeline-health-check.js` to use `await fetch` + AbortController. If either of these private clients hits a hung Discord webhook, the script process will exit before the request completes and the alert is silently dropped. Same defect as F-SC-007; same fix.

---

*End of report.*
