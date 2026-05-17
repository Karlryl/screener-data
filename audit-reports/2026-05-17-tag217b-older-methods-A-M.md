# Tag 217b — Older Methods Audit (A-M)

**Date:** 2026-05-17
**Auditor:** parallel agent B (Claude Opus 4.7)
**Scope:** 28 method files (A-N range) NOT covered by Tag 209-216 audits.
**Mode:** Read-only; no code changes.

---

## 1. Executive Summary

- **Files read in full:** 28
- **Total findings:** 9
  - HIGH: 1
  - MEDIUM: 5
  - LOW: 3
- **Clean files (zero findings):** 18
- **Anti-patterns observed:** 3 recurring (envelope-only unwrap, NaN-on-zero-denominator in price methods, position-vs-value-filter conflation)

The codebase is mature; most files use the `_unwrap()` convention defensively. The remaining issues are concentrated in older or simpler files that pre-date the `_unwrap` pattern, plus three price-history-based methods that share the same NaN edge case.

---

## 2. Methodology

Read each method file end-to-end, focusing on the standard 10 bug categories from the brief plus method-specific concerns (short-history degradation, `H.buildResult` contract, anchor stocks). Spot-checked field shapes against `snapshots/NVDA.json` to confirm envelope vs. scalar assumptions and to verify which optional fields (`annualShares`, `timeseries.sharesQ`, `stock.insider`) are actually populated.

### Files audited (in alphabetical order, M-N inclusive)
1. `methods/above-200d-ma.js`
2. `methods/altman-z-score.js`
3. `methods/asset-growth-divergence.js`
4. `methods/buyback-yield.js`
5. `methods/capex-trend.js`
6. `methods/closed-end-trust-guard.js`
7. `methods/deceleration-guard.js`
8. `methods/drawdown-52w.js`
9. `methods/earnings-stability.js`
10. `methods/estimate-revision-proxy.js`
11. `methods/ev-ebitda.js`
12. `methods/fcf-stability.js`
13. `methods/fcf-yield.js`
14. `methods/forecast-contamination-guard.js`
15. `methods/forward-pe.js`
16. `methods/gross-margin-acceleration.js`
17. `methods/gross-margin-stability.js`
18. `methods/high-proximity-52w.js`
19. `methods/hypergrowth-quality-class.js`
20. `methods/insider-buy-cluster.js`
21. `methods/insider-net-buying.js`
22. `methods/insider-ownership.js`
23. `methods/listing-age.js`
24. `methods/loss-magnitude-guard.js`
25. `methods/margin-decay.js`
26. `methods/margin-quality.js`
27. `methods/metric-divergence-guard.js`
28. `methods/net-income-volatility-guard.js`

---

## 3. Findings

### F-217b-01 — HIGH — `methods/earnings-stability.js:22, :62-91`
**Category:** Position-vs-value-filter conflation (Cat 8).

**Description:** The `_arrVals` helper filters out non-finite entries with `.filter(v => Number.isFinite(v))` at line 22, which DESTROYS positional year alignment. Then the "max single-year OpInc decline" loop at lines 62-72 iterates `[i]` vs `[i+1]` and treats the result as a YoY (one-year) decline. If `annualOpInc` has a null at, say, 2022 (mid-array gap), the filter collapses [2025,2024,2023,nil,2021,2020] → [2025,2024,2023,2021,2020]. The pair `(2023, 2021)` is then read as a one-year decline when it spans TWO years. A 2y decline of 45% (which a healthy compounder can absorb) gets logged as a one-year decline triggering the "30-50% needs recovery" branch and the `maxDeclineIdx === 0` "no recovery yet" hard-fail at line 78.

**Mechanism:** False-fail of quality compounders whose Yahoo dataset has any mid-history null. Affects QC scoring directly (`earnings-stability` is in `SCORE_WEIGHTS`).

**Suggested fix:** Mirror the pattern used in `margin-quality.js` and `deceleration-guard.js`: keep the raw positionally-aligned array, then skip pair-comparisons where either index is non-finite (rather than collapsing the array first). Or: bail out early with `computable:false` if any null is found inside the working window.

---

### F-217b-02 — MEDIUM — `methods/drawdown-52w.js:46`, `methods/high-proximity-52w.js:45-48`, `methods/above-200d-ma.js:42-47`
**Category:** Division by zero (Cat 6) and silent NaN→true-pass.

**Description:** Three price-history methods compute `(high52w - current) / high52w` (or `current/ma200`) without guarding `high52w === 0` (or `ma200 === 0`). For a stock whose entire 52w window is zero-close (delisted shell, prolonged halt, fixture corruption), `high52w = 0`, giving `value = -Infinity` (drawdown) or `NaN` (above-200d-ma). `H.buildResult` correctly nulls `value` via `Number.isFinite`, BUT the `pass` field is computed BEFORE `buildResult` is called: `pass: drawdown <= THRESHOLD` evaluates `-Infinity <= 0.30` → **true**. Result: `value:null, pass:true, computable:true` — a degenerate "pass" with no value to back it up.

**Mechanism:** Score aggregator credits a passed-with-null-value method.

**Suggested fix:** Guard `if (high52w <= 0) return H.buildResult({computable:false, reason:'invalid 52w high'})` (and analogously for `ma200`) before the ratio division.

---

### F-217b-03 — MEDIUM — `methods/altman-z-score.js:44, :88-93`
**Category:** Coverage assumption (Cat 8) / heuristic surrogate.

**Description:** `_balanceVal(stock, 0, 'totalLiab')` (line 88) tries `annualBalance[0].totalLiab` directly. When Yahoo doesn't expose `totalLiab` (the comment notes this is common), the heuristic `debtVal + 0.4 * max(0, assets - debtVal - cashVal)` is used. The 0.4 coefficient is arbitrary and applies uniformly across sectors. For asset-heavy financials (insurance, banks) where lease/policyholder liabilities can be 80%+ of non-debt assets, this UNDERSTATES liabilities → OVERSTATES book equity → inflates X4 → false SAFE classification. Conversely for a SaaS firm with mostly equity-funded intangibles, it OVERSTATES totalLiab.

**Mechanism:** Sector-asymmetric Z-score bias. The comment correctly identifies the issue but ships the heuristic unchanged. Banking/insurance compounders may score Z artificially high; capital-light SaaS may score artificially low.

**Suggested fix:** Either (a) sector-aware coefficient (financials use 0.7, software uses 0.2), (b) require `totalLiab` and return `computable:false` when absent, or (c) defer Z-score for `Financial Services` sector entirely (Altman explicitly excluded banks from his original calibration anyway).

---

### F-217b-04 — MEDIUM — `methods/gross-margin-stability.js:29-30`, `methods/margin-decay.js:20-23`, `methods/capex-trend.js:33-34`
**Category:** Operator precedence (Cat 1) + envelope-only assumption (Cat 5).

**Description:** Three files use `revs[i] && revs[i].value` to unwrap. Two distinct issues:
1. If `revs[i]` is a raw number (which `_helpers.latestAnnual` explicitly handles), this returns `undefined`. The schema currently emits envelopes, so this is latent — but a single upstream change in `pull-yahoo` to emit scalars breaks all three files silently.
2. If `revs[i]` is an envelope with `value: 0`, the short-circuit returns `0` rather than `undefined` → no functional bug in *this* slot but the pattern is fragile (compare with `capex-vs-sbc-quality.js`/`fcf-stability.js` which use the safe `_unwrap` helper).

**Mechanism:** Silent fragility; will start failing as soon as another agent normalizes any of these fields to scalar.

**Suggested fix:** Replace each `arr[i] && arr[i].value` with the `_unwrap(arr[i])` helper used in every other method in the codebase (e.g. `fcf-stability.js:65-70`). This is a 3-line copy-paste each.

---

### F-217b-05 — MEDIUM — `methods/ev-ebitda.js:31-37`
**Category:** Citation/threshold mismatch (Cat 9) — EBITDA proxy.

**Description:** Line 31 computes `const ebitda = opInc * 1.2` — a hardcoded 20% uplift over operating income to "approximate" D&A. Across the screener universe D&A as % of OpInc varies wildly: software ~10-15%, capex-heavy industrials 40-80%, REITs 100%+. The 1.2 multiplier overstates EBITDA for software (overly LOW EV/EBITDA → false pass) and understates EBITDA for industrials (overly HIGH → false fail). The method name (`ev-ebitda`) advertises a quantity it doesn't actually compute.

**Mechanism:** Cross-sector valuation inconsistency, baked into score weighting.

**Suggested fix:** Either (a) rename to `ev-opincx12` and acknowledge the proxy, (b) compute true EBITDA from `annualOpInc + annualDA` when `annualDA` is available, or (c) fall back to the proxy only when `annualDA` is missing (with a `proxyUsed:true` flag for transparency).

---

### F-217b-06 — MEDIUM — `methods/hypergrowth-quality-class.js:95-99`
**Category:** Threshold direction / heuristic upgrade.

**Description:** When the quarterly path fails (insufficient `revenueQ` history) the annual fallback computes 3 deltas instead of 4. The code then BUMPS the count: `if (strongQ === 3) strongQ = 4; else if (strongQ === 2) strongQ = 3;` (and same for `solidQ`). This artificially promotes annual-only stocks one tier higher than quarterly-only stocks with the SAME real growth breadth, producing inconsistent classifications depending solely on data-feed shape, not on company fundamentals.

**Mechanism:** Two stocks with identical 3y revenue trajectories receive different `class` labels (REAL_HYPERGROWTH_ACCELERATING vs HYPERGROWTH_REVIEW) depending only on whether `timeseries.revenueQ` has 8 entries. Affects HG-mode scoring directly.

**Suggested fix:** Use a fractional pass-rate threshold (e.g. `strongQ / nDeltas >= 0.75`) instead of count-bumping. This is invariant to denominator length.

---

### F-217b-07 — LOW — `methods/above-200d-ma.js:32`
**Category:** Citation/threshold mismatch (Cat 9).

**Description:** Comment on line 32 says "weekly: ~40 weeks ≈ 200 calendar days", but `40 weeks × 7 days = 280 calendar days`, not 200. The lookback for weekly-frequency data is ~40% too long. For weekly series, the correct lookback for a 200-calendar-day MA would be ~29 entries.

**Mechanism:** For weekly-frequency price feeds, MA200 actually represents MA280-equivalent → smoother / lazier signal → slightly under-reactive uptrend detection. Same issue applies analogously in `drawdown-52w.js:40` and `high-proximity-52w.js:39` for the 52w → 52-week conversion (52 weeks × 7 = 364 days ≈ 52 weeks, that one is correct).

**Suggested fix:** `if (avgDaysBetween >= 4) lookback200d = 29;` for the 200d case.

---

### F-217b-08 — LOW — `methods/fcf-yield.js:23`
**Category:** Operator precedence (Cat 1).

**Description:** `stock.marketCap && (typeof stock.marketCap === 'number' ? stock.marketCap : stock.marketCap.value)` — if `stock.marketCap` is the envelope `{value: 0, ...}`, the outer `&&` is truthy (object is truthy), the ternary picks `stock.marketCap.value` (= 0), and `mcap = 0` falls through correctly. If `stock.marketCap` is literally `0` (raw number, unlikely), then `0 && ...` short-circuits to `0` → `mcap = 0` → caught by line 33. So no real defect today, but the pattern is brittle. Same comment for `ev-ebitda.js:10` and `hypergrowth-quality-class.js:57`.

**Mechanism:** None today; latent fragility if schema flips.

**Suggested fix:** Centralize `H.marketCap(stock)` helper that uses the `_unwrap` pattern. Three files would lose ~3 lines each.

---

### F-217b-09 — LOW — `methods/estimate-revision-proxy.js:69`
**Category:** Operator precedence in pass count.

**Description:** `const positive = signals.filter(s => s.pass).length;` is correct. But `signals.push({..., pass: discount < 0.90, value: discount})` (line 56): if `fpe/pe` returns exactly 0.90, `pass: false` correctly. No bug, but threshold uses strict `<` while the method's THRESHOLD_OP is `gte` (different scale — count of positive signals, not the discount ratio itself). The documented "10%+ EPS growth implies discount <= 0.90" should likely be `<=` to include boundary. Trivial impact (no real-world ratio lands at exactly 0.9000).

**Mechanism:** Boundary inclusion off-by-one. Negligible.

**Suggested fix:** `pass: discount <= 0.90` for symmetry with documentation.

---

## 4. Clean files (zero findings)

1. `methods/asset-growth-divergence.js` — correct envelope-or-scalar `toNum` helper, proper `cagr2y` guards.
2. `methods/buyback-yield.js` — defensive `_unwrap`, multi-source fallback, all denominator guards present.
3. `methods/closed-end-trust-guard.js` — well-documented signal aggregation, anchor-tested.
4. `methods/deceleration-guard.js` — correct positional preservation via `_rawVals` + finiteness checks.
5. `methods/fcf-stability.js` — `_unwrap` everywhere, `mean === 0` degenerate-denominator guard.
6. `methods/forecast-contamination-guard.js` — positional alignment preserved, `q4Sum <= 0` guard.
7. `methods/forward-pe.js` — minimal surface, all guards correct.
8. `methods/gross-margin-acceleration.js` — `_unwrap`, fallback chain quarterly → annual, all guards present.
9. `methods/insider-buy-cluster.js` — minimal, defensive on missing `insiderActivity`.
10. `methods/insider-net-buying.js` — multi-source extraction, fall-back flagged.
11. `methods/insider-ownership.js` — minimal, correct guard.
12. `methods/listing-age.js` — clean, with IPO cross-check for data-quality flagging.
13. `methods/loss-magnitude-guard.js` — `_unwrap`, `rev0 <= 0` explicit fail with documented rationale.
14. `methods/margin-quality.js` — comprehensive guards, positional alignment preserved.
15. `methods/metric-divergence-guard.js` — `_unwrap`, denominator guards, unit consistency verified against snapshot.
16. `methods/net-income-volatility-guard.js` — `_unwrap`, breaks at first null to preserve year alignment, `<=` matches `lte` operator (Tag 206c fix already applied).
17. `methods/_helpers.js` (incidentally re-read for context — out of strict scope but no new issues).
18. `methods/capex-trend.js` — F-ME-001 fix already in; only the `revT/revT3` envelope-only pattern (covered under F-217b-04) is residual.

---

## 5. Patterns observed

### Pattern A — Envelope-only unwrap (`arr[i] && arr[i].value`)
Three files (`gross-margin-stability`, `margin-decay`, `capex-trend`) and three "marketCap" call-sites (`ev-ebitda`, `fcf-yield`, `hypergrowth-quality-class`) use this brittle pattern instead of the codebase-standard `_unwrap` helper. Centralizing into `H.unwrap()` / `H.marketCap()` would eliminate ~12 lines and ~3 latent-bug surfaces.

### Pattern B — NaN propagation in price methods
The three price-history-based methods (`drawdown-52w`, `high-proximity-52w`, `above-200d-ma`) all derive a ratio with a denominator (`high52w`, `ma200`) that they never explicitly guard against zero. The result is silent `Infinity`/`NaN` that survives the `pass` comparison and is then nulled out only by `H.buildResult`, leaving `pass:true, value:null`. A shared `_safeDivPass(num, den, threshold, op)` helper would close this class entirely.

### Pattern C — Position-vs-filter mixing
`earnings-stability.js` filters non-finite entries out then uses positional pair-comparisons as if they were calendar-year-aligned. The codebase has solved this elsewhere (`deceleration-guard.js`, `margin-quality.js`, `hypergrowth-quality-class.js`) by keeping the raw positional array and skipping non-finite pairs in-place. The pattern is well-known; `earnings-stability.js` predates the convention.

---

## End of report
