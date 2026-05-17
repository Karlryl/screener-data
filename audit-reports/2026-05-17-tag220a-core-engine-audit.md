# Tag 220a — Core Engine Audit (Read-Only)

**Date:** 2026-05-17
**Scope:** `engine-v7.3.js`, `score-orchestrator.js`, `manipulation-filters.js`, `engine-fixtures.js`, `engine-cli-tests.js`
**Cross-reference:** `methods/score-aggregator.js` (audited Tag 216)
**Auditor:** core-engine specialist agent (Opus 4.7)
**Modifications made:** none — read-only audit, report only.

---

## 1. Executive Summary

The "core engine" layer is the legacy v7.3 scoring stack (`scoreTrackA` / `scoreTrackB`). Per `docs/decisions/ADR-001-retire-track-a-b-scoring.md` (Tag 134, accepted 2026-05-13) this stack is **deprecated and not invoked by any production code path**. Its only live consumers are:

- `engine-cli-tests.js` — workflow pre-pull guard
- `score-orchestrator.js` — called only by `diagnose-spec.js` and `engine-cli-tests.js`
- `diagnose-spec.js` — dev-time diagnostic

That said, this layer is still the **pre-pull workflow gate**: if its tests fail the daily Yahoo pull stops. So bugs here are not "everything is mis-scored", but rather "the gate that protects every daily pull is brittle and (in places) testing the wrong things".

**Findings:** 9 total (1 HIGH, 4 MEDIUM, 4 LOW).

The single sharpest finding is **F-220a-01**: `engine-cli-tests.js` line 128 sanity-checks `ManipulationFilters` for `runFilters` or `applyFilters` — **neither of which exists**. The real method is `evaluate`. The gate silently passes a broken filter module via the `Object.keys(...).length` fallback.

The second sharpest is **F-220a-02**: fixtures all carry a hard-coded `fetchedAt: '2026-04-30'`. The 120-day staleness gate makes every fixture turn unclassifiable on a fixed date (≈ 2026-08-28), at which point the pre-pull gate fails and the daily pull stops with no code change.

The third is **F-220a-03**: `isRevenueMaterial(prevRevenue, marketCapUSD, …)` compares a value in the stock's reporting currency (DKK / EUR / GBP) against a USD-denominated market cap. For non-USD reporters the materiality ratio is silently wrong by the FX factor.

---

## 2. Methodology

### Files read in full
| File | Lines |
|---|---|
| `engine-v7.3.js` | 1271 |
| `score-orchestrator.js` | 347 |
| `manipulation-filters.js` | 221 |
| `engine-fixtures.js` | 486 |
| `engine-cli-tests.js` | 145 |
| `methods/score-aggregator.js` (cross-ref) | 355 |
| `docs/decisions/ADR-001-retire-track-a-b-scoring.md` | 64 |
| `diagnose-spec.js` (callsite check) | scanned |

### Approach
1. Read each file in full.
2. Cross-reference every consumer of the engine surface with `grep`.
3. Mentally execute `engine-cli-tests.js` against each fixture to surface assertion gaps.
4. Compare engine sub-profile taxonomy to fixture coverage.
5. Trace every currency-conversion path end-to-end.
6. Read ADR-001 to establish "what is dead vs. what is live".

---

## 3. Findings

### F-220a-01 — HIGH — Pre-pull gate silently passes broken ManipulationFilters

**File:** `engine-cli-tests.js:128-132`

```js
if (typeof ManipulationFilters.runFilters !== 'function' && typeof ManipulationFilters.applyFilters !== 'function') {
  const keys = Object.keys(ManipulationFilters);
  if (!keys.length) throw new Error('ManipulationFilters empty');
}
```

`manipulation-filters.js` exports neither `runFilters` nor `applyFilters` — the real public API is `evaluate` (see line 183 of that file). The check therefore always falls through to the `Object.keys.length` branch. As long as the module exports *any* keys (it exports `FILTER_VERSION`, `FILTERS_BY_PROFILE`, `evaluate`, `_helpers`), the test passes — even if `evaluate` were renamed, removed, or refactored to throw. The gate is theatre.

**Mechanism:** the API-surface assertion was written to a method name that has never existed. The fallback `Object.keys.length` makes the check unfalsifiable.

**Suggested fix:** check for `typeof ManipulationFilters.evaluate === 'function'`. Match the orchestrator's actual call site at `score-orchestrator.js:250`.

---

### F-220a-02 — HIGH — Fixture `fetchedAt` hard-codes a date that will silently rot

**File:** `engine-fixtures.js` (every fixture, e.g. lines 51, 89, 126, 170, 217)

Every fixture has `fetchedAt: '2026-04-30'`. `Engine.isStaleData(meta, 120)` (engine-v7.3.js:268-277) fails when filing age > 120 days. Today (2026-05-17) is +17 days — still fresh. Around **2026-08-28** (+120 days) all fixtures will be flagged stale: `scoreTrackA` returns `UNCLASSIFIABLE_DATA_RISK` for every fixture, `expected.actionStatus` checks fail, the pre-pull gate goes red, and the daily Yahoo pull stops — with no code change. Anyone debugging will see a "rotting fixtures" pattern that requires bumping the date.

**Mechanism:** static date + age-based gate = ticking time bomb. Same pattern the Tag-204 staleness audit warned about for other consumers, never propagated here.

**Suggested fix:** either (a) compute `fetchedAt` as `today - 30d` at fixture-load time, or (b) inject an `asOf` override in the test runner so the engine treats "today" as 2026-04-30 for fixture purposes. (a) is simpler.

---

### F-220a-03 — MEDIUM — Currency mismatch in `isRevenueMaterial`

**File:** `engine-v7.3.js:221-230`, called from `:489`, `:492`, `:805`

```js
function isRevenueMaterial(prevRevenue, marketCapUSD, growthRateYoY) {
  …
  if (absRev / marketCapUSD < cutoff) return false;
  …
}
```

Callers pass `prevRevenue` raw from `stock.annual.annualRev[i].value` or `stock.timeseries.revenueQ[i].value` — i.e. in the stock's reporting currency (DKK, EUR, GBP for the NVO / RHM.DE / ASML fixtures). `marketCapUSD` is, as the name says, in USD. The ratio is therefore meaningless for non-USD reporters.

Concrete example: NVO has `annualRev[4] = 122e9 DKK`, mcap 450e9 USD.
- As computed: `122e9 / 450e9 = 0.27` → far above the 0.005 cutoff → "material".
- Correctly computed: `122e9 * 0.143 = 17.5e9 USD; 17.5e9 / 450e9 = 0.039` → still material, but the ratio is 7× different.

For smaller-cap EU reporters the bug can flip the verdict (material ↔ low-base). It silently skews `computeRevenueAcceleration` and the `PENALTY_GROWTH_DECEL` branch of `computePenalties`.

**Mechanism:** function name says `marketCapUSD`, callers respect it; but `prevRevenue` was never converted because the engine has no general-purpose "normalize this raw-value to USD" helper that's wired here.

**Suggested fix:** convert `prevRevenue` via `normalize({value: …, currency: stock.meta.reportingCurrency}, 'USD', fxRates)` at every call site, or pass already-normalized values. Track-A and Track-B both call it.

---

### F-220a-04 — MEDIUM — `(growth || 0)` collapses null growth in two penalty branches

**File:** `engine-v7.3.js:785`, `:830`

```js
// line 785
if (ps != null && ps > 50 && fcfMargin != null && fcfMargin < 0 && (growth || 0) < 30) { … PENALTY_VALUATION_TRIPLE_RISK }
// line 830
if (fwdPE != null && fwdPE > 100 && (growth || 0) < 30) { … }
```

When `growth` is `null` (genuinely missing — Yahoo sometimes omits `revenueGrowth` for certain tickers, hence the orchestrator's whole `_fillDerivedMetrics` layer), `(growth || 0)` returns 0, so the branch triggers the penalty as if growth were confirmed at 0%. Tag 181's F-EN-017 fix (`engine-v7.3.js:1150`) already migrated `passesTrackAUniverse` away from this exact pattern but missed these two penalty sites.

**Mechanism:** missing-as-zero (audit category #4) — engine's stated principle is null=unknown, 0=confirmed-zero. These two lines violate it.

**Suggested fix:** change to `growth != null && growth < 30` so the penalty only fires on actual evidence. Same fix already applied at line 1153.

---

### F-220a-05 — MEDIUM — BANK / INSURANCE / REIT receive full Track-A/B scoring

**Files:** `engine-v7.3.js:60-72` (taxonomy), `:130-159` (classification), `:906-1134` (scoring)

The sub-profile taxonomy declares `BANK`, `REIT`, `FINTECH`, and INSURANCE-folded-into-FINTECH (line 140: `ind.includes('insurance') → SUB_PROFILES.FINTECH`). None of these profiles have any `antiManipFilters`. None of them get score gating. Track-A computes Hypergrowth / Rule-of-40 / ScalingEfficiency on them; Track-B computes ROIC via `(equity + debt - cash) / NOPAT` — meaningless on a bank (where "debt" is deposits, "cash" is reserves, and the entire balance sheet works inversely) and likewise on a REIT (where leverage is structural and ROIC is FFO-based, not NOPAT-based).

The orchestrator does not filter these out; the test fixtures do not exercise them; `score-aggregator.js` (the live scorer) has its own sector excludes, but the deprecated engine has nothing equivalent. Per the user's scope-question this means anchor-safety: a hand-classified BANK/REIT *could* surface in HG/QC anchors if anyone ever re-activated this code path.

**Mechanism:** taxonomy admits these profiles but scoring paths weren't specialized; the deprecation in ADR-001 means no one is going to fix this in the v7.3 engine. The risk is dormant, not active.

**Suggested fix:** in `engine-v7.3.js`, gate `scoreTrackA` / `scoreTrackB` at the top: if `subProfile.id ∈ {BANK, REIT, INSURANCE-as-FINTECH-subset}`, return `actionStatus: UNCLASSIFIABLE_DATA_RISK` with a `PROFILE_OUT_OF_SCOPE` reason code. Cheap, anchor-safe, matches what score-aggregator's sector-excludes already do for the live path.

---

### F-220a-06 — MEDIUM — Fixture coverage gap: no BANK, REIT, FINTECH, ENERGY, CONSUMER_STAPLES

**File:** `engine-fixtures.js`

`grep -E 'FINTECH|BANK|REIT|ENERGY|CONSUMER_STAPLES'` against fixtures returns zero matches. Of the 11 declared sub-profiles, only 5 are exercised (HARDWARE×3, HEALTHCARE, INDUSTRIAL, SAAS×2, MARKETPLACE). The 6 unexercised profiles cover the entire financial-services and real-estate complex — the exact profiles where Track-A/B's ROIC and Rule-of-40 math is most wrong (see F-220a-05).

The engine-cli-tests.js gate therefore cannot catch a regression that breaks BANK / REIT / FINTECH / ENERGY classification — only Tag 211-219 method additions touching SaaS/Hardware would be caught.

**Mechanism:** the fixture suite was built early (Tag 1-2) when the engine targeted only SaaS+Hardware. Subsequent profile additions (BANK at Tag 26+38, REIT/ENERGY/CONSUMER_STAPLES at Tag 26) were added to the taxonomy but never fixtured.

**Suggested fix:** add 3 fixtures — one BANK (e.g. JPM-shaped), one REIT (e.g. O), one INSURANCE (e.g. PGR or BRK.B's insurance segment). Expected: `actionStatus = UNCLASSIFIABLE_DATA_RISK` once F-220a-05 lands; until then, document the gap.

---

### F-220a-07 — LOW — Orchestrator tiebreaker on `(finalScore || 0)` collapses null vs zero

**File:** `score-orchestrator.js:222`

```js
candidates.sort((a, b) => {
  …
  return (b.finalScore || 0) - (a.finalScore || 0);
});
```

When a track returns `finalScore: null` (UNCLASSIFIABLE_DATA_RISK), `(null || 0) === 0`. If the *other* track legitimately scored bucket=OUT with `finalScore = 0` (numeric), the sort key is equal; JS's stable sort preserves insertion order, so Track-A wins. Result: an unclassifiable Track-A is preferred over a real-scored Track-B at the boundary.

The real-world impact is small (a stock that scored 0 on Track-B is going to be DISQUALIFIED anyway; the alternativeTrack annotation may be misleading). But it violates the "universe-passing tracks have priority" principle stated in the comment above.

**Mechanism:** missing-as-zero collapsing into numeric-zero (audit category #4).

**Suggested fix:** in the sort comparator, treat `finalScore == null` as `-Infinity`, so any real number outranks it.

---

### F-220a-08 — LOW — Stale `targetCur` parameter never propagated to `getMetricValue`

**File:** `engine-v7.3.js:354-358`, callers `:371,388,389,404,405,456,457,529,574,671,689`

`getMetricValue(stock, key, targetCur, fxRates)` accepts FX args, but every call site passes only `(stock, key)`. For percent metrics (no `currency` field) this is harmless — `normalize` returns the raw value. But the signature implies a converted-value contract that no caller honors. If a future change wraps a percent metric in `{value, currency: '%'}` style, every consumer would silently get the raw value back.

**Mechanism:** dead parameters in a hot API. Sets a trap for future callers who assume the function actually converts.

**Suggested fix:** either delete `targetCur`/`fxRates` params (since current call sites prove they're unnecessary for the metrics used), or thread them through from `scoreTrackA/B` to every call site for correctness-by-construction.

---

### F-220a-09 — LOW — Track-A `scoreTrackA(stock).coreScore` can mislead via 0.95-sum weights

**File:** `engine-v7.3.js:960-968`

```js
let weights = af.applicable
  ? { hyper: 0.30, rule: 0.25, scaling: 0.20, af: 0.20 }   // sum=0.95 by design
  : { hyper: 0.38, rule: 0.30, scaling: 0.27, af: 0 };     // sum=0.95 by design
```

The comment correctly flags this as intentional (F-EN-001, Tag 179): the 5% under-sum makes "100" unreachable and the BUCKETS thresholds (A≥75, B≥60) were tuned to the depressed scale. This is documented and protected against accidental "fix".

But: a separate code path (`computeRuleComposite`) takes `max(rox.score, ro40.score)` — meaning if both apply, the rule weight is effectively double-counted into the max, not a weighted blend. For a SaaS stock with `rox=85, ro40=85`, the rule contribution is `0.25 * 85 = 21.25`. For non-SaaS with `ro40=85`, it's `0.30 * 85 = 25.5`. So SaaS-applicable stocks get a *lower* rule weight than non-SaaS. The intent (rule-of-X is a SaaS-superset of rule-of-40) is opposite of the realised weighting.

**Mechanism:** the max-of-composite collapses two independent rules into one slot, then the weighting treats the slot as if it were a single rule.

**Suggested fix:** if rule-of-X is meant to be additive evidence on top of rule-of-40 for SaaS, blend them: `composite = 0.5*rox + 0.5*ro40` for applicable, `ro40` for non-applicable. Or: keep `max` but boost rule-weight to 0.30 for SaaS to preserve symmetry. (Per ADR-001 this is moot for production — flagged for completeness only.)

---

## 4. Clean Elements

The following stood out as well-engineered and required no fix:

- **`_deepFreeze` (engine-v7.3.js:248-259):** recursive, circular-safe, no-op on already-frozen. Defensive against engine mutation of `canonicalInput`.
- **`safeYoY` (engine-v7.3.js:233-236):** correctly handles null, zero base, and negative base via `Math.abs(base)`.
- **`stdDevSample` (engine-v7.3.js:240-245):** uses `n-1` denominator (sample, not population) per Tag-53 audit fix.
- **`computeCoverage` (engine-v7.3.js:283-322):** weighted Track-A 50% / Track-B 30% / Optional 20% with explicit hard requirements (mcap, growth, sector). Clean three-tier structure.
- **`_filter_industrial_earnings_quality` (manipulation-filters.js:107-137):** the negative-OpInc branch (line 123-126) correctly catches one-time gains over-compensating operating losses — a subtle case the original gate (`oi[i]>0`) missed and the Tag-8 audit-fix correctly addressed.
- **Deprecation discipline:** ADR-001 plus the `_warnDeprecated` console-warn (engine-v7.3.js:900-904) plus the explicit pointer to `methods/score-aggregator.js` is exemplary — most legacy code in the wild doesn't even self-identify.
- **`computePenalties.PENALTY_GROWTH_DECEL` materiality-guarded ladder (engine-v7.3.js:799-827):** Hyper/Strong/Mid/Low decel bands with FCF gating is well-thought-out, despite the F-220a-03 currency-mismatch caveat.

---

## 5. Engine Architecture — Verbal Map

Two **independent** scoring stacks live in this codebase:

```
┌─────────────────────────────────────────────────────────────────┐
│ LEGACY STACK (engine-v7.3.js)                                   │
│                                                                 │
│   stock                                                         │
│     ├─► scoreTrackA(stock, {fxRates}) ──┐                       │
│     │   (Hypergrowth + Rule-of-X/40 +   │                       │
│     │    ScalingEff + AktienfinderScore)│                       │
│     │                                   ▼                       │
│     │                          ┌─────────────────┐              │
│     │                          │  Orchestrator   │              │
│     │                          │ scoreSnapshot() │              │
│     │                          │ - dedup tracks  │              │
│     │                          │ - universe sort │              │
│     │                          │ - apply Filters │              │
│     │                          └─────────────────┘              │
│     │                                   ▲                       │
│     └─► scoreTrackB(stock, {fxRates}) ──┘                       │
│         (ROICTrend + GMStability +                              │
│          FCFQuality + EPSCAGR + AF)                             │
│                                                                 │
│   Consumers (only!):                                            │
│     - engine-cli-tests.js  (pre-pull gate)                      │
│     - score-orchestrator.js  (called only by tests + diagnose)  │
│     - diagnose-spec.js  (dev tool)                              │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ PRODUCTION STACK (methods/score-aggregator.js)                  │
│                                                                 │
│   stock ──► runner.evaluateStock(stock)                         │
│             │  loads explicit method list from methods/index.js │
│             │                                                   │
│             ▼                                                   │
│     allResults = { 'rule-of-40': {…}, 'q-spike-dataguard':{…} } │
│             │                                                   │
│             ▼                                                   │
│     score-aggregator.computeScore(allResults, modeId, registry, │
│                                   failedSoftGuards, dataQuality)│
│             │                                                   │
│             ▼                                                   │
│     { score, tier (A/B/NEAR_MISS/REJECT), redFlags, breakdown } │
│                                                                 │
│   Consumers (all production):                                   │
│     - snapshot-picks.js                                         │
│     - generate-modes-report.js                                  │
│     - generate-screener.js                                      │
│     - daily Yahoo workflow                                      │
└─────────────────────────────────────────────────────────────────┘
```

### Confusion Points

1. **"Track" terminology collision.** `engine-v7.3` exposes `Track A` (hypergrowth) and `Track B` (quality), each with its own BUCKETS (A/B/INFLECTION/SPEC/OUT). `score-aggregator` uses `mode` (HYPERGROWTH/QUALITY_COMPOUNDER/TURNAROUND) and Tier (A/B/NEAR_MISS/REJECT). Six totally different identifiers for two scoring axes that *roughly* parallel each other but are NOT the same.

2. **AktienfinderScore is doubly-dead** — `computeAktienfinderScore` always returns `{score: 0, applicable: false}` because `external.aktienfinderScore` is never populated by the Yahoo pull (ADR-001 §23). The 95%-weight `non-AF` branch is therefore always taken. This is *correctly* documented in ADR-001 but a fresh reader hitting `engine-v7.3.js:960-968` first will be confused.

3. **The orchestrator's `_failedUniverse` tiebreaker (line 219-223) is the only place where universe-membership matters.** Engine `scoreTrackA` itself does NOT gate on universe pass — it scores and returns. The orchestrator decides which of the two scored results to surface. This is non-obvious and the only documentation is the comment block on lines 213-218.

4. **Manipulation-filters live OUTSIDE the engine** (separate module, separate version `1.0.0`). They are only applied by `score-orchestrator.js:250` and only attach reason-codes — they do NOT alter the score. This was a deliberate "QUALITY HEURISTIC not FORENSIC DETECTOR" design (manipulation-filters.js:7-13) but the upshot is that the engine-cli-tests gate, which calls `scoreTrackA/B` directly bypassing the orchestrator, never exercises the filters at all. F-220a-01 amplifies this: even the API-surface sanity check is broken.

5. **fxRates flows through engine but is rarely exercised.** All fixtures have either USD reporting OR pre-converted USD market cap. Only NVO's `annual.annualRev` (DKK) and RHM's / ASML's annual data (EUR) actually go through any FX-sensitive code path — and that path is `isRevenueMaterial` (F-220a-03), which has the bug.

6. **`computeRevenueAcceleration` is the only Track-A/B helper still consumed by production** (per ADR-001), via `methods/quarterly-revenue-acceleration.js`. So fixing F-220a-03 (currency mismatch in `isRevenueMaterial`) *does* matter for the live screener — even though Track-A/B as a whole is dead.

---

## End of audit

Read-only completed. No source files modified. The single most actionable item is **F-220a-01** (broken API-surface check in the pre-pull gate); the single most strategically valuable is **F-220a-03** (currency mismatch in `isRevenueMaterial`, which leaks into the live production stack via `quarterly-revenue-acceleration`).
