# Tag 221b — Cross-Method Consistency Audit

**Date:** 2026-05-17
**Scope:** All 73 registered methods × 10 anchor stocks (NVDA / MSFT / PLTR / META / COST / GOOG / AVGO / MELI / V / CRDO).
**Mode:** Read-only. No code changes, no method edits.
**Harness:** `methods/runner.js → Runner.evaluateStockExtended()` on `snapshots/<TICKER>.json`.

---

## 1. Executive summary

| Bucket | Count |
|---|---|
| Methods registered (loaded by runner) | **73** |
| Anchors disqualified by any DATAGUARD | **1 / 10** (MELI, by sloan-ratio) |
| Hard contradictions found | **2** |
| Strong redundancy pairs (>= 8/10 agreement on computable subset) | **4** |
| DIAGNOSTIC methods passed by all 10 anchors (CORE-promotion candidates) | **5** |
| Fraud/distress DIAGNOSTICs unsafe to promote to DATAGUARD | **3** (beneish-m, piotroski, rd-cut-guard) |
| Threshold misalignments vs. cited academic source | **3** |
| Tight thresholds rejecting >= 5 anchors (false-negative risk) | **5** |
| Loose thresholds where >= 8 anchors pass with thin margin | **2** |

**Top 3 actionable items (see §5):**

1. **MELI disqualified by sloan-ratio because of negative accruals** — `op='lte_abs'` treats FCF >> NI (conservative accounting) the same as NI >> FCF (manipulation). `fcf-conversion-stability` cleanly passes MELI (geomean = 2.0x). Recommend splitting Sloan into `accrual-manipulation-guard` (positive-side, hard-fail) + a documented diagnostic for negative-Sloan outliers.
2. **`piotroski-f-score` is CORE in SCORE_WEIGHTS[TURNAROUND] but fails 7/10 anchors at threshold 6** — including MSFT, META, GOOG, COST, V. Threshold should be 5/8 (Piotroski's original "improvers" cut, scaled to 8-signal variant) or the method should be moved out of TURNAROUND core weight.
3. **`earnings-stability` fails PLTR + CRDO** because of the "≥4 positive years required" rule applied to a 4-year history (impossible if any year is non-positive). Same horizon-mismatch pattern the Tag 217g comment partially fixes. Need a scaled-threshold mirror of Tag 184's Piotroski fix: `scaled = round(4 * windowLen / 5)`.

---

## 2. Anchor pass/fail matrix (condensed)

Format per row: **method_id  TYPE  WTS  P/F/NC** (P=Pass, F=Fail, NC=Not-Computable, WTS = `*` means in SCORE_WEIGHTS).

**All 10 anchors PASS (24 methods):**

```
profitability-state              CORE     *   10/0/0
profitability-trend              CORE     *   10/0/0
altman-z-score                   CORE     *   10/0/0
q-spike-dataguard                DATAGUARD    10/0/0
revenue-shock-guard              DATAGUARD    10/0/0
revenue-volatility-guard         DATAGUARD    10/0/0
deceleration-guard               DATAGUARD    10/0/0
forecast-contamination-guard     DATAGUARD    10/0/0
quarter-concentration-guard      DATAGUARD    10/0/0
loss-magnitude-guard             DATAGUARD    10/0/0
metric-divergence-guard          DATAGUARD    10/0/0
net-income-volatility-guard      DATAGUARD    10/0/0
pre-commerciality-megacap-guard  DATAGUARD    10/0/0
closed-end-trust-guard           DATAGUARD    10/0/0
r40-sanity-cap                   DATAGUARD    10/0/0
working-capital-anomaly          DIAGNOSTIC   10/0/0
margin-decay                     DIAGNOSTIC   10/0/0
quarterly-earnings-stability     DIAGNOSTIC   10/0/0
listing-age                      DIAGNOSTIC   10/0/0
gross-profitability              DIAGNOSTIC   10/0/0   ← Novy-Marx, perfectly clean signal
```

**9/10 anchors PASS (10 methods):**
`gross-margin-stability` (CORE-WT), `asset-growth-divergence`, `estimate-revision-proxy` (CORE-WT), `roic` (CORE), `sloan-ratio` (DG — MELI fail), `sbc-growth-ratio`, `operating-cashflow-coverage`, `drawdown-52w`, `sector-relative-roic`, `ohlson-o-score`, `fcf-conversion-stability`, `working-capital-trend`.

**Anchor-Fail HOTSPOTS (≥ 5/10 fail):**

| method | type | wts | fails | note |
|---|---|---|---|---|
| above-200d-ma | DIAGNOSTIC | * | 0/0/10 NC | snapshots lack 200d MA — silent zero contribution to QC weight 0.05 (Bug #21 reopens) |
| insider-buy-cluster | DIAGNOSTIC | | 0/10/0 | None of the anchors have ≥2 insider buyers in 90d — threshold too tight for mature mega-caps |
| insider-net-buying | DIAGNOSTIC | | 1/9/0 | Same story, expected for old mega-caps |
| price-momentum-12-1 | DIAGNOSTIC | | 0/0/10 | snapshots lack `priceHistory.daily` |
| revenue-quality-cov | DIAGNOSTIC | | 0/0/10 | needs 8Q timeseries.revenueQ — currently missing on anchor snapshots |
| institutional-ownership-13f | DIAGNOSTIC | | 0/0/10 | 13F cache absent (Tag 213a's documented promotion path) |
| single-quarter-dependency | DIAGNOSTIC | | 0/0/10 | needs `timeseries.revenueQ` |
| analyst-revision-breadth | DIAGNOSTIC | | 7/3/0 | computable on real data ✓ but threshold "≥3 net up-revisions" rejects AVGO, MELI, CRDO |
| premium-compounder-proof | CORE | * | 1/9/0 | only AVGO passes 6-of-6 — by design QC's elite gate |
| fcf-yield | CORE | * | 2/8/0 | sector-relative threshold rejects most premium compounders. By design but worth checking |
| piotroski-f-score | CORE | * | 3/7/0 | threshold=6/8 rejects MSFT/META/GOOG/COST/V — see §3 contradiction list |
| operating-margin-acceleration | DIAGNOSTIC | | 1/9/0 | every anchor's 3y OpM trajectory is FLAT-to-DECEL; only NVDA passes. Tight threshold |
| intangible-adjusted-roic | DIAGNOSTIC | | 3/7/0 | Mauboussin 15% gate; failure pattern: MSFT/META/COST/AVGO/PLTR/CRDO all fail — capitalized R&D bloats IC faster than NI grows |
| revenue-growth-3y | CORE | * | 5/5/0 | 22% threshold — by design rejects mature mega-caps; OK |
| hypergrowth-quality-class | CORE | * | 4/6/0 | by-design HG-tier filter; OK |
| capex-vs-sbc-quality | DIAGNOSTIC | | 5/4/1 | Mauboussin 1.0× gate — fails PLTR/CRDO/MSFT/AVGO (SaaS pattern, by design) |

Full per-anchor fail-counts: NVDA 14, MSFT 20, PLTR 22, META 15, COST 21, GOOG 15, AVGO 22, MELI 17, V 15, CRDO 20.

---

## 3. Findings

### 3.1 Contradictions

| # | Stock | Contradiction | Probable cause | Severity |
|---|---|---|---|---|
| C-1 | **MELI** | `sloan-ratio` HARD-FAIL (val = −20.6%, `CHRONIC_FAIL`) but `fcf-conversion-stability` PASS (FCF/NI geomean = **2.0×**) and `operating-cashflow-coverage` PASS (1.9×). | sloan-ratio uses `op='lte_abs'` so a stock where FCF *exceeds* NI by 20% trips the same hard-fail wire as a fraudulent NI > FCF stock. Sloan's research target was positive accruals (NI > CFO). Negative Sloan = conservative accounting, the *opposite* of manipulation. MELI is being disqualified for the wrong reason. | **HIGH** — MELI is the only DG-disqualified anchor; same pattern will silently kill any clean-cash compounder. |
| C-2 | **PLTR** | `profitability-state` = STABLE (3/3 NI+OI+FCF confirmation) but `earnings-stability` FAIL (`OpInc positive 3/4, need ≥4`). | `earnings-stability` hard-codes "≥4 positive years out of 5"; on a 4-year history it asks for 4/4 even though Tag 184 already established Piotroski's `scaled = round(THR × N / fullN)` pattern. PLTR's 2022 OpInc was negative; legitimate turnaround → now STABLE per Tag 108 v3 logic. | **HIGH** — applies to every recent-IPO compounder (CRDO same pattern). |
| C-3 | PLTR / AVGO / CRDO | `quality-compounder-roic` FAIL while `roic` PASS. | Different numerators by design (OpInc pre-tax vs NetIncome post-tax) and different thresholds (20% vs 15%). NOT a bug — but the two methods being labeled both "ROIC" in UI is confusing. | LOW (documentation only). |

### 3.2 Redundancies

Pair-wise agreement rate across the computable subset (out of 10 anchors):

| Pair A | Pair B | agree / computable | verdict |
|---|---|---|---|
| **altman-z-score** | **ohlson-o-score** | **9/9** | ← high redundancy. Both clean. Ohlson cheaper to demote to deep-dive-only. |
| **fcf-stability** | **fcf-conversion-stability** | 8/9 | high overlap — both 5y FCF-quality. Keep one as primary, the other as confirm. |
| **sloan-ratio** | **fcf-conversion-stability** | 8/9 | overlap. The 1 disagreement is the MELI false-positive (C-1). |
| operating-leverage | operating-leverage-margin-accel | 8/10 | Tag 212a explicitly says "distinct from Tag 196" but anchor data shows them moving together. |
| revenue-growth-3y | quarterly-revenue-acceleration | 9/10 | strong overlap on the growth direction. |
| insider-buy-cluster | insider-net-buying | 9/10 | both score 0-1 / 10 — collapse into one "insider-buying" composite. |
| margin-quality | gross-margin-stability | 6/10 | actually low agreement — keep both. |
| altman-z | beneish-m | 6/10 | low agreement, complementary by design — keep both. |
| estimate-revision-proxy | analyst-revision-breadth | 6/10 | low agreement on computable anchors. Tag 210d's "true breadth" replaces the proxy only when `estimateRevisions` field is persisted, which is now the case on anchor data — review whether `estimate-revision-proxy` should be retired from CORE/SCORE_WEIGHTS. |

### 3.3 Threshold misalignments vs. cited academic source

| Method | Cited threshold | Actual `THRESHOLD` | Inconsistency |
|---|---|---|---|
| **altman-z-score** | Header text: "> 2.6 → SAFE (pass); 1.1–2.6 → GREY (fail); < 1.1 → DISTRESS (fail)" | `1.1` (`gte`) | The pass-condition in code is "not in distress" (`Z″ >= 1.1`), but the header explicitly calls 1.1–2.6 the GREY *fail* zone. Either header is wrong (the gate is just "not distressed") or the threshold should be 2.6 (true "SAFE"). Header rewrite needed; anchors all > 2.1 so the value 2.6 would still pass 9/10 (META @ 2.10 would fail). |
| **beneish-m-score** | Header: "M < −2.22 (conservative cutoff, Beneish 1999 originally −1.78)" | `−2.22` (`lt`) | Code matches header, but at −2.22 the method FAILS NVDA / PLTR / AVGO / CRDO — 4 of 10 mega-cap anchors flagged as "LIKELY_MANIPULATOR" / "CAUTION". The −2.22 cutoff is empirically too tight for high-growth tech where SGI naturally runs > 1.5. Recommend reverting to Beneish's original −1.78. |
| **ohlson-o-score** | Header: "P < 0.5 (Ohlson 1980 original) — Begley 1996 used 0.038 as more conservative" | `0` (`lt`) on the raw O-score | At O = 0 ⇔ P = 0.5; matches header. But anchors range O ∈ [−16.4, −7.0] (probabilities ≈ 10⁻³ to 10⁻⁷). Threshold is **comically loose** — would never fire on a real compounder. If used as a DATAGUARD, threshold needs to move toward Begley 1996's stricter value. |

### 3.4 Overly-tight thresholds (false-negative risk on anchors)

| Method | Threshold | Anchor fail count | Notes |
|---|---|---|---|
| **piotroski-f-score** | ≥ 6 of 8 | **7/10 fail** | MSFT, META, GOOG, COST, V, MELI, NVDA all score 3-5/8. F-Score 6+ is the historical "improver" cut; for mega-cap *steady-state* compounders the relevant cut is 5+ ("financially healthy"). This is a real false-negative on the SCORE_WEIGHTS[TURNAROUND] composite — the method drags TURNAROUND score down for any name that is *already* a quality compounder. |
| **insider-buy-cluster** | ≥ 2 buys in 90d | 10/10 fail | Anchor mega-caps simply don't have insider clusters; method is structurally biased against the universe it's run on. Either restrict to mid-cap audit, or treat null as neutral instead of 0. |
| **operating-margin-acceleration** | > 0 (3-period accel) | 9/10 fail | only NVDA's recent 3y OpM has been monotonically expanding. Mature compounders' OpM is FLAT-by-design (high margin near ceiling) — "> 0" rejects them. |
| **capital-allocation-quality** | ≥ 75 composite | 7/10 fail or NC | composite scoring is overweighting buyback-yield + capex stability; rejects MSFT and META even though both are textbook quality-of-allocation names. Recalibrate component weights. |
| **earnings-stability** | ≥ 4/5 positive | 2/10 fail | PLTR (3/4) + CRDO — see C-2; need scaled threshold for short-history names. |

### 3.5 Overly-loose thresholds (false-positive risk)

| Method | Threshold | Note |
|---|---|---|
| **net-income-volatility-guard** | `\|ΔNI\| / Rev < 1.0` (lte 1.0) | All 10 anchors are at < 0.27, max headroom is 4×. For non-anchor universe (MSTR-like) this is the right gate, but a 1.0 trigger is so loose it never bites unless NI flips swing > revenue. Consider 0.5. |
| **ohlson-o-score** | P < 0.5 (O < 0) | Anchors all O ≤ −7. Threshold leaves a 7-σ moat — useless as a gate. Document as confirm-only diagnostic. |
| **r40-sanity-cap** | 150 | designed as poisoning-floor, but CRDO at R40=217 is *real* hypergrowth, not a poison. Methodology section already addresses, just flagging that the +201 CRDO sample passes the cap. |

---

## 4. Promotion candidates (DIAGNOSTIC → SCORE_WEIGHTS / DATAGUARD)

### 4.1 Candidates for SCORE_WEIGHTS (high-signal, all anchors pass)

| Method | Anchor pass | Why it's a candidate | Where to add weight |
|---|---|---|---|
| **gross-profitability** | **10/10** | Novy-Marx 2013 + 2025 retrospective — single cleanest quality factor in the literature. Distinct numerator (gross profit) from ROIC. | `SCORE_WEIGHTS.QUALITY_COMPOUNDER` (suggest 0.05–0.10 carved from `premium-compounder-proof` or `above-200d-ma`). Tag 209a header already notes "future tag can promote into composite". |
| **margin-decay** | 10/10 | already the anti-pattern signal for QC. | QC weight 0.05. |
| **working-capital-anomaly** | 10/10 | already used as soft-guard penalty in score-aggregator — but never as positive weight. Either keep penalty-only and remove `inWeights` check confusion, or add small positive weight. |
| **listing-age** | 10/10 (val=4 for every anchor) | already feeds QC's listing-age multiplier when `AUDIT_SCORE_MULTIPLIERS=1`. Promotion path is to enable that flag, not weight it directly. |
| **fcf-conversion-stability** | 9/10 (1 NC) | clean 5y geomean signal, complements `sloan-ratio` without `lte_abs` pitfall (see C-1). | Could replace sloan-ratio in RED_FLAG_RULES once Tag 211e gets one more month of validation. |

### 4.2 Candidates for DATAGUARD promotion (fraud/distress hard-gates)

| Method | Promotion safe? | Reason |
|---|---|---|
| **beneish-m-score** | ❌ **NO** | Hard-fails NVDA, PLTR, AVGO, CRDO at the current −2.22 threshold (all "LIKELY_MANIPULATOR" / "CAUTION" zones). Threshold must move to ≤ −1.78 (Beneish original) before promotion. Even then, SGI > 1.5 is unavoidable for hypergrowth — promotion would massacre HG tab. **Stay DIAGNOSTIC.** |
| **ohlson-o-score** | ✅ **YES, but threshold-tuned** | Anchors all O < −7 (huge moat). Could safely hard-fail on O > 0 today (P > 50%). The Tag 210a header already calls this out. |
| **rd-cut-guard** | ❌ NO | Hard-fails PLTR and CRDO — both have legitimate R&D-cut → margin-expansion stories (operating-leverage breakthrough, not real-EM). Tag 210c header explicitly says "DIAGNOSTIC (legit cuts exist — needs human review, not auto-disqualification)" — that's correct, stay diagnostic. |
| **piotroski-f-score** | ❌ already CORE, but as **demotion candidate** from SCORE_WEIGHTS[TURNAROUND] | At threshold 6, fails 7/10 quality anchors. Either lower to 5 (literature-supported "healthy" cut) or drop from TURNAROUND weight (currently 0.15). |
| **net-income-volatility-guard** | ⚠️ already DATAGUARD | clean 10/10, but threshold 1.0 is so loose it rarely bites. Document acceptance band or tighten to 0.5. |

---

## 5. Cleanup recommendations (prioritized)

1. **`sloan-ratio` (HIGH)** — Split into `accrual-manipulation-guard` (positive Sloan > 0.20 only, hard-fail) + leave the existing module as diagnostic-only with note that negative Sloan = conservative accounting. Restores MELI and any future conservative-accruals compounder.
2. **`earnings-stability` (HIGH)** — Apply Tag 184 / 217g scaled-threshold pattern: `scaledThreshold = round(4 * windowLen / 5)`. Currently fails PLTR / CRDO on a horizon-mismatch artifact.
3. **`piotroski-f-score` SCORE_WEIGHTS demotion (HIGH)** — Either lower threshold to 5 or remove from `SCORE_WEIGHTS.TURNAROUND` weight 0.15. Method is silently dragging TURNAROUND scores for any name already past the turnaround.
4. **`altman-z-score` header rewrite (MEDIUM)** — Header text describes 1.1-2.6 as fail GREY zone, code has THRESHOLD=1.1 as pass. Either fix header to match code (the gate is "not distressed") or move threshold to 2.6 (true "SAFE"). META at Z=2.10 is the only anchor that flips.
5. **`beneish-m-score` threshold (MEDIUM)** — Revert from −2.22 to Beneish's original −1.78. Currently flags NVDA / PLTR / AVGO / CRDO as manipulators on growth-driven SGI alone.
6. **`ohlson-o-score` (LOW)** — Promote to DATAGUARD with current threshold O > 0 (Bug-Hunt agent already documented promotion path in REGISTRY entry). Anchor moat is enormous; safe.
7. **`gross-profitability` (LOW)** — Promote into `SCORE_WEIGHTS.QUALITY_COMPOUNDER` at weight 0.05. Cleanest quality factor in the universe, perfect anchor agreement.
8. **Retire `estimate-revision-proxy` (LOW)** — Now that `analyst-revision-breadth` is computable on real data (Tag 210d), the proxy CORE-weight in `SCORE_WEIGHTS.TURNAROUND` (0.05) is the inferior signal. Move weight to the breadth method.
9. **`above-200d-ma` NC=10/10 (MEDIUM)** — Bug #21 reopens — method weighted at 0.05 in QC but anchors return NC. Either pull `priceHistory.movingAverages.ma200` consistently or remove the weight.
10. **`insider-buy-cluster` (LOW)** — Method passes 0/10 anchors. Treat null as neutral (`computable=false`) instead of 0 — currently a structural bias against mega-cap universe.

---

### Appendix: harness used

`_tag221b_audit.js` + `_tag221b_analyze.js` — read 10 snapshots, run `Runner.evaluateStockExtended`, cross-tab pass/fail per method, emit summary. Both helpers are temporary and deleted after this audit (read-only, no side effects on the codebase).
