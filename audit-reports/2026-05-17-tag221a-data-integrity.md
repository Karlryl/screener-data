# Tag 221a — Data Integrity Audit

**Date:** 2026-05-17
**Scope:** Read-only sampling/integrity scan of all on-disk data the screener writes and reads (no code changes). Code was already audited Tag 215–220.

---

## 1. Executive Summary

The data tree is structurally **healthy** (no parse errors, no delisted-but-not-purged snapshots, no stale fetchedAt, no ticker/filename mismatches, no truly orphan snapshot files, no NaN/Infinity leaks beyond expected nulls) — **but it has three large class-of-problem issues**:

1. **Tag 211l / Tag 219 schema rollout is essentially un-deployed.** Only **12 / 3 527** snapshots and **12 / 4 135** cache files carry the new `annualSGA` / `annualShares` / `_quality` / `insiderActivity` fields (0.3 %). Every method that depends on those fields is silently NaN-out for 99.7 % of the universe.
2. **Watchlist is bloated and inconsistent vs. snapshots/alert-state.** 15 734 watchlist tickers vs. 3 527 snapshot files → **12 207 watchlist tickers never produced a snapshot**. 376 entries are preferred shares (`ABR$D`, `AHT$G` …) and 1 is a literal company name (`STMicroelectronics`). 6 200 alert-state tickers minus 3 527 snapshots → **2 969 alert-state tickers without backing snapshot**.
3. **History date sequence has a gap (2026-05-12 missing in both `picks-history/` and `methods-history/`)**, and the daily snapshot is a vintage source for backtests — a missing Tuesday breaks rolling-window jobs that bridge that date.

A handful of secondary issues (cache version field missing, near-empty `external-data/aktienfinder.json`, very thin 13F/Form4 caches, 6 orphan method IDs in alert-state, 38 registered methods never tracked) — all medium/low priority.

**Total findings: 13.**

---

## 2. Per-Directory Findings Table

| Dir / File | Sampled | Critical | Med | Low | Headline issue |
|---|---|---|---|---|---|
| `snapshots/` | 30 + full scan of 3 527 | **1** | 0 | 0 | Only 12/3527 carry Tag 211l/219 fields |
| `picks-history/` | 7 files (full) | **1** | 1 | 0 | Date gap 2026-05-12; schema drift (`evaluatedTickers` added 05-14) |
| `methods-history/` | 7 files (full) | 0 | 2 | 0 | Method-count grew 26→43, stocks grew 2 495→4 150; per-stock keys added (`quality`, `nanRatio`, `inputs`); same 05-12 gap |
| `fundamentals-cache/` | 20 random + full scan of 4 135 | **1** | 1 | 0 | No `FTS_CACHE_VERSION` anywhere; 12/4 135 have new fields |
| `external-data/` | 5 files (full) | 0 | 2 | 1 | `aktienfinder.json` is `{}`; 13F=1 institution; Form4=5 tickers |
| `alert-state.json` | full | 0 | 2 | 0 | 6 orphan method-IDs; 38 registered methods never written; 2 969 ticker entries with no snapshot |
| `fx-rates.json` | full | 0 | 0 | 1 | 33 currencies, 0 failed, but 2 d old (last 2026-05-15) |
| `watchlist.json` | full | **1** | 1 | 1 | 376 preferred-share tickers (`$`), 1 company-name ticker, 12 207 entries with no snapshot, 790 empty names |

---

## 3. Critical Issues

### C1. Tag 211l / Tag 219 schema rollout never propagated  (snapshots + cache)

* Scan of **all 3 527 snapshot files**: `annualSGA` present in **12**, `annualShares` present in **4**, `_quality` present in **12**, `insiderActivity` present in **12**.
* Scan of **all 4 135 cache files**: `payload.ftsAnnualSGA` in **12**, `payload.ftsAnnualShares` in **4**.
* The 12 files are exactly the 12 newest mega-cap pulls (AVGO, BABA, COST, CRDO, GOOG, MELI, META, MSFT, NVDA, PLTR, TSM, V) — all from 2026-05-17 partial runs.
* Every other ticker still has the pre-Tag-211l shape (`annual` keys: `annualRev, annualOpInc, annualNetIncome, annualGP, annualFCF, annualOCF, annualBalance, annualRnD, annualSBC, annualCapex, annualSGA[no], annualDepreciation, annualShares[no]`).
* **Impact:** Any method introduced by Tag 211l (SG&A trend / R&D-cut guard / Mauboussin intangible-adj. ROIC / share-count delta) silently returns null for 99.7 % of universe, then is reported as a clean "0 pass" without flagging missing inputs.
* **Recommendation:** Full re-pull (`pull-yahoo --force-refresh`) before relying on any Tag 211l-and-later score.

### C2. Watchlist contains 376 preferred-stock tickers + 1 corrupt entry; 12 207 tickers have never pulled a snapshot

* `watchlist.json::stocks` = **15 734** entries.
* **376** have `$` in the symbol (`ABR$D`, `AHT$G`, `AGM$D` … — NYSE preferred-share series). These are not Yahoo equity tickers; Yahoo uses dash format (`ABR-PD`) for the same instruments. They will return 404 from Yahoo and waste API budget.
* **1** entry is `{"ticker":"STMicroelectronics","yahoo_symbol":"STMicroelectronics","name":"STMicroelectronics",...}` — a company name where a symbol should be (real Yahoo symbol is `STMPA.PA` / `STM`).
* **12 207** watchlist tickers have **no corresponding `snapshots/<ticker>.json`** (i.e. 77 % of watchlist never produced a snapshot, even though `added_via` for many is `auto-universe-refresh` from 2026-05-14).
* **790** entries have an empty `name`, **15 714** have a null `isin` (basically the whole list).
* **Recommendation:** (a) drop `$`-containing tickers; (b) drop the literal-name entry; (c) decide if `auto-universe-refresh` is over-collecting or if `pull-yahoo` is silently dropping 12 k symbols (the latter would explain why alert-state also only covers 6 200 of them).

### C3. Date gap 2026-05-12 in both `picks-history/` and `methods-history/`

* Both folders contain `2026-05-08, 09, 10, 11, 13, 14, 15`. **Tuesday 2026-05-12 is missing** from both.
* No system-wide US holiday on that date; this looks like a daily-pull workflow miss.
* Backtests / `compute-picks-lookback.js` that walk the vintage list day-by-day will either crash or silently bridge over the gap, distorting `firstSeen` calcs.
* **Recommendation:** Confirm whether 2026-05-12 was a workflow failure (check CI logs); if needed reconstruct from `alert-state.json` + raw snapshots of that date if mtimes still exist.

### C4. `fundamentals-cache/` has no `FTS_CACHE_VERSION` field at all (vs. expected version 2)

* Every one of the 4 135 cache files has top-level shape `{ cachedAt, payload }`. **None** carry `FTS_CACHE_VERSION` (neither at root nor inside `payload`).
* If `pull-yahoo` uses absence-of-version → treat-as-v0 → invalidate, then every cache is effectively invalid (which would force re-pull). If it uses absence-of-version → treat-as-current, then the cache is silently grandfathered past the version-2 schema upgrade.
* **Recommendation:** Inspect `pull-yahoo` cache-read path. Either back-fill the version field or document that "no version key" === v2.

---

## 4. Medium / Low Issues

### M1. Schema drift inside `methods-history/`
* `2026-05-08.json`: 2 495 stocks, 26 methods per stock, per-stock keys `[results, computable, passing]`.
* `2026-05-15.json`: 4 150 stocks, 43 methods per stock, per-stock keys `[results, computable, passing, quality, nanRatio, inputs]`.
* Any historical comparison that diff's the JSON tree will see giant "false changes". Backtest comparisons across the gap need a schema-aware reader.

### M2. Schema drift inside `picks-history/`
* `2026-05-08 … 2026-05-13`: keys `[asOf, universeSize, modes, benchmarks]`.
* `2026-05-14, 15`: adds `evaluatedTickers`. Same backtest-diff risk as M1.

### M3. 6 orphan method-IDs in `alert-state.methodState`
Methods present in state but not produced by any current `methods/*.js` file:
`reinvestment-rate, fcf-yield, deceleration-guard, forecast-contamination-guard, quarter-concentration-guard, quarterly-rev-acceleration`.
These are old IDs (renamed/removed). They bloat the 21 MB file and the diff-report.

### M4. 38 registered methods are never tracked in `alert-state.methodState`
Including the entire Tag 200-210 cohort: `analyst-revision-breadth, beneish-m-score, capex-vs-sbc-quality, capital-allocation-quality, fcf-stability, intangible-adjusted-roic, ohlson-o-score, rd-cut-guard, sector-relative-roic, ...` (38 total).
Implies `detect-changes` was last fully run before these methods were registered, or it silently skips methods it doesn't recognize.

### M5. `external-data/sec-13f-cache.json` has only 1 institution
`byInstitution` has exactly one key. `sec-13f-by-ticker.json` derives only 6 ticker mappings from it. Tag 210-class "institutional-ownership-13f" method will be near-useless until more institutions are populated.

### M6. `external-data/sec-form4-cache.json` covers only 5 tickers
With 180-day lookback. `insider-net-buying` / `insider-buy-cluster` will be effectively null for 99.9 % of universe.

### L1. `external-data/aktienfinder.json` is empty (`{}\r\n`)
Either intentional placeholder or the pull never ran.

### L2. `fx-rates.json` has no top-level `asOf` / `updatedAt` (only `fetchedAt`)
33 currencies, `failed: []`. Last fetched 2026-05-15 → 2 d old at audit time. Per-currency `lastSuccessAt` exists, so this is cosmetic only.

### L3. `_first-seen.json` only tracks 3 modes (`HYPERGROWTH, QUALITY_COMPOUNDER, TURNAROUND`)
If more modes have been added since, their first-seen dates won't be retroactively reconstructable.

---

## 5. Cleanup Recommendations (Prioritised)

| # | Action | Files affected | Why |
|---|---|---|---|
| 1 | **Trigger full `pull-yahoo --force-refresh`** | ~3 515 snapshots + 4 123 cache | Roll Tag 211l/219 schema across the whole universe |
| 2 | **Filter watchlist**: drop `ticker` matching `/\$/`, drop literal company-name entry (`STMicroelectronics`) | watchlist.json (-377 entries) | Stops wasted Yahoo 404 calls + cleans data |
| 3 | **Backfill / explain 2026-05-12 gap** | picks-history, methods-history | Restore daily continuity for backtests |
| 4 | **Prune orphan method-IDs** from `alert-state.methodState` | alert-state.json | Drops 6 stale method names from each of 6 200 tickers; shrinks file noticeably |
| 5 | **Add `FTS_CACHE_VERSION: 2`** when next-writing cache files | fundamentals-cache/*.json | Schema discipline; lets pull-yahoo invalidate cleanly in future |
| 6 | **Investigate why 12 207 watchlist tickers never produced a snapshot** | pull-yahoo logs | Either pull is silently dropping them, or watchlist refresh is over-collecting |
| 7 | **Re-run / extend SEC 13F + Form 4 pull** | external-data/sec-* | Make institutional-ownership-13f and insider-* methods usable |
| 8 | **Decide fate of `external-data/aktienfinder.json`** | external-data/ | Either populate or delete |

---

**Methodology:** Node REPL scans, no code mutation; samples sized per task (5 oldest + 5 newest + 20 random for snapshots, full reads of small JSON, byte-counted reads of large JSON). All claims above are reproducible from on-disk state at the audit timestamp (2026-05-17).
