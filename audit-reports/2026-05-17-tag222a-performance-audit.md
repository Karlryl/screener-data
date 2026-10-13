# Tag 222a — Performance Audit (Scaling to 19k Tickers)

**Date:** 2026-05-17
**Scope:** Read-only audit. CPU + memory hotspots that don't scale from current 3,529 tickers to the 19k+ target.
**Baseline:** snapshot dir 15.7 MB (3,529 files), alert-state.json 20.6 MB, method-history-state.json 8.5 MB, prices/history.json 4 MB, latest methods-history daily file 26 MB.
**Method:** Static analysis. For each script, identified loops over the universe, repeated O(N) lookups, redundant deep clones, and total-data-in-memory points. Estimated scaling by (19000 / 3529) ≈ 5.4× linear factor; squared (29.2×) for O(N²) paths.

---

## Executive summary

12 findings total. **3 are blocking before the universe grows past ~8–10k.** Five hotspots involve redundant whole-state work that grows with the corpus, not the universe (rolling history × file count, cache replay × vintages, deep-clones × ticker count). Five are quadratic patterns inside per-stock loops that only bite at 19k. Two are I/O hotspots already fixed in the recent Tag 218 pass for `sortByStaleness` — confirming the pattern is well understood. None of the report-generator HTML payloads are blocking: F-GR-001 (Tag 220 + Tag 221c) already capped the worst output at 200 picks with a shared `STOCK_DATA_MAP`.

**The single most dangerous projection:** `pull-historical-prices.js` writes `prices/history.json` pretty-printed via `JSON.stringify(history, null, 2)`. Today ~4 MB. At 19k tickers × 400 days, the pretty-printed string projects to ≈ 280 MB held in memory before write. That is well past V8's 512 MB default string limit and will hard-fail on the 4 GB CI runner. Verified by extrapolating current size: 4 MB / 3,529 ≈ 1.1 KB/ticker × 19k = 21 MB minified, ≈ 250–280 MB pretty-printed. **Action: strip `null, 2`.**

**Yahoo Pull duration projection:** at PULL_CONCURRENCY=8 with 12s timeout + 15s/45s/90s retries, each ticker averages ~2.8s on the worker pool. Today 3,529 / 8 × ~2.8s ≈ 21 minutes pure work — but observed 163min. Network time dominates, so 19k linearly = (19000/3529) × 163 = **877 min ≈ 14.6 hours**, far exceeding the 240-min job timeout. The price-only fast-path (Tag 166, 7-day freshness) covers most days; **only the first run after a universe-doubling sees the full 14h**. After steady-state, ~3k tickers/day rotate, so ongoing daily ≈ 163 min stays. Recommendation: raise PULL_CONCURRENCY to 16–20 if Cloudflare 429 rate is acceptable (was 20 pre-Tag 215f), AND staleness-batch into N independent runner jobs sharded by `ticker.charCodeAt(0) % N`.

---

## Top 10 hotspots ranked by impact

| # | Severity | Hotspot | File:line | Cur. cost | 19k cost |
|---|---|---|---|---|---|
| 1 | BLOCKING | `JSON.stringify(history, null, 2)` for full prices/history.json | pull-historical-prices.js:167 | ~12 MB string | ≈280 MB string, OOM |
| 2 | BLOCKING | `method-effectiveness.js` rebuilds `perMethod` by replaying entire cache on every run | scripts/method-effectiveness.js:254-269 | ~2-5s | ~140s + 4-8 GB RAM at corpus growth |
| 3 | BLOCKING | `detect-changes.js` two deep-clones of full alert-state via `JSON.parse(JSON.stringify(...))` | detect-changes.js:292-293 | 20.6 MB ×2 = ~3-5s | ~115 MB ×2 ≈ 25-40s + GC pressure |
| 4 | HIGH | `generate-methods-report.js` final pass-count log: 2×rows.filter per method | generate-methods-report.js:1141-1145 | ~0.4s (83 × 2 × 3,529) | ~12s (83 × 2 × 19k) |
| 5 | HIGH | `generate-methods-report.js` method-summary HTML: same `rows.filter` × 2 per method | generate-methods-report.js:414-418 | ~0.4s | ~12s |
| 6 | HIGH | `pull-historical-prices.js` per-stock `history[t].find(e => e.date === today)` in main pull loop | pull-historical-prices.js:107 | ~0.1ms × 3.5k = 0.4s | ~2s |
| 7 | MEDIUM | `walk-forward-perf.js` `computeFrozenVintageMedianReturn` + `computeBenchmarkReturn` called per-mode×horizon instead of per-horizon | scripts/walk-forward-perf.js:320-321 | ~5× redundant work | ~5× redundant work (same factor, but n grows) |
| 8 | MEDIUM | `generate-modes-report.js` `Runner.METHODS.find(m => m.id === ...)` inside per-card / per-mode loops | generate-modes-report.js:340, 438 | small (3 modes × top-N) | linear with topN; cap 200, so ≤ small |
| 9 | MEDIUM | `pull-historical-prices.js` SPY backfill: `.find()` inside per-quote loop (~400 quotes) | pull-historical-prices.js:148-152 | 80k comparisons | unchanged (per-SPY) — kept for completeness |
| 10 | MEDIUM | `detect-changes.js` two full sync-readdir + sync-readFile loop over snapshots (no Runner parallelism) | detect-changes.js:297, 306-332 | ~10-20s | ~55-110s |

---

## Per-file findings

### 1. pull-historical-prices.js:167 — **BLOCKING at 19k**
```js
writeFileAtomic(histPath, JSON.stringify(history, null, 2));
```
- **Complexity:** O(N tickers × 400 days) string build, pretty-printed = ~7× the minified size.
- **Today:** prices/history.json is 4 MB. Pretty-printed factor is moderate because numeric values dominate. At 19k that grows to 21–28 MB minified → 200+ MB pretty-printed in a single intermediate V8 string.
- **Fix:** `JSON.stringify(history)` (drop `null, 2`). Saves CPU and ~70% of peak heap during the stringify. Also consider writing per-ticker shards (one JSON per `prices/by-ticker/TICKER.json`) so partial updates don't re-serialize all 19k. **Est. speedup at 19k: critical — converts a hard-fail OOM into a 2-3s write.**

### 2. scripts/method-effectiveness.js:254-269 — **BLOCKING (corpus, not universe)**
```js
// "NOTE: The cache replay loop above has a bug for the pass lookup — re-do it cleanly..."
for (const key of Object.keys(perMethod)) delete perMethod[key];
for (const [cacheKey, entries] of Object.entries(cache.vintageReturns)) {
  // ...replays ALL cache entries every run...
}
```
- **Complexity:** O(vintages × tickers × methods × horizons). The first cache loop at lines 148-171 is wasted — the second loop completely throws it away and rebuilds. Author left a comment acknowledging this is a workaround for an earlier bug.
- **Today:** 7 vintages × ~3.5k tickers × ~83 methods × 2 horizons ≈ 4 M iterations, ~2-5s.
- **Cache file grows unbounded with vintage count.** Daily run writes new cache entries; nothing prunes old vintages. Within a year (365 vintages × 19k × 83 × 2) = **1.15 billion iterations** per run, plus the cache file itself becomes multi-GB.
- **Fix:** Eliminate the dead first loop (lines 140-238 only need to write `cache.vintageReturns[cacheKey]`, no in-memory accumulation). Then accumulate `perMethod` directly inside the second loop on a per-vintage basis from the cache (already done correctly there). Also: trim cache entries to last 90 days at the top of `main()` (`for (const k of Object.keys(cache.vintageReturns)) { const [d] = k.split('|'); if (d < cutoff) delete cache.vintageReturns[k]; }`). **Est. speedup: 2× (eliminate dead first loop) + bounded memory.**

### 3. detect-changes.js:292-293 — **BLOCKING**
```js
methodState: JSON.parse(JSON.stringify(state.methodState || {})),
methodHistory: JSON.parse(JSON.stringify(state.methodHistory || {})),
```
- **Complexity:** O(2 × size-of-state). Comment cites "F-SM-014: deep clone prior state so tickers absent from a partial pull are NOT deleted."
- **Today:** alert-state.json is 20.6 MB → ~25 MB in-memory. Two JSON.parse(JSON.stringify(...)) round-trips = 4 full O(N) walks. ~3-5s wall time, multiple GB transient heap. method-history-state.json is 8.5 MB so add another 1-2s.
- **At 19k:** state files scale linearly with ticker count → ~115 MB alert-state. Each parse-stringify ≈ 12-18s plus heap doubling.
- **Fix:** A structural copy is not needed if you copy keys only when about to write. Replace with:
  ```js
  // Copy only the references — entries for current-run tickers are reassigned below.
  methodState: Object.assign({}, state.methodState || {}),
  methodHistory: Object.assign({}, state.methodHistory || {}),
  ```
  This is a shallow copy. Since the loop at line 316 reassigns `newState.methodState[ticker] = tickerNewState` (replacing the reference entirely), shallow is sufficient. Tickers absent from the current pull keep their old reference intact, satisfying F-SM-014's intent. **Est. speedup at 19k: 12-18s × 2 → <100ms.**

### 4 & 5. generate-methods-report.js:414-418 and :1141-1145 — **HIGH**
```js
const methodSummary = methods.map(m => {
  const computable = rows.filter(r => r.results[m.id].computable).length;
  const passing = rows.filter(r => r.results[m.id].pass).length;
  // ...
});
```
- **Complexity:** O(M × N × 2) per call. M ≈ 83 methods, N ≈ rows.
- **Today:** 83 × 3,529 × 2 ≈ 590k field accesses. ~0.4s.
- **At 19k:** 83 × 19,000 × 2 ≈ 3.2M accesses. ~3-4s × 2 occurrences = ~7s extra.
- **Fix:** single forward pass:
  ```js
  const counts = {};
  for (const r of rows) {
    for (const m of methods) {
      const c = counts[m.id] || (counts[m.id] = { computable: 0, passing: 0 });
      const x = r.results[m.id];
      if (x && x.computable) { c.computable++; if (x.pass) c.passing++; }
    }
  }
  ```
  **Est. speedup: 4-5×.** Saves ~10s at 19k.

### 6. pull-historical-prices.js:107 — **HIGH** (already covered by Tag 218 pattern, but missed here)
```js
const existing = history[stock.ticker].find(e => e.date === today);
if (!existing) history[stock.ticker].push({ date: today, close: latestClose });
history[stock.ticker] = history[stock.ticker].slice(-400);
```
- **Complexity:** O(N entries) `.find` per stock, in the parallel worker pool. Each stock's history has ~400 entries.
- **Today:** ~400 × 3,529 = 1.4M comparisons, masked by network latency.
- **At 19k:** 7.6M comparisons. Still small in CPU but `.slice(-400)` allocates a new array every call.
- **Fix:** since the array is sorted ascending by date, just check the last element:
  ```js
  const arr = history[stock.ticker];
  if (arr.length === 0 || arr[arr.length - 1].date !== today) {
    arr.push({ date: today, close: latestClose });
    if (arr.length > 400) arr.splice(0, arr.length - 400);  // in-place trim
  }
  ```
  **Est. speedup: ~3×** at 19k tickers, and reduces GC churn.

### 7. scripts/walk-forward-perf.js:320-321 — **MEDIUM**
```js
for (const [mode, allPicks] of Object.entries(picksFile.modes || {})) {
  // ...
  for (const days of HORIZONS_DAYS) {
    // ...
    const frozenVintage = computeFrozenVintageMedianReturn(priceIndex, picksFile, entryDate, days);
    const benchResult = computeBenchmarkReturn(priceIndex, entryDate, days);
```
- `frozenVintage` only depends on `(picksFile, entryDate, days)` — NOT on `mode`. F-PF-003 hoisted universe-median; the same hoist was missed for these two.
- **Today:** ~5 modes × 3 horizons × 7 vintages = 105 redundant calls.
- **At 19k corpus (365 vintages):** ~5,475 redundant calls, each scanning all tickers-at-vintage. Each `computeFrozenVintageMedianReturn` is ~5–20 ms today.
- **Fix:** Hoist both above the per-mode loop:
  ```js
  const frozenByHorizon = {}, benchByHorizon = {};
  for (const days of HORIZONS_DAYS) {
    frozenByHorizon[days] = computeFrozenVintageMedianReturn(priceIndex, picksFile, entryDate, days);
    benchByHorizon[days]  = computeBenchmarkReturn(priceIndex, entryDate, days);
  }
  ```
  **Est. speedup: 5× on these two functions** (one per mode instead of N modes).

### 8. generate-modes-report.js:340, 438 — **MEDIUM**
- `Runner.METHODS.find(m => m.id === mid)` is O(M) per lookup, called inside `chips` (line 339) and `byMust` (line 436) loops.
- **Fix:** at module top, build `const METHODS_BY_ID = new Map(Runner.METHODS.map(m => [m.id, m]));` then `METHODS_BY_ID.get(mid)`. **Est. speedup: ~80× per call**, negligible today but compounds when topN scales.

### 9. pull-historical-prices.js:148-152 — **MEDIUM** (single-ticker, low priority)
SPY backfill builds a 400-entry history with `.find()` per quote (~400² = 160k comparisons). Tiny in absolute terms. Replace with a Set of existing dates for O(N). Listed for completeness; not on critical path.

### 10. detect-changes.js:297, 306-332 — **MEDIUM**
- Sync `fs.readFileSync` over every snapshot, in serial. ~3,529 files today × ~5ms each = ~18s.
- **At 19k:** ~95s pure I/O. Plus `Runner.evaluateStock(stock)` per file, sync.
- snapshot-methods-history.js already solved this (`loadFilesAsync` with `fs.promises.readFile` + batched Promise.all). Apply the same pattern to detect-changes. **Est. speedup: 3-4×** (libuv thread pool default 4 workers).

---

## Memory scaling analysis

**Safe to 19k:**
- Per-snapshot file size ~4-5 KB on disk, ~15-20 KB deserialized. 19k × 20 KB = ~380 MB. Safe on the 4 GB runner *as long as we don't keep the whole array around* — the streaming `for (const f of files) { const s = JSON.parse(...); buildRow(s); }` pattern in `generate-screener.js` is correct.
- `methods/runner.js` METHODS array (~83 modules) and `methods/index.js` REGISTRY load once at startup. Independent of N.
- `sector-medians-compute.js` builds buckets keyed by sub-profile (~12 buckets × 4 metrics × N values) → ~76k floats today, ~410k at 19k. Trivial.

**Unsafe (will OOM / push past 4 GB):**
- `pull-historical-prices.js`: holds the entire `history` object in memory (line 71) AND builds the full pretty-printed JSON string in memory before write (line 167). Combined peak ≈ 500-600 MB at 19k.
- `detect-changes.js`: holds `allStocks` (line 311) — every parsed snapshot — AND deep-clones the full `state.methodState` twice (line 292-293) AND keeps `newState.methodHistory` (mutating each ticker). Combined peak ≈ 800 MB+ at 19k. Currently runs without `--max-old-space-size` override.
- `generate-methods-report.js` and `generate-modes-report.js` keep `rows`/`evaluated` (each with embedded `results`, `trends`, full `stock` ref via modes-report's `evaluated[i].stock`) for the full universe. Modes-report at 19k ≈ 400 MB peak. Should add `--max-old-space-size=4096` overrides OR refactor to stream snapshots → write top-N picks → discard.

**Files growing unbounded:**
- `methods-history/YYYY-MM-DD.json`: 26 MB latest. Linear with N. At 19k ≈ 140 MB/day. Multi-month corpus → 50+ GB on disk. `archive-old-snapshots.js` keeps 7 days; that bounds it.
- `score-history/`: missing today (0 files). Once populated, one file per ticker — N files of growing size.
- `outputs/method-effectiveness-cache.json`: cache grows by ~150 KB/vintage today, projects to ~800 KB/vintage at 19k. Unpruned. After 1 year × 19k = 290 MB cache file, replayed in full on every run (see Finding #2).
- `snapshots/_manifest.json`: already capped, good.

---

## Workflow-step duration projection (3,529 → 19,000 tickers)

| Step | Current | Scaling | Projected |
|---|---|---|---|
| Yahoo Pull (full pull, no fast-path) | 163 min | linear ×5.4 | **877 min** (>240 min hard timeout) |
| Yahoo Pull (steady-state, price-only fast-path 7d) | 163 min | linear ×5.4 | **~877 min** still; price-only is ~80% of pulls today, that ratio holds |
| Pull Historical Prices | 15 min | linear ×5.4 | 81 min (network-bound) + ~30s extra writes |
| generate-screener.js | 30s | linear ×5.4 (no quadratic hotspots) | ~160s |
| generate-methods-report.js | 60s | linear ×5.4 + ~10s fix-#4 + ~5s fix-#5 | ~340s without fixes, ~310s with |
| generate-modes-report.js | not measured | linear | ~3× current |
| snapshot-methods-history.js | not specified | linear × 5.4 + JSON write cost | manageable; output file 140 MB |
| detect-changes.js | not specified | linear × 5.4 + deep-clone overhead | sync I/O is the bottleneck; 95s+ without fixes |
| walk-forward-perf.js | 5-15 min | depends on vintage count + #7 fix | 10-30 min |
| method-effectiveness.js | 5-10 min | grows quadratically with corpus (#2) | **uncapped without fix** |

**Key conclusion:** the 240-min daily-pull job timeout is breached at ~5-7k tickers (Yahoo Pull alone). Sharding the Yahoo Pull into N parallel matrix-job runs is the unavoidable architectural change; without it, no amount of CPU optimization saves the steady-state daily.

---

## Recommendations in priority order

1. **Immediate (this week):** Fix #1, #3, #4, #5. Cumulative saving: prevents OOM in pull-historical-prices and detect-changes at the ~6-8k threshold; removes ~25s from generate-methods-report at 19k.
2. **Before 8k threshold:** Fix #2 (cache replay) and add a 90-day cache-prune. Add `--max-old-space-size=4096` to detect-changes, generate-methods-report, and generate-modes-report invocations.
3. **Before 10k threshold:** Shard Yahoo Pull via GitHub Actions matrix strategy (e.g., 4 shards of ~5k tickers each, run in parallel). Each shard writes to `snapshots/` (no conflict since files are per-ticker). A small `merge-manifests` step combines `_manifest.json`. This single change cuts Yahoo Pull wall time from 14h projected to 3.5h.
4. **Nice-to-have:** Fixes #6, #7, #8, #10. Useful but not blocking.
