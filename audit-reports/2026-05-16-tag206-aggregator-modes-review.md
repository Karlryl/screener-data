# Tag 206 — Aggregator + Strategy-Modes Deep Review

**Scope:** `methods/score-aggregator.js` (307 LOC) + `methods/strategy-modes.js` (412 LOC).
**Mode:** read-only static analysis.

---

## Summary

- **CRITICAL:** 0
- **HIGH:** 2
- **MEDIUM:** 5
- **LOW:** 4

**SCORE_WEIGHTS sums:**

| Mode | Sum |
|---|---|
| HYPERGROWTH | 0.25+0.10+0.25+0.10+0.15+0.15 = **1.00** |
| QUALITY_COMPOUNDER | 0.25+0.15+0.20+0.15+0.10+0.05+0.05+0.05 = **1.00** |
| TURNAROUND | 0.25+0.25+0.20+0.15+0.10+0.05 = **1.00** |

All three modes sum exactly to 1.0 — no F-ME-023 false-REJECT risk from weight-sum drift.

---

## Consistency-Test Results

### Test 1: every DATAGUARD-type method appears in some `dataGuards[]` *or* HARD-GATE

DATAGUARD types in REGISTRY (15): `sloan-ratio, net-debt-ebitda, asset-growth-divergence, revenue-shock-guard, q-spike-dataguard, forecast-contamination-guard, quarter-concentration-guard, deceleration-guard, revenue-volatility-guard, loss-magnitude-guard, metric-divergence-guard, net-income-volatility-guard, pre-commerciality-megacap-guard, closed-end-trust-guard, r40-sanity-cap`.

Reachable via `mode.dataGuards[]`: `sloan-ratio, forecast-contamination-guard, q-spike-dataguard, revenue-volatility-guard, revenue-shock-guard` (5).

Reachable only via HARD-GATE in `generate-screener.js:399`: `loss-magnitude-guard, metric-divergence-guard, net-income-volatility-guard, pre-commerciality-megacap-guard, closed-end-trust-guard, r40-sanity-cap` (6) — **OK, intentional Tag 199+ design**.

**Demoted to softGuards (DATAGUARD type, but treated as soft):** `net-debt-ebitda` (TURNAROUND softGuards), `asset-growth-divergence` (QC softGuards), `quarter-concentration-guard, deceleration-guard` (HG softGuards). **OK by design** but worth a one-line code comment to prevent future confusion.

### Test 2: every id in `dataGuards[]`/`softGuards[]` resolves to a method

All resolve; `working-capital-anomaly` is DIAGNOSTIC type but appears in QC.softGuards — acceptable (soft warning).

### Test 3: SCORE_WEIGHTS ids → REGISTRY + index.js + real file

All 18 unique ids across the 3 modes exist as files, are in `methods/index.js`, and are in `method-types.js` REGISTRY. **PASS.** No silent-zero risk.

---

## Bugs (severity → file:line → fix)

### HIGH-1 — `rule-of-x` weighted but `defaultActive: false`
`score-aggregator.js:35` weights `rule-of-x` at 0.10 in HYPERGROWTH; `method-types.js:30` flags it `defaultActive:false`. Today `generate-screener.js:167` calls `Runner.evaluateStock(stock)` *without* `onlyDefault`, so all methods run and rule-of-x **is** computable. **But:** any future caller that passes `{onlyDefault:true}` (e.g. fast-path screener, walk-forward) silently loses 10% of HG coverage. Coverage falls to 0.90 — still passes F-ME-023 (0.4 floor) but inflates per-method weight by 11%, distorting tiers.
**Fix:** flip `rule-of-x.defaultActive=true`, OR add a load-time assert that every SCORE_WEIGHTS id has `defaultActive:true`.

### HIGH-2 — `q-spike-dataguard.components.spikeShare` already rounded to percent
`q-spike-dataguard.js:230` stores `spikeShare = Math.round(spikeShare*100)` (integer 0-100). Score-aggregator `score-aggregator.js:228` defensively does `share = shareRaw > 1 ? shareRaw / 100 : shareRaw`. Works for typical values, but for a `spikeShare` of exactly 0.40-0.50 the *unrounded* float is lost — penalty granularity is 1pp instead of ratio-precision. Worse, if a future refactor of q-spike outputs `0.41` (unrounded), code interprets it as 41% and applies wrong penalty (share=0.41 → no penalty; same numeric value pre-round=41 → penalty=4%).
**Fix:** store both `spikeShareRaw` (0..1) and `spikeSharePct` (0..100); have aggregator read the raw.

### MEDIUM-3 — `normalizeMethodScore` returns 0.3 for non-numeric threshold even when pass=false intentionally
`score-aggregator.js:94`: when `threshold` is a string (`'TURNAROUND'`, `'FLAT'`), returns 0.3. For TURNAROUND mode, `profitability-state` has weight 0.25 — a failing stock contributes 0.075. The `acceptValues` mechanism in `evaluateMode` filters at the must-check level (not score), so a stock whose state is `'LOSS'` (fails accept) still scores 0.3 from this code path. **0.3 + other weak scores can total ≥50, accidentally tiering as NEAR_MISS.**
**Fix:** in computeScore, also pass `acceptValues` and force score=0 when components.state ∉ acceptValues.

### MEDIUM-4 — `lte_abs` zero-threshold branch unreachable
`score-aggregator.js:111` checks `if (threshold === 0) return absVal === 0 ? 1.0 : 0.0;` but the earlier guard at line 99 already returned for `threshold === 0`. Dead code. Harmless but suggests the `op==='lte_abs'` path was added without re-reading the earlier guard.
**Fix:** delete line 111 or move the early guard into per-op branches.

### MEDIUM-5 — `mcap=0` (missing data) treated as "below floor"
`strategy-modes.js:170`: a stock with `marketCap=null` ends up `mc=0` and fails with `'mcap_below_floor'`. The reason code is misleading — the real reason is "missing data". Triage agents will look for screener bugs that are actually data-pipeline issues.
**Fix:** when `mcRaw == null`, return `reason:'missing_mcap'` (or treat as incomputable) instead of conflating with a real floor breach.

### MEDIUM-6 — `audit_multiplier` env gate not normalized
`score-aggregator.js:222`: `process.env.AUDIT_SCORE_MULTIPLIERS === '1'`. Strict string match; setting the var to `true`, `yes`, `on`, or `'01'` silently disables it. Walk-forward perf scripts that try to enable via boolean-y env will fail-open.
**Fix:** `['1','true','on','yes'].includes(String(process.env.AUDIT_SCORE_MULTIPLIERS).toLowerCase())`.

### MEDIUM-7 — listing-age multiplier divisor (5y) ≠ method threshold (3y)
`score-aggregator.js:239` uses `value / 5`. Method's own pass-threshold is 3y. A 3y-listed QC stock that *passes* the method only gets 60% credit on score. Either the threshold should be 5, or the divisor should match.
**Fix:** align — recommend divisor `THRESHOLD_QC_HISTORY = 5` with code comment, or import `listing-age.THRESHOLD`.

### LOW-8 — `working-capital-anomaly` in QC.softGuards but DIAGNOSTIC type
`strategy-modes.js:118`. `evaluateMode` line 192 checks `r.pass === false` — DIAGNOSTIC methods may not always set pass. Risk: if WCA returns `pass:undefined`, the soft-guard penalty never fires. Verified WCA *does* set pass, so working today; brittle for new DIAGNOSTICs added to softGuards lists.
**Fix:** assert at startup that every id in any mode's softGuards has a defined pass-semantic.

### LOW-9 — `RED_FLAG_RULES` only fires for `net-debt-ebitda` & `sloan-ratio`
`score-aggregator.js:62`. Tag 121+ TODO comment says "Dilution-Red-Flag wenn Share-Outstanding-Daten verfuegbar" — never implemented. Tag 201 buyback-yield + sbc-trend exist; red-flag rules are an obvious extension.
**Fix:** add `EXTREME_DILUTION` rule keyed on `sbc-trend` or `buyback-yield`.

### LOW-10 — `evaluateMode` `mode.dataGuards.iteration` skips missing methods silently
`strategy-modes.js:177-182`: `if (r && r.computable === true && r.pass === false)`. If a DATAGUARD method is incomputable (no data), the stock passes the guard. For `forecast-contamination-guard` etc. this is by design, but it means a stock with zero quarterly data **bypasses every q-based guard** and still gets scored. The `buildStory` MISSING_GUARD_TEXT only surfaces this in the *story* — not in tier / score.
**Fix:** track `missingGuardCount` per mode-eval and downgrade tier when ≥ N guards missing.

### LOW-11 — `_methodRegistryCache` never invalidated
`strategy-modes.js:10`. Test code that hot-swaps `Runner.METHODS` between tests will see stale cache. Not a prod issue, but fixture-builder tools may hit it.
**Fix:** export a `_resetRegistryCache()` for tests.

---

## `normalizeMethodScore` corner-case analysis

| Case | Behavior | Verdict |
|---|---|---|
| `methodResult.pass===true` | returns 1.0 | OK |
| `computable===false` | returns 0 | OK |
| `value==null` & `threshold==null` | returns 0.3 | **Suspicious** — a wholly empty result scores 0.3 (3%). Combined with 30% of methods missing = 9pp baseline. Acceptable but explains why incomputable-heavy stocks aren't pure REJECTs. |
| `threshold` is string (`'TURNAROUND'`) | returns 0.3 | See MEDIUM-3 |
| `threshold===0, val>0, op=gte` | returns 1.0 | Edge OK (div-zero guard). |
| `threshold===0, val<=0, op=gte` | returns 0.0 | OK |
| `op=lte, val<=0` | returns 0.99 (net-cash short-circuit) | Documented OK |
| `op=lte_abs, absVal≈0, threshold>0` | `ratio = threshold/1e-10` → huge → ratio>=0.9 → returns 0.99 | OK (clamped via Math.min) |
| Graduation curve continuity at 0.5, 0.7, 0.9 | `f(0.5)=0.10`, `f(0.7)=0.30`, `f(0.9)=0.70` — all three boundaries match exactly | **No discontinuity.** |
| `ratio===1.0` | `0.7 + 0.1*2.9 = 0.99` (still 0.99, not 1.0) | OK — `pass=true` already returned 1.0 above. |
| `ratio<0` | `Math.max(0, ratio*0.2) = 0` | OK. |
| `methodResult.threshold` overrides `methodMeta.threshold` | Tag 155 — piotroski scaledThreshold honored | OK |

---

## Top 5 Bugs (file:line + fix)

1. **HIGH-1** `score-aggregator.js:35` + `method-types.js:30` — `rule-of-x` weighted but `defaultActive:false`. **Fix:** flip `defaultActive:true` *or* add load-time assert.
2. **HIGH-2** `q-spike-dataguard.js:230` ↔ `score-aggregator.js:228` — pre-rounded `spikeShare` loses precision and is brittle to future refactor. **Fix:** publish `spikeShareRaw` (0..1).
3. **MEDIUM-3** `score-aggregator.js:94` — non-numeric threshold (`'TURNAROUND'`) yields 0.3 score even when `acceptValues` says fail. **Fix:** pass acceptValues into computeScore.
4. **MEDIUM-5** `strategy-modes.js:170` — missing mcap conflated with `mcap_below_floor`. **Fix:** distinct `missing_mcap` reason.
5. **MEDIUM-7** `score-aggregator.js:239` — listing-age divisor (5) ≠ method threshold (3). **Fix:** align divisor to method threshold or document the 5y QC convention.

---

**Word count:** ~890.
