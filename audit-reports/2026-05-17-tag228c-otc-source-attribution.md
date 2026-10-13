# Tag 228c — OTC Source-Attribution Investigation

**Date:** 2026-05-17
**Trigger:** Tag 227a finding F2 — `discovery/otc-markets.js` MAX_PAGES=10 (up to 5,000 OTC tickers),
but zero `added_via: 'otc-markets'` entries in `watchlist.json`.

## Diagnosis

The hypothesis was one of:
- (a) OTC refresh failing silently
- (b) `added_via` attribution lost in the discovery → universe-merge pipeline
- (c) OTC tickers filtered out at a later stage

**Actual cause: a historical variant of (b) — already fixed in code; residual data
remains in `watchlist.json`.**

### Watchlist forensics (no live fetches)

```
Total stocks:                   15 734
lastUniverseRefresh:            2026-05-15T10:51:24.413Z
added_via distribution:
  10 858  auto-universe-refresh   ← all added 2026-05-14 17:13
   4 018  (none)
     568  manual-tag-110b
     222  manual-tag-110
      66  tag-115-manual
       2  nasdaq-trader
       0  otc-markets / sec-edgar / finnhub / wikipedia / nasdaq-api
```

Among the 10 858 `auto-universe-refresh` entries:
- 3 966 match the classic OTC pattern `^[A-Z]{5}F$` (5-letter ending in F, e.g. `AACAF`,
  `AAGAF`, `AAGFF`) — foreign-listed ADRs trading OTC
- 3 966 have `exchange_hint: 'US'` — a value used **only** by `discovery/sec-tickers.js`
  (line 59: `result.set(ticker, { ticker, name, cik, exchange: 'US', source: 'sec-edgar' })`)

So those entries came from `sec-edgar`, not `otc-markets` — but the `source` field
was discarded and they all collapsed into `auto-universe-refresh`.

### Root cause: F-DP-015 pre-fix code wrote this watchlist

```
2026-05-14 17:13   refresh-universe.js writes 10 858 new tickers
                    → source attribution dropped → all tagged "auto-universe-refresh"
2026-05-14 19:10   commit ac602b639  "chore: yahoo-pull + alert-state"
                    (auto-pull bot commits the corrupted watchlist)
2026-05-15 06:38   commit c59dcb418  "Tag 169: Full 110-bug audit fix"
                    → adds F-DP-015 — preserve source attribution in merge
2026-05-15 10:51   refresh-universe.js runs again (lastUniverseRefresh field)
                    → no new tickers (universe already saturated)
                    → existing 10 858 entries are NOT retroactively re-tagged
                      because the dedupe gate (line 396) skips them
```

The OTC fetch is not failing. The merge does not filter OTC. The bug existed in
`refresh-universe.js` pre-Tag-169 and is fully fixed in current code (verified by
re-running the merge logic in isolation against synthetic `sec-edgar`/`otc-markets`
discovery output — `source` propagates correctly through to `added_via`).

### Why zero `otc-markets` entries specifically

Two compounding effects:
1. **Historic bug overrode source for all discovery sources** — including `otc-markets`.
2. **OTC tickers also appear in `sec-tickers`** — SEC EDGAR includes every SEC-registered
   issuer, which covers OTCQX/OTCQB constituents. Once `sec-tickers` set the entry first
   (or the Yahoo screener buckets did via overlapping coverage), `otc-markets` hit the
   `else` branch where source-concat would have applied — but the pre-Tag-169 `else`
   branch was a no-op.

After the next monthly refresh runs on the current code, newly-IPO'd OTC tickers
will land with `added_via: 'otc-markets'`. The existing 10 858 historical entries
cannot be retroactively re-tagged without a live discovery re-run (forbidden per
Tag 228c constraints — no live SEC / NASDAQ / OTC HTTP).

## Fix

**Code (`refresh-universe.js`)**: F-DP-015 in Tag 169 already correctly preserves
`source` through the merge. No additional functional fix is needed.

**Surfacing diagnostic**: Added per-source new-ticker breakdown logging immediately
before the watchlist write. Example output on a healthy run:

```
  new-ticker source attribution: sec-edgar=412 otc-markets=89 nasdaq-api=33 finnhub=12
```

If a future regression silently drops `info.source` again, the operator sees
`auto-universe-refresh=N` for all entries in the run log — instead of waiting
months for an audit to catch it. Fixture-hash-safe (no method change).

## Data remediation (deferred)

The 10 858 `auto-universe-refresh` entries are functionally correct; only their
attribution metadata is wrong. Options for retroactive cleanup:

1. **Do nothing** — accept the historical noise; let the source-attribution metric
   accumulate correctly for tickers added going forward. Cleanest path.
2. **Pattern-based reclassification** — script that reassigns `added_via` for
   `^[A-Z]{5}F$` patterns to `sec-edgar` (heuristic; not 100% accurate; conflates
   true sec-edgar with cases where Yahoo screener happened to surface the same
   ticker).
3. **One-shot discovery re-run** — call all six discovery sources in a dry-run
   script that builds source maps without HTTP cache-busts, then re-tag matched
   tickers. Requires the forbidden live HTTP fetches.

Recommendation: option 1 (do nothing). The attribution is only used in audit
reports like Tag 227a; future entries will be correct.

## Constraints honored

- No live SEC / NASDAQ / OTC HTTP fetches performed
- No modifications to `methods/index.js`
- No modifications to `FTS_CACHE_VERSION`
- Verification ran against existing `watchlist.json` + git history only
