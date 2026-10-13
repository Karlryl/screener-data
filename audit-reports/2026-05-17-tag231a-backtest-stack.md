# Tag 231a — Backtest-Stack Audit

**Date:** 2026-05-17
**Scope:** `pull-historical-prices.js`, `scripts/walk-forward-perf.js`, `scripts/method-effectiveness.js`
**Lens:** look-ahead bias, survivor bias, sample-size validation, NaN propagation, silent fallbacks, date arithmetic, envelope unwrap, operator precedence.

---

## Summary

| Severity | Found | Fixed in this pass | Documented |
|----------|------:|------------------:|-----------:|
| CRITICAL | 0 | 0 | 0 |
| HIGH     | 4 | 4 | — |
| MEDIUM   | 4 | 0 | 4 |
| LOW      | 4 | 0 | 4 |
| **Total**| **12** | **4** | **8** |

Tests after fixes: `tag28-tests.js 155/155`, `engine-cli-tests.js 10/10`, `tests/integration-anchor-test.js 10/10`. Fixture hash stable.

---

## HIGH (fixed — see commits)

### H1 — `nearestTradingDay` forward-snap introduced look-ahead bias on ENTRY dates
**File:** `scripts/walk-forward-perf.js:129-144` (pre-fix)
**Fix:** `Tag 231a-1` — scan BACKWARD first at each offset.
**Failure mode:** `getEntryDate` already shifts pre-market snapshots to T+1. The alternating forward-first scan then snapped forward AGAIN when T+1 was a non-trading day, leaking T+2 price information into the entry price of the hypothetical trade.

### H2 — Pick vs benchmark date-window drift in alpha
**File:** `scripts/walk-forward-perf.js:170,197,221,309-310` (pre-fix)
**Fix:** `Tag 231a-2` — benchmark-canonical date anchoring for all per-vintage lookups.
**Failure mode:** Each ticker snapped to its own `nearestTradingDay` using its own sparse map. SPY trades every business day; thinly-traded picks may not. Pick return window and benchmark return window drifted by up to ±2 days for vintages whose `asOf` landed on a weekend/holiday — silently biasing alpha sign and magnitude.

### H3 — Phantom `today` row in price history on non-trading days
**File:** `pull-historical-prices.js:113-114, 152-155` (pre-fix)
**Fix:** `Tag 231a-3` — derive stored date from the latest quote's `q.date` field.
**Failure mode:** Workflow runs in a UTC window where `today_UTC` was a Saturday/Sunday/holiday pushed `{date: today_UTC, close: previous-day-close}` into history. Walk-forward then resolved e.g. `priceIndex['SPY'].get('Saturday')` to a real number that wasn't actually Saturday's close. Combined with H2's canonical-date anchoring, this would corrupt every alpha for vintages on adjacent dates.

### H4 — Asymmetric-attrition counter wrong
**File:** `scripts/method-effectiveness.js:218-262` (pre-fix)
**Fix:** `Tag 231a-4` — count per-method pass/fail CONTRIBUTIONS, not per-ticker headcount with early-break.
**Failure mode:** (a) early-`break` after first computable method attributed each dropped ticker non-deterministically; (b) the "no valid return at snapped date" attrition path (delisted mid-history) was silently dropped with no accounting. IMBALANCE warning was effectively noise.

---

## MEDIUM (documented, not fixed in this pass)

### M1 — `loadJson` silent failure across all three files
**File:** `scripts/walk-forward-perf.js:30-32`, `scripts/method-effectiveness.js:45`
```js
function loadJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }
```
Corrupt picks-history files are silently skipped (`if (!picks) continue;` on walk-forward-perf.js:430). The current `pull-historical-prices.js` has a strong recovery branch (line 60-75 with RESET_HISTORY guard) — but the consumers do not. A single corrupt vintage drops out of the report without any log line.

**Fix sketch:** log a WARNING when `loadJson` returns null on a file that `fs.existsSync` confirmed exists. Counter the number of skipped files at end of run.

### M2 — Empty-array cache entries permanently mask vintage re-processing
**File:** `scripts/method-effectiveness.js:174`
```js
if (cachedDates.has(cacheKey) && cache.vintageReturns[cacheKey]) { ... continue; }
```
`cache.vintageReturns[cacheKey]` can be `[]` (truthy in JS) if the original vintage parse yielded no qualifying entries. Subsequent runs continue to skip even after the underlying vintage file is fixed. Less critical now that Tag 228a cleaned the `_manifest-full` phantom row and Tag 223c added 90-day cache pruning — but the pattern remains.

**Fix sketch:** treat `[]` cached entries as a cache miss: `if (Array.isArray(cache.vintageReturns[cacheKey]) && cache.vintageReturns[cacheKey].length > 0)`.

### M3 — `today_UTC` mismatch with US market calendar
**File:** `pull-historical-prices.js:60`, `scripts/walk-forward-perf.js:264,477`
`new Date().toISOString().slice(0,10)` is UTC midnight; US market close is 21:00 UTC. A 22:00-UTC scheduled run on what's still "Thursday afternoon" in America records the snapshot as Friday UTC. CI cron timing currently masks this — depends entirely on the schedule line in the GitHub Actions workflow.

**Fix sketch:** define a project-wide "as-of date" helper that takes a market-close anchor (`US_MARKET_CLOSE_UTC=21`) and returns the correct trading date for any wall-clock time. Use it everywhere `today` is set.

### M4 — `getEntryDate` is US-market-specific but applied to global picks
**File:** `scripts/walk-forward-perf.js:114-124`
```js
if (d.getUTCHours() < 21) { ... next day }
```
Hard-coded 21:00 UTC = US close. For a picks file generated 22:00 UTC (post-US-close but pre-Asia open), the entry date stays today — correct for US picks, but European picks (e.g. RHM.DE) actually closed at 16:30 UTC, so 22:00 UTC IS post-close for them and same-day entry is reasonable. Conversely, an Asia-Pacific stock whose snapshot is taken 12:00 UTC (post-Asia-close but pre-US-open) gets shifted to T+1, when same-day entry was actually realistic.

**Fix sketch:** look up the ticker's exchange (already in `wl.stocks[i].exchange` via Yahoo metadata) and apply per-exchange close times. Defer until exchange field is reliably populated.

---

## LOW (documented, not fixed in this pass)

### L1 — `||` masks zero-valued price entries
**File:** `scripts/walk-forward-perf.js:172-173, 199-200, 224-225` (and similar in method-effectiveness:234-235)
```js
const p0 = map.get(entryDate) || null;
```
If a price entry of 0 ever appeared (data-corruption, currency-conversion bug), `||` would coerce it to null. `returnPct` already guards `p0 > 0` so the wrong-result risk is bounded, but the failure mode is silent. Prefer `??` (nullish coalescing).

### L2 — `(b.h.alpha || -Infinity)` sort tie-breaker
**File:** `scripts/method-effectiveness.js:372`
```js
return (b.h.alpha || -Infinity) - (a.h.alpha || -Infinity);
```
A method with exact alpha=0 sorts as -Infinity, ranking BELOW methods with -5pp alpha. Cosmetic only (the rendered table label is correct). Use `b.h.alpha ?? -Infinity`.

### L3 — Yahoo quote date normalization assumes UTC midnight
**File:** `pull-historical-prices.js:158`
```js
(q.date instanceof Date ? q.date : new Date(q.date)).toISOString().slice(0,10)
```
If Yahoo ever returns a Date with non-zero UTC hours (e.g. 22:00 UTC for some exchange's local close), `.slice(0,10)` would yield the wrong calendar day in some timezones. Currently safe — Yahoo's daily-bar dates are UTC-midnight aligned — but is a latent dependency on Yahoo's normalization.

### L4 — Markdown report's "entry date" cell is always the literal string `next-day`
**File:** `scripts/walk-forward-perf.js:514-515`
```js
const entryNote = firstH && firstH.backtest_runner_version === 'stored_pass' ? '' : '';
md += `| ${v.asOf} | ${entryNote}next-day | ...
```
Both branches of the ternary produce `''`, so the column always prints `next-day` regardless of whether `getEntryDate` actually shifted. Cosmetic / docs concern.

---

## Verified clean (no finding)

- `walk-forward-perf.js:319-320` Tag 216b staleness gate — correct enforcement.
- `method-effectiveness.js:75-99` bootstrap CI — seed includes method-name hash; reproducible per audit goal.
- `walk-forward-perf.js:165` `history['SPY'].slice(-400)` after ascending sort — keeps the most-recent 400 entries, not the oldest. Correct.
- `walk-forward-perf.js:282` `vintageCount: data.vintages.filter(v => v.horizons[key] && v.horizons[key].status === 'ok').length` — Bug #32 fix verified correct.
- `walk-forward-perf.js:265` macro-regime lookup with 30-day backward window — sufficient for weekly regime data.
- Survivor-bias guard via `evaluatedTickers` in `computeUniverseMedianReturn` (line 173) — returns `missingEvaluatedTickers: true` rather than silently substituting today's universe.
- Sample-size gates: `MIN_SAMPLES=10` (walk-forward) and `MIN_SAMPLES_PER_GROUP=10` + `MIN_VINTAGES=4` (method-effectiveness) enforced correctly.

---

## Commits in this pass

- `Tag 231a-1` — backward-first `nearestTradingDay` (look-ahead bias fix)
- `Tag 231a-2` — benchmark-canonical date anchoring for alpha
- `Tag 231a-3` — derive history date from latest quote, not UTC today
- `Tag 231a-4` — accurate per-method-contribution attrition counter
- `Tag 231a-final` — this audit report
