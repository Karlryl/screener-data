# Tag 217a — Discovery + Pullers Audit

Audit date: 2026-05-17
Scope: `discovery/` (6 files), `refresh-universe.js`, `scripts/prune-watchlist.js`, `scripts/refresh-fx.js`, `pull-historical-prices.js`, `pull-yahoo.js` (orchestrator parts: 1–300, 1530–end), `lib/atomic-write.js`.
Methodology: full read of every file in scope; cross-grep for `writeFileSync`, redirect/timeout patterns, retry shapes, regex anchors; verified ticker regex and source-dedupe behaviour in Node REPL.

## Executive Summary

**12 findings.**

| Severity | Count |
|----------|-------|
| HIGH     |   3   |
| MEDIUM   |   5   |
| LOW      |   4   |

**Net effect of HIGH findings:** ~1–3% of US universe (BRK.B, BF.B, RDS.A class shares) is permanently invisible to the discovery layer; `pull-historical-prices.js` writes the 400-day history file non-atomically and can poison itself with truncated JSON on CI SIGTERM (the very pattern that triggered the Tag 189 atomic-write refactor everywhere else); Finnhub fails silently on auth errors with no diagnostic, masking the HTTP 401 root cause that Karl already saw in Run #107.

---

## Findings

### F-217a-01 — HIGH — Ticker regex rejects every class-share (`.A`, `.B`, `-B`)
- **Files:** `discovery/sec-tickers.js:53`, `discovery/nasdaq-api.js:166`, `discovery/otc-markets.js:149`
- **Description:** All three sources gate symbols through `/^[A-Z][A-Z0-9]{0,4}[A-Z]?$/`. The accompanying comments claim *"allow class suffix like .A, .B"* — but the regex has no `.` or `-` in the character class, so any ticker with a dot or hyphen is silently dropped.
- **Mechanism:** Verified in Node REPL: `BRK.B`, `BF.B`, `BRK-B`, `RDS.A` all return `false`. The SEC's `company_tickers.json` actually carries Berkshire as `BRK-B` (hyphen), Brown-Forman as `BF-B` — both rejected. Wikipedia's `extractTickersFromWikitext` uses `/^[A-Z][A-Z0-9]{0,5}$/`, which also rejects dots. Only `nasdaq-all.js` (parses the pipe-delimited NASDAQ Trader file) and `pull-yahoo.js`'s own screeners admit dot-tickers — and only the latter via `BRK.B` style. Net: SEC discovery currently has zero class-B Berkshire exposure; same for Brown-Forman, Heico-A, Moog-A, etc.
- **Suggested fix:** Change all three call sites to `/^[A-Z][A-Z0-9]{0,4}([.\-][A-Z])?$/` and update the wikipedia regex similarly. Add a single test `node -e "require('./discovery/sec-tickers').fetchSecTickers().then(m=>console.log(m.has('BRK-B'), m.has('BRK.B')))"` for permanent regression cover.

### F-217a-02 — HIGH — `pull-historical-prices.js` writes `history.json` non-atomically
- **File:** `pull-historical-prices.js:159-160`
- **Description:** Both `${today}.json` and `history.json` are written with raw `fs.writeFileSync`. The file at lines 60-75 has explicit corruption-recovery logic (back up, exit 1 unless `RESET_HISTORY=1`) demonstrating that Karl already KNOWS this file gets corrupted — yet the writer that produces the corruption was never migrated to `lib/atomic-write.js` (Tag 189 migrated nine other writers).
- **Mechanism:** GitHub Actions SIGTERM at the 165-min cancellation boundary lands inside `writeFileSync` → truncated `history.json` → next pull hits the corruption branch → exit 1 → daily pipeline blocked until manual `RESET_HISTORY=1` (which destroys months of cumulative history). This is the exact F-SM-021 pattern.
- **Suggested fix:**
  ```js
  const { writeFileAtomic } = require('./lib/atomic-write.js');
  writeFileAtomic(path.join(args.out, `${today}.json`), JSON.stringify(todaysSnapshot, null, 2));
  writeFileAtomic(histPath, JSON.stringify(history, null, 2));
  ```

### F-217a-03 — HIGH — `discovery/finnhub.js` 401 leaves no actionable diagnostic
- **File:** `discovery/finnhub.js:36-48, 73-95`
- **Description:** Run #107 reported `[Finnhub] US failed: HTTP 401`. The `get()` helper does `reject(new Error('HTTP ' + res.statusCode))` — no response body, no URL, no `WWW-Authenticate` header, no distinction between "key invalid" / "key expired" / "rate-limit exceeded" / "exchange not in plan tier". Caller silently moves to the next exchange and repeats the failure 17 times (one per `EXCHANGES`). The script also sends no `User-Agent` header (the only discovery source without one).
- **Mechanism:** Finnhub returns `{"error":"Invalid API key"}` body on 401; the current code never reads it. With 17 401s logged identically, Karl cannot distinguish "GitHub secret expired" from "Finnhub deprecated the `/stock/symbol` endpoint" from "exchange code KS is now subscription-only".
- **Suggested fix:** On non-200, drain the body and include the first 200 chars + URL minus token in the error. Also: short-circuit on the first 401 — if the US exchange returns 401, every other exchange will too; skip the remaining 16 calls. Adding a UA (`screener-data/1.0 (github.com/Karlryl/screener-data)`) costs nothing.

### F-217a-04 — MEDIUM — Cross-source source attribution accumulates duplicates
- **File:** `refresh-universe.js:326-330`
- **Description:** When a ticker is hit by ≥3 discovery sources, the comparison `existing.source !== newSource` does a string compare against the ENTIRE comma-joined history. Verified: starting from `nasdaq-trader,sec-edgar` and adding `sec-edgar` again yields `nasdaq-trader,sec-edgar,sec-edgar`. Same for adding `nasdaq-trader` later (would append duplicate).
- **Mechanism:** Same ticker can legitimately come from `nasdaq-trader` then `nasdaq-api` then `sec-edgar` then `otc-markets` (NASDAQ-API and OTC-Markets can disagree on cross-listed names). The source string grows unbounded with duplicates.
- **Suggested fix:** Use a Set or check `existing.source.split(',').includes(newSource)` before appending.

### F-217a-05 — MEDIUM — Cross-source mcap hint is lost on collisions
- **File:** `refresh-universe.js:307-333`
- **Description:** `Promise.allSettled([fetchNasdaqAll, fetchSecTickers, fetchFinnhubUniverse, fetchWikipediaIndices, fetchOTCMarkets, fetchNasdaqApiList])` runs in array order. `nasdaq-all` populates a ticker first (no marketCap). When `nasdaq-api` reaches the same ticker (carrying a parsed marketCap), the `else` branch only updates `source` — `existing.marketCap` is never overwritten.
- **Mechanism:** The Tag 147 universe-cap (F-DP-016) preferentially keeps mcap-populated rows; tickers stripped of their mcap hint by this collision drop into the null-mcap bucket (capped to 20% of slots = 2,600 rows). When the universe is >13k, this silently discards mcap-known mid-caps that happened to be NASDAQ-listed.
- **Suggested fix:** In the `else` branch, also `if (existing.marketCap == null && info.marketCap != null) existing.marketCap = info.marketCap;` (analogously for name/sector if missing on existing). Coordinate priority: NASDAQ-API mcap > NASDAQ-Trader (no mcap).

### F-217a-06 — MEDIUM — `refresh-fx.js` exit-1 threshold is too lax for selective EM blackout
- **File:** `scripts/refresh-fx.js:119`
- **Description:** `if (failed.length > CURRENCIES.length / 2) process.exit(1);` — with 32 currencies, 16 silent failures (50%) keep the run "successful". If every EM currency (TRY/IDR/MYR/PHP/VND/CZK/HUF/RON/AED/SAR/QAR/ILS/BRL/MXN/ZAR/INR = 16 currencies) fails simultaneously due to Yahoo geo-blocking or Cloudflare on EM ticker symbols, this exits 0 and the F-CI-004 staleness gate (workflow line 117) sees a fresh `fetchedAt` because at least one major succeeded.
- **Mechanism:** Per-currency lastSuccessAt fix (F-DP-051) already mitigates this downstream in `pull-yahoo.js` — but only for currencies that exist in `FX_FALLBACK`. The exit code from `refresh-fx.js` is also surfaced via `continue-on-error: true` on the workflow side, so it's mostly a logging concern. Severity bounded.
- **Suggested fix:** Track a `criticalFailed = failed.filter(c => ['BRL','MXN','INR','TWD','KRW','HKD'].includes(c))` and exit 1 when `criticalFailed.length >= 3` — captures the geo-blocking pattern. Plus print `console.warn('FX FAILED:', failed.join(','))` so the CI log has a grep-target.

### F-217a-07 — MEDIUM — OTC-Markets pagination caps at MAX_PAGES=10 (5,000 tickers) with no warning if hit
- **File:** `discovery/otc-markets.js:20, 128-184`
- **Description:** OTCQX+OTCQB+Expert together exceed 5,000 tickers in many months. The loop terminates silently at MAX_PAGES=10 without logging a warning when `page === MAX_PAGES && totalRecords > 5000`. The F-DP-017 fix correctly removed the short-page early-exit but kept the absolute MAX_PAGES limit untouched.
- **Mechanism:** When OTC's `totalRecords` (parsed on page 1) is > 5,000, pages 11+ are silently skipped. The Run #107 log shows OTC returning ~3k tickers, so it doesn't currently hit the limit — but Expert Market alone is growing and the limit is fragile.
- **Suggested fix:** Inside the loop, when `page === MAX_PAGES && totalRecords && totalRecords > MAX_PAGES * PAGE_SIZE`, emit `console.warn('[OTC-Markets] HIT MAX_PAGES — ' + (totalRecords - MAX_PAGES * PAGE_SIZE) + ' tickers not fetched')` so silent truncation becomes visible.

### F-217a-08 — MEDIUM — `sortByStaleness` does O(N log N) sync file-opens (~170k opens for 13k stocks)
- **File:** `pull-yahoo.js:965-982`
- **Description:** `getAge(ticker)` is called inside the comparator → for 13,000 stocks the comparator fires ~13,000 × log₂(13,000) ≈ 170,000 times. Each call does `fs.existsSync` + `fs.openSync` + `fs.readSync` + `fs.closeSync` — at least 4 syscalls × 170k = ~680k syscalls before the pull even starts.
- **Mechanism:** Slows the first ~30-60s of every run on the CI runner (NVMe SSD). On a slower disk this becomes minutes. The fix is trivially efficient via Schwartzian transform.
- **Suggested fix:**
  ```js
  const decorated = stocks.map(s => ({ s, age: getAge(s.ticker) }));
  decorated.sort((a, b) => a.age - b.age);
  return decorated.map(d => d.s);
  ```
  — N file-opens instead of N log N.

### F-217a-09 — LOW — Redirect handler ignores relative `Location` headers
- **Files:** all six discovery sources (`sec-tickers.js:27`, `nasdaq-api.js:53`, `otc-markets.js:41`, `nasdaq-all.js:36`, `finnhub.js:38`, `wikipedia-indices.js:28`)
- **Description:** `return get(res.headers.location).then(...)` passes the raw header through to `https.get`. If the redirect target is a relative URL (`/foo/bar`), `https.get('/foo/bar')` throws `ERR_INVALID_URL` and the entire discovery source aborts. SEC/NASDAQ currently always send absolute URLs but RFC 7231 §7.1.2 allows relative.
- **Suggested fix:** `const target = new URL(res.headers.location, url).href; return get(target).then(...);` — one-line per source.

### F-217a-10 — LOW — Wikipedia ticker extraction admits single-letter symbols
- **File:** `discovery/wikipedia-indices.js:78-89`
- **Description:** Comment at line 85 says `if (clean.length < 2) continue;` — but the regex `/^[A-Z][A-Z0-9]{0,5}$/` admits the single-letter `A` (Agilent ticker), then the explicit guard correctly rejects length-1. Net: `A` (Agilent), `V` (Visa), `T` (AT&T), `F` (Ford), `C` (Citigroup), `M` (Macy's), `O` (Realty Income), `R` (Ryder), `X` (US Steel) are all rejected by Wikipedia discovery — these are real S&P 500 constituents. Comment intent contradicts the actual data.
- **Suggested fix:** Drop the `clean.length < 2` guard, OR keep it but explicitly document that single-letter NYSE tickers are deliberately excluded. The NOT_TICKERS set already filters common false-positives that are length-2 like `NO`, `OR`, `BY`.

### F-217a-11 — LOW — `nasdaq-all.js` lacks retry-with-backoff
- **File:** `discovery/nasdaq-all.js:27-49, 107-134`
- **Description:** Tag 215i added retries to `nasdaq-api.js` and `otc-markets.js` after Run #107 timeouts, but `nasdaq-all.js` (NASDAQ Trader text files) is still single-attempt. The Trader files are 300-500 KB downloads — slow connections or transient CDN hiccups will silently lose the 7-8k US common stock universe.
- **Suggested fix:** Copy the retry pattern from `nasdaq-api.js` (DELAYS=[15000, 45000], isTimeout regex, attempt loop). Same 30s timeout.

### F-217a-12 — LOW — `refresh-fx.js` 200ms inter-call delay is below Yahoo's safe rate
- **File:** `scripts/refresh-fx.js:103`
- **Description:** 32 currencies × 200ms = 6.4s total — fast, but Yahoo currency endpoint shares the same crumb/cookie pool as the screener calls in `refresh-universe.js`. If `refresh-fx.js` runs immediately after a `refresh-universe.js` rate-limited Yahoo, the 200ms gap is insufficient. Daily-pull workflow does run `refresh-fx.js` after `refresh-universe.js` (workflow lines 75-110).
- **Suggested fix:** Match the `_sleep(300)` pattern from `refresh-universe.js` between screener calls, or add a single `await _sleep(5000)` at the top of `refresh-fx.js` so it doesn't pile onto a hot Yahoo connection.

---

## Clean Files

The following files in scope had **zero findings**:
- `lib/atomic-write.js` — tmp+rename + cleanup-on-failure is correct. (Caveat: no `fsyncSync(fd)` before rename — on a hard power-loss the kernel could ack the write before flushing pages. Acceptable trade-off for this workload since the consumer always re-reads and would catch JSON parse errors.)
- `scripts/prune-watchlist.js` — sound dead-snapshot reasoning, atomic write, dry-run support, snapshot-loading defensive against parse errors.
- `discovery/nasdaq-all.js` — correct apart from F-217a-11 (no retry).
- `discovery/wikipedia-indices.js` — correct apart from F-217a-10 (single-letter exclusion).

---

## Cross-Source Consistency

**Source-priority order:** Yahoo screeners (`SCREENER_IDS` × `REGIONS`) populate `allTickers` first → Yahoo always wins for `marketCap/name/sector/exchange`. Then `EXCHANGE_CODES` paginated screener — also Yahoo, only adds if not seen. Then `Promise.allSettled([nasdaqAll, sec, finnhub, wikipedia, otc, nasdaqApi])` — first-write-wins per ticker, ONLY `source` field is updated on collision.

**Implication of first-write-wins:** When the same ticker comes from `nasdaq-all` (no mcap) and later `nasdaq-api` (parsed mcap from "$3.4B" string), the mcap hint is silently lost (F-217a-05). This biases the Tag 147 universe-cap toward Yahoo-discovered mcap rows and away from NASDAQ-API-discovered mcap rows.

**Class-share blind spot:** All three "official" discovery sources (SEC EDGAR, NASDAQ Screener API, OTC Markets) reject dot/hyphen tickers (F-217a-01). The ONLY paths that admit `BRK.B` / `BF.B` are (a) `nasdaq-all.js` (pipe file) and (b) Yahoo's own screeners. SEC's authoritative `company_tickers.json` is being filtered away — wasting Tag 215g's recovery of 9,826 SEC tickers when ~50-100 of them are class shares.

**Atomic-write coverage gap:** Tag 189 migrated the discovery/refresh writers to `writeFileAtomic`, but `pull-historical-prices.js` (the sister script that runs in the same workflow with the same SIGTERM exposure) was missed (F-217a-02). The corruption-detection branch in that file is a smoking gun — proof the bug occurs in production.

**Workflow-level safety nets that catch some of these:**
- `Verify Watchlist Sanity` (>200 stocks) catches a fully-corrupted watchlist.
- `Verify FX-Rates Freshness` (>30 days = fail) catches sustained FX outages.
- Both are downstream of `continue-on-error: true` on the source steps — meaning silent partial failures (e.g., F-217a-06 with 16/32 currencies dead) still pass.

---

## Anchors checked

- `Grep writeFileSync` across `scripts/` → 20 hits in non-watchlist files (pickdiff, walk-forward, methodology-report, etc.) — none in scope but flag for a follow-up Tag if SIGTERM corrupts those reports too.
- `Grep setTimeout|destroy` across `discovery/` → all six sources have request timeouts; only NASDAQ-API + OTC have retries.
- `Grep redirect|location` across `discovery/` → all six sources have a redirect-follow path; all six pass raw `res.headers.location` (F-217a-09).
- Node REPL: regex `/^[A-Z][A-Z0-9]{0,4}[A-Z]?$/` tested against `BRK.B`, `BF.B`, `BRK-B`, `A` → confirmed F-217a-01 and F-217a-10.
- Node REPL: source-concat behaviour against `'nasdaq-trader,sec-edgar' !== 'sec-edgar'` → confirmed F-217a-04.
