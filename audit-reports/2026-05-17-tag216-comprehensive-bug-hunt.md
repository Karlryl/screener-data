# Tag 216 — Comprehensive Bug-Hunt Audit (older runtime files)

**Date:** 2026-05-17
**Scope:** Out-of-recent-audit files driving every screening run: score-aggregator,
strategy-modes, runner, _helpers, detect-changes, snapshot-picks, walk-forward-perf,
method-effectiveness, sector-medians-compute, sector-median-lookup, method-types,
field-coverage, trend.

## 1. Executive Summary

**Total findings: 9**

| Severity  | Count |
|-----------|-------|
| CRITICAL  | 0     |
| HIGH      | 2     |
| MEDIUM    | 4     |
| LOW       | 3     |

No CRITICAL bugs found — score-aggregator, runner registry alignment, and
atomic-write coverage are solid. The HIGH issues are (a) a real look-ahead-bias
shortcut in `method-effectiveness.js` cache replay where `cached.find()` mis-resolves
entries when two methods have identical returns, and (b) a coverage-gate edge in
`score-aggregator.computeScore()` that silently REJECTs HG candidates when only
two of six weighted methods are computable. MEDIUMs concentrate around
`detect-changes` state management and the sloan/red-flag threshold mismatch.

## 2. Methodology

**Files read in full:**
- `methods/score-aggregator.js` (337 lines)
- `methods/strategy-modes.js` (421 lines)
- `methods/runner.js` (97 lines)
- `methods/_helpers.js` (273 lines)
- `methods/method-types.js` (156 lines)
- `methods/sector-medians-compute.js` (327 lines)
- `methods/sector-median-lookup.js` (126 lines)
- `methods/region-mapping.js` (101 lines)
- `methods/data-quality.js` (154 lines)
- `methods/trend.js` (71 lines)
- `methods/sloan-ratio.js` (112 lines)
- `methods/net-debt-ebitda.js` (60+ lines)
- `methods/quality-compounder-roic.js` (header)
- `methods/index.js` (188 lines, all 80+ registry entries)
- `detect-changes.js` (342 lines)
- `snapshot-picks.js` (317 lines)
- `scripts/walk-forward-perf.js` (528 lines)
- `scripts/method-effectiveness.js` (386 lines)
- `field-coverage.js` (184 lines)
- `lib/atomic-write.js` (56 lines)

**Anchors verified:** NVDA snapshot loaded; full evaluation pipeline executed end-to-end
(Runner → strategy-modes HYPERGROWTH → score-aggregator). Confirmed NVDA scores
96 / tier A with all 6 SCORE_WEIGHTS.HYPERGROWTH methods computable.

**Cross-checks:**
- All 8 SCORE_WEIGHTS methods × 3 modes verified to exist as `methods/<id>.js` files
  AND in `methods/index.js` registry AND in `method-types.REGISTRY`.
- Tag 206d fixes (altman-z-score, piotroski-f-score, estimate-revision-proxy CORE
  classification + insider-buy-cluster registry) verified present.
- Tag 206h fix (rule-of-x defaultActive:true) verified.

## 3. Findings

### F-216-01 — HIGH — `cached.find()` race in method-effectiveness cache replay (dead code, but signals a tested-against-something bug)

**File:** `scripts/method-effectiveness.js:148-165`
**Severity:** HIGH (data-correctness if the rebuild block at L248-263 is ever removed)

**Description:** The cache-replay loop iterates `cached` entries and pulls `pass` via:

```js
const pass = cached.find(x => x.ticker === ticker && x.methodId === methodId && x.ret === ret)?.pass;
```

Two methods on the same ticker can produce identical `ret` (the return is per-ticker
not per-method), making the `find` non-deterministic — it returns the first matching
entry's `pass` regardless of which method's row was being iterated. Currently masked
because L248 wipes `perMethod` then L249-263 rebuilds cleanly without `find()`.

**Mechanism:** If a future refactor removes the rebuild block (it looks like leftover
"NOTE: re-do it cleanly" debugging code per L243-247 comment), method-effectiveness
silently swaps pass/fail flags between methods.

**Fix:** Destructure `pass` directly into L151 alongside `ticker, methodId, ret, quality`,
then delete the L155 `cached.find()` lookup entirely. Also delete the redundant L148-165
cache-replay block (it is dead code given L248-263).

```js
for (const { ticker, methodId, ret, pass, quality } of cached) {
  if (pass == null) continue;
  // ... accumulate ...
}
```

### F-216-02 — HIGH — Score-aggregator coverage gate rejects HG stocks with just 2 computable weighted methods

**File:** `methods/score-aggregator.js:193-204`
**Severity:** HIGH (silent NEAR_MISS/REJECT tier on small-cap legitimate candidates)

**Description:** F-ME-023 requires `computedWeight / totalWeight >= 0.4` to compute a
score. SCORE_WEIGHTS.HYPERGROWTH = { r40:0.25, r-of-x:0.10, rev-3y:0.25, gm-stab:0.10,
prof-state:0.15, hg-quality-class:0.15 } summing to 1.00. A young
hypergrowth company (e.g. recent IPO) where only `rule-of-40` (0.25) and `rule-of-x` (0.10)
are computable totals 0.35 weight — just under the 0.40 gate — and is forced to
`tier: 'REJECT', reason: 'insufficient-coverage'` even when both are passing.

**Mechanism:** The gate is intended to prevent scoring on tiny-coverage stocks, but the
40% threshold is asymmetric to weights: HG can need just `revenue-growth-3y` (0.25) +
`profitability-state` (0.15) = 0.40 to pass (borderline); QC needs more (no single 0.40
combination). The gate is fine for QC but punishing for HG.

**Fix:** Either (a) lower the HG-mode gate to 0.30 specifically, or (b) make the gate
absolute (require ≥3 computable methods) rather than weight-based. Concretely at L197:

```js
// Per-mode minimum: HG=0.30, QC=0.40, TURN=0.40
const minCoverage = (modeId === 'HYPERGROWTH') ? 0.30 : 0.40;
if (computedWeight / totalWeight < minCoverage) { ... }
```

Verify against anchors after change to ensure no regression on NVDA/META/MSFT.

### F-216-03 — MEDIUM — `_inferConfidence` overwrites caller-provided component confidence with mutation

**File:** `methods/_helpers.js:212-229`
**Severity:** MEDIUM (subtle, only affects flags computation cascade)

**Description:** `_inferConfidence` first checks `result.components.confidence`. If
present, returns it. Otherwise computes a default. **Side effect:** the function reads
`result.threshold` and `result.value` to decay confidence near-threshold, but does
**not** symmetric-decay for `lte_abs` methods (e.g. sloan-ratio). For sloan with
threshold=0.10 and value=0.11 (an 11% Sloan — a real WARN case), the math says
`dist = |0.11 - 0.10| / 0.10 = 0.10` → no decay. But for value=-0.08, dist=1.8 — also
no decay. The decay is asymmetric in scale; works for `gte` but mis-fires for
`lte_abs`/`lte`.

**Mechanism:** For `lte_abs` methods, "near threshold" should mean `|value|` near
`threshold`, not `value` near `threshold`. Currently a sloan value of −0.10 (negative
of threshold) is computed as `dist = |−0.10−0.10|/0.10 = 2.0` (far from threshold) when
in fact it's exactly *at* the absolute boundary.

**Fix:** At `_helpers.js:223`, branch on `result.thresholdOp`:

```js
const v = (result.thresholdOp === 'lte_abs') ? Math.abs(result.value) : result.value;
const dist = Math.abs((v - result.threshold) / result.threshold);
```

Same bug in `_autoFlags` at L235. Apply both.

### F-216-04 — MEDIUM — `detect-changes` event omits firstSeen case and never alerts

**File:** `detect-changes.js:180-188`
**Severity:** MEDIUM (silent miss of new-universe entrants)

**Description:** When `!prev && isComputable` (ticker observed for the first time), the
block at L180-188 records `newState[methodId]` with `firstSeen: true` but **emits no
event**. The else-branch at L189-196 (the catch-all for unchanged status) also emits
nothing — correct. But the first-time observation never generates a
`METHOD_PASS_GAINED` event even when the method is passing. Karl loses signal on
brand-new universe entrants (recently added watchlist tickers).

**Mechanism:** A newly-added ticker that's already passing all CORE methods produces
zero Discord/log signal, indistinguishable from a non-event ticker.

**Fix:** When `!prev && isPass`, emit a `METHOD_PASS_NEW` event (INFO severity). At
L180-188:

```js
} else if (!prev && isComputable) {
  if (isPass) {
    events.push({
      methodId, type: 'METHOD_PASS_NEW', severity: 'INFO',
      message: `${methodId}: first observation, value=${result.value?.toFixed(2)} (PASS)`
    });
  }
  newState[methodId] = { value: result.value, pass: isPass, lastChanged: today, firstSeen: true };
}
```

### F-216-05 — MEDIUM — `score-aggregator` RED_FLAG EXTREME_SLOAN threshold mismatch with sloan-ratio FAIL_THRESHOLD

**File:** `methods/score-aggregator.js:68-73`, `methods/sloan-ratio.js:21`
**Severity:** MEDIUM (red-flag mostly unreachable, design vs. code drift)

**Description:** `RED_FLAG_RULES.EXTREME_SLOAN` triggers at `|val| > 0.30`. But
`sloan-ratio.js` `FAIL_THRESHOLD = 0.20` — single-year |Sloan| > 20% sets `flag:
'EXTREME_SINGLE_YEAR'` with `pass: true`. So between 20% and 30% the stock is flagged
internally as EXTREME by the method but the score-aggregator red-flag rule does
**not** fire (requires > 30%). For consecutive-year >20% the stock is rejected via
DataGuard before the red-flag check runs — so the red-flag is reachable only in a
narrow band (single-year |Sloan| ∈ (30%, ∞)) that almost never occurs in clean data.

**Mechanism:** Operator intent (per sloan-ratio header docstring) appears to be 20% as
the "extreme" boundary; the 30% in score-aggregator is stricter and effectively dead
for most stocks.

**Fix:** Align thresholds. Either lower RED_FLAG to 0.20 (and rely on DataGuard for
consecutive-year hard-fail) or raise sloan-ratio to 0.30. The cleaner fix:

```js
EXTREME_SLOAN: {
  id: 'sloan-ratio',
  condition: function(val) { return Math.abs(val) > 0.20; },  // align with sloan-ratio FAIL_THRESHOLD
  label: 'Sloan-Ratio extrem (|>20%|)'
}
```

### F-216-06 — MEDIUM — `walk-forward-perf` price-staleness check is one-sided (entry only, not exit)

**File:** `scripts/walk-forward-perf.js:65-81`, `293-303`
**Severity:** MEDIUM (exit-price quality not validated)

**Description:** `priceAt()` enforces `PRICE_MAX_STALE_DAYS = 7` only when walking
backwards from the target date. For exit prices computed via `nearestTradingDay(futureDate)`,
the function looks ±5 business days but does **not** enforce a staleness cap relative
to the original `futureDate`. If a stock is delisted shortly after the entry date,
the "exit" might be 5 days backwards from a no-trade date that is itself 30 days past
last trade — effectively returning a price for a stock that hasn't traded in a month.

**Mechanism:** Asymmetric stale-price tolerance biases delisting-induced returns. A
ticker with `lastTradeDate = futureDate − 30d` returns price from `futureDate − 30d − 5d`
business days = silent stale exit price.

**Fix:** After `nearestTradingDay()` returns at L301, validate the distance:

```js
const tExit = nearestTradingDay(futureDate, map);
if (tExit && _daysBetween(tExit, futureDate) > PRICE_MAX_STALE_DAYS) {
  // silently drop — stale exit
  continue;
}
```

### F-216-07 — LOW — `_helpers.cagr3y` requires arr.length ≥ 4 but data may have 4 entries indexed 0..3 with annualArr[0] = forecast

**File:** `methods/_helpers.js:49-56`
**Severity:** LOW (forecast contamination only; only relevant if `forecast-contamination-guard` is bypassed)

**Description:** `cagr3y` takes `latest = annualArr[0]` and `oldest = annualArr[3]`,
computes `(latest/oldest)^(1/3) - 1`. If `annualArr[0]` is a Yahoo forecast (the very
issue that `forecast-contamination-guard` exists to catch), CAGR is inflated. The
helper has no defense — it relies entirely on the upstream guard.

**Mechanism:** A new method using `cagr3y()` directly (without going through
`revenue-growth-3y` which integrates the guard) inherits the contamination risk.

**Fix:** Defensive — accept an optional `skipFirst` flag:

```js
function cagr3y(annualArr, opts) {
  if (!Array.isArray(annualArr)) return null;
  const offset = (opts && opts.skipFirst) ? 1 : 0;
  if (annualArr.length < 4 + offset) return null;
  const latest = ... annualArr[offset] ...;
  const oldest = ... annualArr[offset + 3] ...;
  ...
}
```

Or at minimum, add a docstring warning at L49 that callers must run their own
forecast-contamination check.

### F-216-08 — LOW — `detect-changes.saveState` pruning uses string `>=` comparison on `lastChanged` that assumes ISO format

**File:** `detect-changes.js:112-115`
**Severity:** LOW (works today, brittle to schema change)

**Description:** `hasRecentChange = Object.values(methods).some(m => m && m.lastChanged && m.lastChanged >= cutoffDate)`.
`cutoffDate` is sliced `YYYY-MM-DD`. `m.lastChanged` is set in `detectMethodDiffs` to
`today` (also `YYYY-MM-DD`). String compare works because ISO date format is
lexicographically sortable.

**Mechanism:** Brittle to any caller that stores `lastChanged` as a full ISO timestamp
or epoch ms. The current code paths never do this, but a future migration that adds
hours/minutes (e.g. for finer-grained dedup) silently changes string-compare
semantics: `'2026-05-17T12:00:00.000Z' >= '2026-04-17'` works, but
`Date.parse(epochMs) >= '2026-04-17'` does not.

**Fix:** Normalize defensively:

```js
const ts = String(m.lastChanged).slice(0, 10);
const hasRecentChange = ... ts >= cutoffDate;
```

### F-216-09 — LOW — `walk-forward-perf.evaluateVintage` re-computes `nearestTradingDay` on every pick × horizon (perf)

**File:** `scripts/walk-forward-perf.js:300-303`
**Severity:** LOW (perf, not correctness)

**Description:** For each (mode, horizon, pick) the loop computes `nearestTradingDay()`
twice (entry + exit). The entryDate is the same for every pick within a horizon — same
asOf date. Hoisting the entry-date snap outside the inner loop would save N lookups per
horizon. Same applies to `computeFrozenVintageMedianReturn` and `computeBenchmarkReturn`
both called per-horizon, each doing redundant entry-snap.

**Mechanism:** Pure performance. With 100 picks × 3 horizons × 3 modes × N vintages, the
quadratic factor compounds. For N≈40 vintages, this is ~36k unnecessary `nearestTradingDay`
calls per run.

**Fix:** Cache snapped entry date per ticker per asOfDate inside `evaluateVintage`:

```js
const entrySnapCache = new Map();
function snapEntry(ticker, asOf) {
  const key = ticker + '|' + asOf;
  if (!entrySnapCache.has(key)) {
    const map = priceIndex[ticker];
    entrySnapCache.set(key, map ? (nearestTradingDay(asOf, map) || asOf) : asOf);
  }
  return entrySnapCache.get(key);
}
```

## 4. Anchor Cross-Check

| Finding | Anchor Tested | Result |
|--------|---------------|--------|
| F-216-02 (coverage gate) | NVDA HYPERGROWTH | 6/6 methods computable, score=96 (passes gate trivially) — anchor doesn't expose the bug; need small-cap with sparse data. Snapshot dataset doesn't include obvious small-cap with ≤2 computable HG-CORE methods. |
| F-216-05 (sloan thresholds) | NVDA | Sloan = 11.3%, pass=true, flag=WARNING. EXTREME_SLOAN red-flag not triggered (requires >30%). Confirms behavior described. |
| F-216-01 (cache replay) | n/a | Code-only analysis. Dead code at L148-165, masked by L248-263. No live failure currently. |
| Score-aggregator HG flow | NVDA, MSFT, PLTR | All three score in A-tier with no red flags. End-to-end pipeline healthy on anchors. |

## 5. Clean Files (zero findings)

- `methods/runner.js` — registry loader, explicit-load via index.js, duplicate-id guard, type-filter logic. Clean.
- `methods/strategy-modes.js` — sector-exclude regex, mcap-floor distinguishes missing vs below, applyProfile non-destructive. Clean (Tag 206l fix verified).
- `methods/method-types.js` — REGISTRY entries align with SCORE_WEIGHTS demands and index.js entries (Tag 206d/h fixes verified). Clean.
- `methods/sector-medians-compute.js` — F-ME-008 positive-only filter, F-SM-024 corrupt-file forensics with rename, F-ME-009 stale-cache pruning. Clean.
- `methods/sector-median-lookup.js` — v2 region-aware path with explicit GLOBAL fallback; lookupPercentile guards invalid pTag. Clean.
- `methods/region-mapping.js` — exchange→region→currency→OTHER priority chain. Clean.
- `methods/data-quality.js` — F-DQ-004 envelope-null fix, F-DQ-007/8 threshold recalibration with docstring sync. Clean.
- `field-coverage.js` — F-DQ-005 absolute floor with cold-start safety, F-DQ-006 expanded TRACKED_FIELDS. Clean.
- `methods/trend.js` — Bug #15 threshold-op default fix verified. Clean.
- `lib/atomic-write.js` — tmp + rename with pid + counter collision avoidance + cleanup. Clean.
- `snapshot-picks.js` — atomic writes throughout, async batch loader, first-seen cache with corruption-safe rebuild, pipeline-health 5% threshold. Clean (Tag 189 + F-PF-008 verified).

## 6. Risk Concentrations

**`scripts/method-effectiveness.js`** has the highest finding density (1 HIGH + the
dead-code stink). The cache-replay block at L148-165 is described in a self-aware
comment at L243-247 ("NOTE: The cache replay loop above has a bug ... re-do it
cleanly by rebuilding perMethod entirely from scratch using processed data"). The
author **knew** about the find()-by-ret problem but left the buggy path in. This is
the kind of code that bites in a future refactor. Recommendation: delete L148-165
entirely now while the rebuild at L248-263 still covers it.

**`methods/_helpers.js`** confidence/flag logic (`_inferConfidence`, `_autoFlags`)
shares the asymmetric `lte_abs` distance bug — fix both call-sites in the same patch.

**`methods/score-aggregator.js`** has graduated normalization (smooth-curve, Tag F-ME-012)
that has been carefully tuned, but the SCORE_WEIGHTS coverage gate is mode-blind.
HG modes are the squeaky wheel — recent-IPO hypergrowth stocks are exactly the
candidates Karl wants to surface, but their data sparsity bumps them just under
the 40% gate. This is the most likely "where did my pick go" silent failure.

## 7. Recommended Action Order

1. **F-216-01** (HIGH, 5 min): delete dead cache-replay block at method-effectiveness L148-165.
2. **F-216-02** (HIGH, 30 min + anchor pass): mode-aware coverage gate in score-aggregator.
3. **F-216-04** (MEDIUM, 10 min): emit METHOD_PASS_NEW for first-time observations.
4. **F-216-05** (MEDIUM, 5 min): align EXTREME_SLOAN threshold with sloan-ratio FAIL_THRESHOLD.
5. **F-216-06** (MEDIUM, 15 min): symmetric staleness on exit prices.
6. **F-216-03** (MEDIUM, 10 min): lte_abs-aware confidence distance.
7. **F-216-08** (LOW): defensive ISO normalization in saveState pruning.
8. **F-216-07** (LOW): cagr3y skipFirst option / docstring.
9. **F-216-09** (LOW): entry-snap caching in walk-forward-perf.
