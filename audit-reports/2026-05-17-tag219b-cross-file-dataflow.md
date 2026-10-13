# Tag 219b — Cross-File Data-Flow Audit

**Scope.** Invariants BETWEEN producer scripts and downstream consumers in the
daily-pull pipeline. Prior audits (Tag 215/216/217/218) covered intra-file
bugs; this round walks each producer-consumer pair declared by
`.github/workflows/daily-pull.yml` and flags schema or contract divergences.

**Method.** Traced every step of `daily-pull.yml`, identified the produced
artifact (file path + key fields), then opened the consuming script and
verified the read assumptions. Cross-checked actual on-disk files in the
repo to compare written schema to documented schema. Where producers and
consumers were updated at different tags, looked for backwards-compat
fallbacks.

**Files traced.** `pull-yahoo.js`, `refresh-fx.js`, `refresh-universe.js`,
`scripts/prune-watchlist.js`, `detect-changes.js`, `methods/sector-medians-compute.js`,
`methods/sector-median-lookup.js`, `methods/_helpers.js`,
`generate-modes-report.js`, `generate-screener.js`, `snapshot-picks.js`,
`snapshot-methods-history.js`, `scripts/snapshot-score-history.js`,
`scripts/walk-forward-perf.js`, `scripts/method-effectiveness.js`,
`scripts/compute-method-drift.js`, `scripts/picks-regression-check.js`,
`scripts/check-pull-stats.js`, `scripts/pipeline-health-check.js`,
`scripts/macro-regime.js`, `scripts/archive-old-snapshots.js`,
`scripts/pick-diff.js`, `scripts/elliott-export.js`,
`scripts/methodology-report.js`, `pull-historical-prices.js`.

## Executive summary

**4 findings** (1 HIGH, 1 MEDIUM, 2 LOW).

Top-3 actionable items:

1. **F-219b-01 HIGH** — Snapshot date-rollover race between `snapshot-picks`
   and `snapshot-methods-history`. The two snapshots share a date stamp by
   convention, but each derives `today` from its own `new Date()` call at
   step start. The pull/picks/methods steps span hours when Yahoo is slow;
   a pull that finishes at 23:55 UTC writes `picks-history/2026-05-17.json`,
   the methods step starts at 00:05 UTC and writes
   `methods-history/2026-05-18.json`. Downstream pick-diff & method-effectiveness
   match these files BY DATE so the row that should be "today's evidence for
   today's picks" falls through to yesterday's methods file or skips.
2. **F-219b-02 MEDIUM** — `pull-yahoo.js:1085` writes `partial: true` on
   incremental flushes and `partial: false` on the clean final
   `_manifest.json`. NO consumer reads `partial`. A SIGTERM after the last
   incremental flush but before the final write leaves `partial: true` on
   disk with whatever `n_ok` count happened to be there — and the workflow's
   "Verify Pull Coverage" step passes if `n_ok >= max(2500, 18%)` even
   though the run was killed mid-flight.
3. **F-219b-03 LOW** — `scripts/check-pull-stats.js:74` still reads
   `watchlist.json` with `Array.isArray(wl.stocks) ? wl.stocks.length : null`
   only (the wrapped shape). The `prune-watchlist.js` fix (Tag 219a) added
   three-way schema-aware loading; this consumer was not updated. Today the
   watchlist is wrapped so `universeSize` is correct, but if Karl ever
   rolls back to a bare-array shape (legacy), the pull-stats drift gate
   silently shows `universeSize: null` and skips the drift comparison
   forever after.

## Findings

### F-219b-01 — HIGH — Date-rollover race between picks-history and methods-history

**Severity:** HIGH (silent, intermittent; only triggers when pull crosses
UTC midnight; the failure mode is "today's drop-reason is unknowable").

**Producer A — `snapshot-picks.js:198`:**

```js
const today = new Date().toISOString().slice(0, 10);
// ...
const outFile = path.join(args.out, dateStr + '.json');   // dateStr from result.asOf
```

**Producer B — `snapshot-methods-history.js:50`:**

```js
const today = new Date().toISOString().slice(0, 10);
const outFile = path.join(args.out, `${today}.json`);
```

**Workflow ordering** (`.github/workflows/daily-pull.yml:319 → 343`): picks-history
step finishes, then methods-history step starts. Each step's `new Date()`
is independent. The intervening Picks-Regression check + Earnings/Prices
pulls + macro-regime take 5–15 minutes typically — but on the days when
Yahoo throttles and the entire pull pushes past 23:50 UTC, these two
files end up on different dates.

**Consumer A — `scripts/pick-diff.js:86`:**

```js
function findMethodFile(date) {
  if (mhVintages.includes(date + '.json')) return loadJson(...);
  // Fallback: closest mh file on/before date
  const cands = mhVintages.filter(f => f.replace('.json', '') <= date);
  if (!cands.length) return null;
  return loadJson(...cands[cands.length - 1]);
}
```

Pick-diff asks "why was this ticker dropped?" by comparing
`todayMethodsFile.stocks[ticker].results` vs `priorMethodsFile.stocks[ticker].results`.
When `picks-history/2026-05-17.json` exists but the matching methods file
was actually written as `2026-05-18.json`, the `mhVintages.includes()`
check misses and the fallback picks `2026-05-16.json` (yesterday's
methods) for "today's" diff — silently producing wrong "why dropped"
reasons.

**Consumer B — `scripts/method-effectiveness.js:141`:**

Cache key is `asOf + '|' + key` where `asOf = fname.replace('.json', '')`.
A misaligned methods-history date means today's evidence is cached under
2026-05-18 while the matching picks vintage is under 2026-05-17 — the two
never meet in any joint analysis.

**Fix.** Inject a shared `RUN_DATE_UTC` env-var at the start of the
workflow (before `Snapshot Score-History`) and have all three snapshot
scripts (`snapshot-picks`, `snapshot-methods-history`, `snapshot-score-history`)
respect it instead of calling `new Date()` independently. Locks the date
to wall-clock at pipeline entry. Cheaper alternative: have
`snapshot-methods-history` read `picks-history/latest.json` to learn the
shared date.

### F-219b-02 — MEDIUM — `partial` flag in _manifest.json is written but unread

**Severity:** MEDIUM (real risk of stale-pass; benign in normal runs).

**Producer — `pull-yahoo.js:1085`:**

```js
// Incremental flush during pullAll loop
const slim = { ..., partial: true };
writeFileAtomic(slimPath, JSON.stringify(slim));
```

**Producer — `pull-yahoo.js:1579`:**

```js
// Final write after loop completes cleanly
const slim = { ..., partial: false };
writeFileAtomic(slimPath, JSON.stringify(slim));
```

**Consumer — `.github/workflows/daily-pull.yml:206-252` ("Verify Pull Coverage")**:
reads `n_ok` and `n_total` only. Never inspects `partial`.

**Consumer — `scripts/check-pull-stats.js:53-56`:** reads `n_ok`,
`n_failed`, `n_total`. Never inspects `partial`.

A SIGTERM after the last incremental flush but before the final write
leaves `partial: true` on disk with whatever `n_ok` the loop had reached.
If that intermediate `n_ok` happens to exceed `max(2500, 18% × universe)`
the gate passes and the corrupt-state run lands in main.

The Verify Snapshot Freshness step (line 170) is a SECOND gate that
counts fresh `asOf|fetchedAt` timestamps and does catch most partial
runs — so the impact is bounded. But `partial` is a free contract field
that exists exactly to detect this case and is being ignored.

**Fix.** Add to the Verify Pull Coverage step:

```bash
partial=$(node -e "...m.partial===true...")
if [ "$partial" = "true" ]; then
  echo "::error::Manifest reports partial=true — pull was killed mid-flight."
  exit 1
fi
```

### F-219b-03 — LOW — check-pull-stats.js does not handle legacy watchlist shapes

**Severity:** LOW (current watchlist is wrapped; legacy compat only).

**Producer — `refresh-universe.js:403`:** writes `{ _meta, stocks: [...] }`.

**Consumer — `scripts/check-pull-stats.js:74`:**

```js
const wl = loadJson(path.join(ROOT, 'watchlist.json'));
stats.universeSize = wl && Array.isArray(wl.stocks) ? wl.stocks.length : null;
```

The workflow's "Verify Watchlist Sanity" step (line 100, Tag 207a) and
`scripts/prune-watchlist.js:115-120` (Tag 219a) both handle three shapes:
bare Array, `{stocks: [...]}` wrapped, and bare-object. `check-pull-stats`
only supports the middle one. If a future migration or manual edit drops
back to a bare array, `universeSize` becomes `null` indefinitely (the
drift detector silently skips null metrics) and one of the four pull-stats
sentinels stops working without alerting.

**Fix.** Lift the same three-way shape-aware loader into a shared helper
(`lib/watchlist-fs.js`) and have `check-pull-stats`, `prune-watchlist`,
`pull-yahoo`, `pull-historical-prices`, `refresh-universe`, and the
inline node snippets in `daily-pull.yml` all use it. Single source of
truth.

### F-219b-04 — LOW — pipeline-health writers split between CWD-relative and __dirname-relative paths

**Severity:** LOW (works today because workflow always cd's to repo root).

| Script | Health-dir path |
|---|---|
| `snapshot-picks.js:304` | `'./pipeline-health'` (CWD) |
| `snapshot-methods-history.js:138` | `'./pipeline-health'` (CWD) |
| `scripts/snapshot-score-history.js:197` | `'./pipeline-health'` (CWD) |
| `generate-modes-report.js:1274` | `path.join(__dirname, 'pipeline-health')` |
| `scripts/pipeline-health-check.js:11` | `'./pipeline-health'` (CWD) |

Three writers + one reader use CWD; one writer (`generate-modes-report`)
uses `__dirname`. They collapse to the same directory only when CWD ==
repo root, which is true in GitHub Actions but not guaranteed elsewhere
(e.g. running the modes-report from `scripts/` for a quick debug would
write to `scripts/pipeline-health/generate-modes-report.json` while the
checker reads from `./pipeline-health`, missing the file → F-CI-002
synthesises a 100%-failure entry — false positive).

**Fix.** Standardise on `path.join(__dirname, ...)` for both writers and
the checker so the location is anchored to the source-tree, not the
caller's CWD.

## Schema-consistency matrix

| Artifact | Writer(s) | Reader(s) | Verdict |
|---|---|---|---|
| `snapshots/<TICKER>.json` | `pull-yahoo.js:1464` | engine, methods, all snapshot scripts | OK — `meta.asOf`/`meta.fetchedAt` dual key documented (Tag 215j + Tag 218 freshness regex) |
| `snapshots/_manifest.json` | `pull-yahoo.js:1582` | workflow Verify Pull Coverage, `check-pull-stats.js` | Mostly OK — `partial` field unused (F-219b-02) |
| `fx-rates.json` | `scripts/refresh-fx.js:117` | `pull-yahoo.js:124-194` | OK — `rates`, `fetchedAt`, `currencyMeta[c].lastSuccessAt`, `failed` all consumed; per-currency staleness honored |
| `watchlist.json` | `refresh-universe.js:403`, `scripts/prune-watchlist.js:180` | `pull-yahoo.js:1615`, `pull-historical-prices.js:49`, `check-pull-stats.js:74`, workflow sanity gate | Mixed — three loaders are schema-aware (wrapped/Array/bare-object), `pull-historical-prices` and `check-pull-stats` assume wrapped only (F-219b-03) |
| `alert-state.json` | `detect-changes.js:127`, workflow "Strip methodHistory" step | `detect-changes.js:67` (loadState) | OK — `lastRun`, `methodState`, `fieldCoverage` agree; `methodHistory` correctly externalised to `method-history-state.json` sidecar |
| `method-history-state.json` | `detect-changes.js:57-62` | `detect-changes.js:46-52` | OK — schema `{ lastSaved, methodHistory: {ticker → {methodId → {pass,value,history}}} }` agreed |
| `methods/sector-medians-auto.json` | `methods/sector-medians-compute.js:206` | `methods/_helpers.js:116-135`, `methods/sector-median-lookup.js`, `methods/sector-relative-roic.js` | OK — v2 `{ _version:2, byRegion: { US: {...}, _GLOBAL: {...} } }` recognised by all readers; Tag 209b `_p25_/_p50_/_p75_/_p90_/_n_` keys written + consumed via `lookupPercentile` |
| `methods/sector-medians-rolling.json` | `methods/sector-medians-compute.js:288` | `methods/_helpers.js:139-150` | OK — `medians[sp][metric].rolling12mMedian` + `.values` agreed, ROLLING_MIN_WEEKS gate enforced |
| `methods/sector-medians-auto-legacy.json` | `methods/sector-medians-compute.js:215` | (none in current code) | DEAD WRITE — backwards-compat artifact, no consumer left after Tag 167. Harmless but should be removed. |
| `methods-history/YYYY-MM-DD.json` | `snapshot-methods-history.js:128` | `scripts/method-effectiveness.js:174`, `scripts/compute-method-drift.js:36`, `scripts/pick-diff.js:90` | OK — `{date, stocks: {ticker → {results, computable, passing, quality?, nanRatio?, inputs?}}, summary}`; pre-Tag-218 vintages lack `quality/nanRatio/inputs` but consumers handle gracefully (`stockData.quality != null ? ... : null`); date-rollover race documented (F-219b-01) |
| `picks-history/YYYY-MM-DD.json` + `latest.json` | `snapshot-picks.js:278/280` | `scripts/walk-forward-perf.js:406`, `scripts/picks-regression-check.js:105`, `scripts/elliott-export.js:62`, `scripts/pick-diff.js:79` | OK with caveat — `{asOf, universeSize, modes, benchmarks, evaluatedTickers}`; vintages older than 2026-05-14 lack `evaluatedTickers` and walk-forward correctly emits `survivorBiasWarning` per F-BT-003 |
| `score-history/<TICKER>.json` | `scripts/snapshot-score-history.js:178` | `generate-screener.js:84-100` (readScoreHistory) | OK — `{ticker, schemaVersion:1, entries:[{date,hgScore,qcScore,pbScore,hgTier,qcTier,hgClass}]}`; SCHEMA_VERSION mismatch resets entries with warning per design §7 |
| `score-history/_meta.json` | `scripts/snapshot-score-history.js:192` | (none in current code) | DEAD READ candidate — written but no consumer reads it. Harmless audit record. |
| `prices/history.json` | `pull-historical-prices.js` | `walk-forward-perf.js:376`, `method-effectiveness.js:103`, `macro-regime.js:69`, `methods/price-momentum-12-1.js:150`, `backtest-*` | OK — `{ticker: [{date, close}]}` |
| `prices/YYYY-MM-DD.json` | `pull-historical-prices.js` | (none) | DEAD WRITE — per-day snapshot of close prices, archived by `archive-old-snapshots.js`, no consumer reads them after history.json is updated |
| `outputs/macro-regime.json` | `scripts/macro-regime.js:75/100` | `scripts/walk-forward-perf.js:231` | OK — `regimes[D] = {regime, price, sma200, _convention}`; consumer reads `.regime` correctly. Docstring at file top (line 14-15) wrongly claims `regimes[D] = "BULL"` (string) but actual write/read agree on object shape — fix docstring only |
| `outputs/walk-forward.json` | `walk-forward-perf.js:477` | `scripts/methodology-report.js:40` | OK |
| `outputs/method-effectiveness.json` | `method-effectiveness.js:337` | `scripts/methodology-report.js:41` | OK |
| `outputs/method-effectiveness-cache.json` | `method-effectiveness.js:243` | `method-effectiveness.js:114` (same script) | OK — cache key `asOf|horizonKey` |
| `outputs/method-drift.json` | `compute-method-drift.js:68` | dashboard HTML | OK |
| `pipeline-health/<script>.json` | `snapshot-picks.js`, `snapshot-methods-history.js`, `snapshot-score-history.js`, `generate-modes-report.js` | `scripts/pipeline-health-check.js:42` | Mostly OK — schema `{script, date, n_total, n_ok, n_failed, failure_rate, failures}` consistent across all 4 writers and the EXPECTED_SCRIPTS allowlist; path-resolution inconsistency documented (F-219b-04) |

## Clean producer/consumer pairs confirmed correct

- **FX rates**: `refresh-fx.js` writes per-currency `lastSuccessAt`; `pull-yahoo.js`
  honours per-currency staleness (not just top-level `fetchedAt`) and falls
  back to hardcoded rates with `FX_PROVENANCE='fallback-hardcoded'`.
  Currency-list (CURRENCIES vs FX_FALLBACK) agrees post-Tag 188 (F-DQ-007).
- **Manifest n_ok contract**: `pull-yahoo.js` excludes `skipped-mcap` from
  `n_ok`; workflow `Verify Pull Coverage` recomputes the same way via
  file-count fallback. n_ok and on-disk file count agree.
- **walk-forward + evaluatedTickers**: producer writes
  `result.evaluatedTickers = stocks.map(s => s.meta.ticker)`; consumer
  reads `picksFile.evaluatedTickers` and correctly emits
  `survivorBiasWarning` when absent (legacy vintages). Survivor-bias
  correction is wire-correct.
- **alert-state sidecar split**: `method-history-state.json` (sidecar) is
  loaded into `state.methodHistory` then explicitly excluded from the
  committed `alert-state.json` by `saveState`. Roundtrip is consistent;
  the workflow's "Strip methodHistory" step is a belt-and-suspenders
  cleanup, not load-bearing.
- **Score-history pbScore formula**: `snapshot-score-history.js:41-65`
  mirrors `generate-screener.js:217-228` line-for-line (growth/100×25 +
  gm/100×20 + r40/100×15 + gma_bonus + oma_bonus + revAccel_bonus).
  Stored history matches dashboard render.
- **AUDIT_SCORE_MULTIPLIERS env split**: workflow sets it for
  `Generate Screener Dashboard` and `Snapshot Score-History`, intentionally
  withholds it from `Snapshot Picks-History` / `Snapshot Methods-History`
  (documented at workflow lines 313 and 339). Backtest stays
  un-multiplied; user-visible scores stay multiplied. No drift.
- **Macro-regime asOf convention**: producer writes `regimes[D]` using
  SMA from `[D-200..D-1]` + `price = D-1 close` (no look-ahead);
  walk-forward's `getRegimeAt(asOf)` reads exactly this shape.
- **archive-old-snapshots**: dated `prices/YYYY-MM-DD.json` files are
  archived and deleted — confirmed no consumer reads them
  (only `prices/history.json` is consumed). methods-history kept 7d,
  picks-history kept 90d — both exceed downstream MIN_VINTAGES (4) and
  MAX horizon (84d) requirements.
- **picks-regression-check**: filters `priors` by `f < todayDate` so
  today's just-written vintage is excluded from its own baseline.

## Caveats / non-findings considered

- **Cross-script `today` derivation**: each snapshot script independently
  calls `new Date()`. Within a single sub-second this is fine; over a
  multi-hour pull it produces F-219b-01. Did not flag the within-script
  `today` use (`snapshot-picks.js` derives `today` twice — once for
  `_buildFirstSeenMap`/cache logic, once via `result.asOf.slice(0,10)` for
  the filename — both inside the same `main()` call, sub-second apart;
  no realistic skew.
- **Stale on-disk `meta.asOf` absence**: a sample inspection of
  `snapshots/COST.json` (mtime 2026-05-17) showed no `meta.asOf`, only
  `meta.fetchedAt`. The Tag 215j fix at `pull-yahoo.js:681/690` does write
  both; the on-disk file's mtime appears to be from a local pull executed
  before the Tag 215j commit landed locally, NOT a CI run. Verified that
  the freshness gate's dual `asOf|fetchedAt` regex (workflow line 186)
  remains correct for both old and new snapshots. Not a finding.
- **`partial` race window**: addressed in F-219b-02. Could potentially be
  closed by writing the final `_manifest.json` to a tmp + rename with the
  `partial: false` payload baked in BEFORE the incremental flush ever
  writes `partial: true` — but that's a producer redesign, not a
  consumer contract bug.
