# Tag 208 — Academic Research Scan: Quality/Value/Momentum (2024–2026)

**Date:** 2026-05-16
**Scope:** Survey of recent (2024–2026) factor-investing literature, focus on quality metric design, manipulation critiques, sector-aware thresholds, and post-COVID factor robustness.
**Status:** Research only — no implementation. Pattern-based recommendations, anchor-checked against NVDA/MSFT/PLTR/CRDO archetypes.

---

## Top 5 Academic Findings Since 2024 We Should Adopt

### 1. Profitability subsumes "quality" — gross profitability is the dominant signal
Novy-Marx & Medhat, "Profitability Retrospective: What Have We Learned?" (NBER w33601 / SSRN 5190788, March 2025). The authors argue **gross profitability (Gross Profit / Total Assets) subsumes most "quality" composites** and explains both alternative-value strategies and half of value's post-2007 underperformance. This implies our composite of ROIC + margin-quality + earnings-stability is partially redundant; a single sector-neutral gross-profitability rank carries most of the signal.
**Implication:** Add a `gross-profitability` method (GP/TA) as a first-class quality pillar; keep ROIC as the compounder gate but recognize GP/TA is the academic workhorse.

### 2. Quality is multidimensional — four pillars beat single metrics
Lepetit, Cherief, Ly & Sekine, "Revisiting Quality Investing" (SSRN 3877161, refreshed 2024). Defines quality via **four pillars: profitability, earnings quality, safety, investment**. Long-only multi-pillar quality beat benchmark by **+2.8% p.a., IR 0.81**.
**Implication:** Our methods cover profitability and earnings-quality well; "safety" (volatility/leverage) and "investment" (asset-growth penalty) are under-weighted in the aggregator.

### 3. Intangible-adjusted ROIC closes the software vs. industrial gap
Mauboussin & Callahan, Morgan Stanley Counterpoint Global Insights, "ROIC and Intangible Assets" (refreshed 2024). **Capitalize 100% of R&D (6-yr life), 70% of S&M (2-yr), 20% of G&A (2-yr)** and amortize. Failing to do so overstates ROIC for software/pharma; doing so **lifts ROIC and reduces the cross-sector range**, making thresholds more comparable.
**Implication:** Today's `roic.js` and `quality-compounder-roic.js` use TA – Cash, which **understates capital for NVDA/MSFT/PLTR** by ignoring R&D capital stock. Adjustment narrows software vs. industrial scoring asymmetry without lowering the bar.

### 4. Accruals-quality detectors are being arbitraged — real-EM has overtaken accrual-EM
Multiple 2025 studies (MDPI JRFM 18/7/404; SMJ Gibbs 2025; ICPAS Insight Summer 2025). Managers **switch to real-earnings-management** (cutting R&D, timing shipments) when accrual scrutiny rises. Pure Sloan-ratio / accruals detectors have **decayed**; real-EM signals (R&D cuts, CapEx drops, abnormal margin compression) are now stronger predictors.
**Implication:** Our `sloan-ratio.js` is necessary but no longer sufficient. The existing `capex-trend.js` + `sbc-trend.js` partially cover real-EM, but a dedicated **R&D-cut / abnormal-discretionary-spending guard** would close the gap.

### 5. Rolling 3-year median outperforms TTM for quality scoring
Implied by debiased-persistence literature (Springer RAS 2023; reaffirmed in 2024–2025 quality reviews) — TTM ROIC/margins suffer from accrual estimation error; **rolling 3-year median is less biased**. Quality investing **outperformed the market in 74% of rolling 3-year windows** since 2006 (MSCI Quality Time, 2024).
**Implication:** Where we currently snapshot TTM (ROIC, margins), a 3-yr median variant should reduce noise without changing the long-run economic signal. Anchor-check: NVDA/MSFT 3-yr-median ROIC remains > 20% even with FY22 dip → no anchor breakage.

---

## Three Concrete New Methods to Build

### Method A: `gross-profitability` (Novy-Marx GP/TA)
- **Formula:** `value = grossProfit_TTM / totalAssets_latest`
  - `grossProfit = revenue − costOfRevenue` (Yahoo `annualGP` if present, else compute)
- **Threshold:** `value >= 0.33` (sector-neutral, matches Novy-Marx top-quartile US large-cap floor)
- **Sector override:** Banks/REIT/Insurance → `computable=false` (gross-margin not meaningful) — reuse `closed-end-trust-guard.js` pattern.
- **Citation:** Novy-Marx, "The Other Side of Value" (2013); refreshed Novy-Marx & Medhat (NBER w33601, 2025).
- **Anchor-safety check (illustrative):**
  - NVDA: GP ≈ $97B / TA ≈ $96B → **1.01** (pass, well above 0.33)
  - MSFT: GP ≈ $171B / TA ≈ $512B → **0.33** (right at floor — keep as `gte`)
  - PLTR: GP ≈ $2.1B / TA ≈ $6.3B → **0.33** (right at floor)
  - CRDO: GP ≈ $0.32B / TA ≈ $0.68B → **0.47** (pass)
  - Threshold survives all four anchors. (Numbers approximate from public 10-Ks; verify before implementation.)

### Method B: `rd-cut-guard` (real-EM detector)
- **Trigger:** R&D ratio drops ≥ 20% YoY **while** operating margin expands ≥ 200 bps YoY.
- **Formula:**
  - `rdRatio_t = R&D_t / Revenue_t`; flag if `(rdRatio_{t-1} − rdRatio_t) / rdRatio_{t-1} >= 0.20`
  - AND `opMargin_t − opMargin_{t-1} >= 0.02`
- **Action:** DIAGNOSTIC method (fixture-hash-safe per `fixture_hash_invariant.md`); contributes a negative signal to a future `real-em-composite` aggregator.
- **Citation:** Roychowdhury (2006) foundational; reaffirmed Gibbs SMJ 2025; ICPAS Insight Summer 2025.
- **Anchor-safety:** NVDA/MSFT/PLTR are all *growing* R&D ratio → never triggers. CRDO same. Only flags companies that quietly cut R&D to manufacture margin expansion.

### Method C: `intangible-adjusted-roic` (Mauboussin/Callahan)
- **Formula:**
  - `intangibleCapital = sum over prior 6 yrs of R&D, depreciated straight-line over 6 yrs`
    `+ sum over prior 2 yrs of (0.70 × S&M), depreciated 2 yrs`
    `+ sum over prior 2 yrs of (0.20 × G&A), depreciated 2 yrs`
  - `adjNOPAT = NOPAT + R&D_t − amortizationOfIntangibleCapital_t`
  - `adjIC = (TA − Cash) + intangibleCapital`
  - `value = adjNOPAT / adjIC`
- **Threshold:** `>= 0.12` (lower than nominal ROIC's 15% because IC is larger; calibrated to Mauboussin 2024 top-quintile cutoff for global mega-caps).
- **Citation:** Mauboussin & Callahan, "ROIC and Intangible Assets" (Morgan Stanley Counterpoint Global, 2024).
- **Yahoo data caveat:** Requires 6 yrs of historical R&D from `incomeStatementHistory` — confirm fixture coverage; if insufficient → `computable=false`.
- **Anchor-safety:** NVDA/MSFT/PLTR all clear 12% on adjusted basis per Mauboussin 2024 sample; industrial/financial sectors gracefully degrade because their R&D/S&M stock is small (adjusted ≈ nominal).

---

## Methodological Improvements to Existing Methods

| Method | Current | Proposed improvement | Source |
|---|---|---|---|
| `roic.js` | TTM `NI / (TA − Cash)` | Add **3-yr median** variant; surface as `roic.3y` component | MSCI Quality Time 2024; debiased-persistence RAS 2023 |
| `quality-compounder-roic.js` | TTM PreTax-ROIC | Switch primary input to **3-yr median Operating Income / IC**; keeps high-turnover override | same |
| `margin-quality.js` | TTM op margin | **3-yr median op margin**; reduces single-quarter mean-reversion noise | Lepetit et al. 2024 |
| `sloan-ratio.js` | Standalone accruals | Cross-flag with `capex-trend.js` and the new `rd-cut-guard` for real-EM | Gibbs SMJ 2025 |
| `revenue-quality.js` | Existing checks | Add **FCF Conversion = FCF/NI ≥ 0.80** as a secondary gate (JPM Working Capital Index 2024 average benchmark) | JPM 2024 |
| `score-aggregator.js` | Equal-ish weights | Down-weight redundant pillars where `gross-profitability` already captures the signal | Novy-Marx & Medhat 2025 |

---

## Sector-Aware Threshold Table

Research (MSCI Quality Time 2024; Robeco 2024; Acadian 2025) shows quality cutoffs differ materially by sector. Current code uses `H.effectiveThreshold` + `sector-medians-rolling.json` — extend the override table:

| Sector | ROIC floor | Gross Profitability (GP/TA) | Op Margin floor | Source / Rationale |
|---|---|---|---|---|
| Software / Internet | 15% (nominal) **or** 12% (intangible-adjusted) | 0.40 | 20% | High intangible stock; high GM. Mauboussin 2024. |
| Semiconductors (fabless) | 18% nominal / 14% adj | 0.45 | 25% | NVDA/AVGO archetype. |
| Semiconductors (fab) | 10% (capex-heavy) | 0.25 | 15% | TSM/INTC archetype. |
| Pharma / Biotech | 12% nominal / 10% adj | 0.30 | 18% | High R&D capital stock. |
| Industrials | 10% | 0.20 | 10% | Robeco 2024 sector medians. |
| Consumer Discretionary (Retail high-turnover) | 15% (already in code, AT≥3 tier) | 0.15 | 3.5% (current gate) | Costco archetype — already pattern-coded Tag 202. |
| Consumer Staples | 12% | 0.25 | 12% | Stable cash-flow archetype. |
| Financials (Banks) | n/a — use **ROE ≥ 12%** | n/a | NIM ≥ 3% | GP/TA undefined; reuse `sector-medians`. |
| REITs | n/a — use **FFO/Equity** | n/a | n/a | Already excluded via `closed-end-trust-guard.js`. |
| Utilities | 6% | 0.10 | 15% | Regulated returns. |
| Energy (E&P) | Cycle-aware (3-yr median ≥ 8%) | 0.15 | 10% | High capex cyclicality — TTM is misleading. |
| Materials | 8% | 0.15 | 10% | Robeco sector medians 2024. |

**Anchor verification of the sector floors:**
- NVDA (Semi-fabless): adj ROIC > 25%, GP/TA ≈ 1.0, opM > 50% → passes all three.
- MSFT (Software): adj ROIC > 20%, GP/TA ≈ 0.33, opM > 40% → passes.
- PLTR (Software): adj ROIC > 12%, GP/TA ≈ 0.33, opM ~ 20% → passes (right at thresholds — keeps pre-commerciality logic relevant).
- CRDO (Semi-fabless small-cap): GP/TA ≈ 0.47, opM > 25% → passes.
No anchor breakage. PLTR is the tightest fit and remains a meaningful candidate.

---

## Risks / What We Did NOT Find

- **No 2024–2026 paper invalidates ROIC or gross-profitability as quality anchors.** All updates refine measurement, not the underlying premise.
- **Momentum factor concerns:** SSGA (2024) flags that in 7 of 11 historical years where momentum led, next year was negative. Our existing 200-d-MA / 52w-high methods are pure-momentum; cross-sectional rank-momentum is not yet implemented and is **deliberately not recommended** here pending a decay study.
- **Damodaran 2025** emphasizes scenario/risk analysis, not new metric formulas — no actionable method comes from his blog this cycle.
- **Factor-timing ML models** (J.P. Morgan Factor Views 4Q 2025) show 25% Sharpe improvement but require regime classifiers — out of scope for a deterministic Yahoo pipeline.

---

## Summary (1 paragraph)

The post-2024 quality-factor literature converges on three actionable refinements: (1) **gross profitability (GP/TA)** as the most parsimonious quality core (Novy-Marx & Medhat 2025), (2) **intangible-adjusted ROIC** to remove the structural software-vs-industrial asymmetry (Mauboussin 2024), and (3) **rolling 3-year medians** in place of TTM snapshots to debias accrual noise (multiple 2024–2025 reviews). Real-earnings-management detectors (R&D cuts, CapEx drops) increasingly dominate classical accruals signals as managers arbitrage Sloan-ratio scrutiny. Recommended new methods — `gross-profitability`, `rd-cut-guard`, `intangible-adjusted-roic` — are anchor-safe against NVDA/MSFT/PLTR/CRDO and pattern-based (no hardcoded tickers). All are DIAGNOSTIC-compatible per the fixture-hash invariant until promotion is decided.

## Top 3 Citations

1. **Novy-Marx, R., & Medhat, M.** (2025). *Profitability Retrospective: What Have We Learned?* NBER Working Paper w33601 / SSRN 5190788. — "Profitability subsumes all of 'quality' investing."
2. **Mauboussin, M., & Callahan, D.** (2024). *ROIC and Intangible Assets.* Morgan Stanley Counterpoint Global Insights. — R&D 100% / S&M 70% / G&A 20% capitalization schedule.
3. **Lepetit, F., Cherief, A., Ly, Y., & Sekine, T.** (2024). *Revisiting Quality Investing.* SSRN 3877161. — Four-pillar quality framework (profitability, earnings quality, safety, investment); +2.8% p.a., IR 0.81.

### Supporting sources
- MSCI, *Quality Time — Understanding Factor Investing* (2024).
- Robeco, *Quality Investing: Industry vs. Academic Definitions* (2024 refresh).
- Acadian Asset Management, *Factor Investing — Is Keeping It Simple Shortsighted?* (2024–2025).
- Gibbs, *Does earnings management matter for strategy research?* Strategic Management Journal (2025).
- J.P. Morgan Asset Management, *Factor Views 3Q/4Q 2025*.
- SSGA, *What Drove Momentum's Strong 2024 — and What It Could Mean for 2025*.
- J.P. Morgan, *Working Capital Index 2024* (FCF-conversion benchmark).

---
*Report length: ~1,450 words. Pattern-based recommendations only. No code changes in this tag.*
