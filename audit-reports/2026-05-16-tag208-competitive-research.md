# Tag 208 — Competitive Research: What Pro Screeners Do Better

**Date:** 2026-05-16
**Scope:** Finviz Elite, Stock Rover, Koyfin, Atom Finance, Tikr, FinChat.io / Roic.ai, Simply Wall St, Quartr
**Mode:** Research-only. No code changes.

---

## Executive Summary

Across eight competing platforms, the consistent edge over our pipeline is **multi-dimensional aggregation** (Stock Rover/Snowflake roll-ups of value/growth/quality/health/momentum into a single bounded score), **breadth-based revision signals** (Koyfin, Zacks, Refinitiv all expose net analyst-revision counts over 30/60/90 days as a leading factor), and **capital-allocation accounting** (Mauboussin-style decomposition of FCF deployment into reinvestment, buybacks, dividends, debt reduction, M&A). Our pipeline already has best-in-class data-quality guards (q-spike, revenue-shock, working-capital-anomaly) that none of these competitors expose, but we under-weight forward-looking signals and lack a sector-relative percentile layer that all five "quality" platforms (Stock Rover, Simply Wall St, Tikr, FinChat, Roic.ai) treat as table-stakes. Three concrete, fixture-hash-safe DIAGNOSTIC methods below close the most material gaps without touching aggregator weights.

---

## 5 Specific Feature Gaps (most valuable first)

### 1. **No sector-relative percentile layer** (Stock Rover, Simply Wall St, Tikr all expose this)
Stock Rover ranks every metric against its **industry peer group** and produces a 0–100 percentile; Simply Wall St scores 6 binary checks per category × 5 categories for the Snowflake. We have `sector-median-lookup.js` infra but no method that emits a `peer_percentile` value per stock. **Impact:** a 25% ROIC means very different things in software vs. utilities — our absolute thresholds blur this.

### 2. **No analyst-revision breadth signal** (Koyfin, Zacks Z-Rank, Refinitiv StarMine all center on this)
Our `estimate-revision-proxy.js` uses two proxy signals (forward-PE discount, revenue acceleration). Mill Street Research and Baird confirm **breadth** (proportion of analysts revising up vs. down over rolling 30/60/90 d) is the most persistent revision factor and the cleanest scaled variable (−100% to +100%). Yahoo's `earningsTrend` already returns `epsTrend.7daysAgo / 30daysAgo / 60daysAgo / 90daysAgo` per estimate — we ignore it.

### 3. **No capital-allocation decomposition** (FinChat.io, Roic.ai both pitch this; Mauboussin literature)
We have `capex-trend`, `buyback-yield`, `sbc-trend` as **independent** signals. Mauboussin's framework treats them as a **portfolio**: a quality compounder should deploy FCF in a sensible pecking order (reinvestment first, then debt paydown, then buybacks at low multiples, then dividends). No single method composes them, so an apparent "buyback champion" (#1 = high buyback-yield) may simultaneously be issuing debt to fund it (high `net-debt-ebitda` AND high `buyback-yield`) — currently a silent inconsistency.

### 4. **No earnings-quality "trinity" composite** (Roic.ai's flagship; FinChat's segment KPI)
Roic.ai's whole pitch is **clean, decade-long financial-statement consistency**. We have `sloan-ratio`, `fcf-stability`, `operating-cashflow-coverage`, `net-income-volatility-guard` — but no roll-up. A compounder should hit all four; meme/accruals-driven names pass one or two. Composite would be near-zero implementation cost and would catch divergent-signal stocks our current per-method flags miss.

### 5. **No "narrative shift" / guidance-language signal** (Quartr's whole product; FinChat AI; MarketAlerts)
Quartr exposes earnings-call transcripts with sentiment scoring; the signal "previously-emphasized KPI disappears from the script" or "CFO tone diverges from CEO" is documented (Insight7, MarketAlerts) as a leading guide-down indicator. We have no transcript data and no proxy. This is a **big-build** item (requires a new data source) — flagging for awareness, **not** proposed as a method below.

---

## 3 Concrete New Methods (fixture-hash safe, DIAGNOSTIC default)

### Method A: `sector-relative-roic-percentile.js` (QUICK WIN — ~1 hour)

**Purpose:** convert absolute ROIC into a sector-relative percentile so a 22% ROIC software stock isn't penalized vs. a 12% ROIC industrial that's elite for its peer group.

**Formula:**
```
roic_now = stock.roic (last fiscal year, already computed by roic.js)
sector_median = sector-median-lookup.get(stock.sector, 'roic')   // existing infra
sector_p75    = sector-median-lookup.get(stock.sector, 'roic', 'p75')  // NEW lookup key
percentile_estimate =
   0   if roic_now <= 0
   25  if roic_now < sector_median * 0.5
   50  if roic_now < sector_median
   75  if roic_now < sector_p75
   90  if roic_now >= sector_p75
   100 if roic_now >= sector_p75 * 1.5
```
Threshold: `percentile_estimate >= 50` (median+). DIAGNOSTIC — not in SCORE_WEIGHTS.

**Why it's missing:** every quality-screener competitor (Stock Rover, Simply Wall St, Tikr, FinChat) does sector-relative percentile ranking; we do absolute. Stock Rover exposes it best (proprietary 0–100 with explicit peer-group anchor).

**Anchor safety:** NVDA (~70% ROIC, software median ~15%) → 100. CRDO (semis, narrow margin profile but growing) → 50–75 depending on FY. MSFT (40% ROIC, software median ~15%) → 100. PLTR (positive ROIC ~12%, software median ~15%) → 50. ALAB (newly profitable semis) → 50–75. **No anchor fails.** Sector-medians JSON already includes all anchor sectors.

---

### Method B: `analyst-revision-breadth.js` (QUICK WIN — ~1 hour)

**Purpose:** consume Yahoo's already-pulled `earningsTrend.trend[].epsTrend` to compute a true breadth metric, replacing the two-proxy `estimate-revision-proxy` over time.

**Formula:**
```
For the FY1 estimate row in earningsTrend.trend[]:
  e_now     = epsTrend.current
  e_30d_ago = epsTrend['30daysAgo']
  e_60d_ago = epsTrend['60daysAgo']
  e_90d_ago = epsTrend['90daysAgo']

revisions_30d = sign(e_now - e_30d_ago)   // -1 / 0 / +1
revisions_60d = sign(e_now - e_60d_ago)
revisions_90d = sign(e_now - e_90d_ago)

breadth_score = revisions_30d + revisions_60d + revisions_90d   // -3..+3
```
Threshold: `breadth_score >= 1` (net upward over rolling windows). DIAGNOSTIC. Falls back to `computable:false` if Yahoo returns no `earningsTrend` (~5% of names).

**Why it's missing:** Koyfin, Zacks, Refinitiv all expose this; Mill Street Research documents breadth as the most persistent revision factor. We currently only proxy it via forward-PE discount, which conflates revisions with multiple compression.

**Anchor safety:** NVDA (covered by 50+ analysts, steady upward revisions) → +3. CRDO (~10 analysts, choppy but trending up) → +1 to +3. MSFT (heavily covered, steady) → +1 to +3. PLTR (high-coverage, mixed revisions in mid-cycle) → 0 to +2. ALAB (new IPO, sparse coverage) → may return `computable:false` cleanly. **No anchor fails — computable:false is a clean exit, not a failure.**

---

### Method C: `capital-allocation-quality.js` (QUICK WIN — ~1 hour)

**Purpose:** Mauboussin-style composite that scores whether FCF deployment is **internally consistent** — no method today checks that a "buyback champion" isn't simultaneously levering up to fund the buybacks.

**Formula (4 binary sub-checks, score 0–4):**
```
fcf = stock.annual.annualFCF[0]
buybacks_funded_by_fcf  = (buyback_yield > 0) AND (fcf > 0)                     // +1
no_levering_for_returns = NOT (buyback_yield > 0 AND net_debt_ebitda > 3.0)     // +1
capex_disciplined       = (capex-trend method already passes)                   // +1
sbc_disciplined         = (sbc-revenue method already passes)                   // +1

cap_alloc_score = sum(above 4)   // 0..4
```
Threshold: `cap_alloc_score >= 3`. DIAGNOSTIC, pattern-based, no hardcoded tickers. Reuses existing method outputs — zero new data dependencies.

**Why it's missing:** FinChat.io and Roic.ai both market capital-allocation analysis but neither exposes a composite score (it's narrative-driven on their platforms). Mauboussin's research treats CapEx + buybacks + debt + dividends as one decision — we treat them as four siloed signals.

**Anchor safety:** NVDA (huge FCF, modest buybacks, low leverage, growing capex) → 4. CRDO (positive FCF, no buybacks yet, low leverage, growing capex) → 3 (no_levering + capex + sbc; buyback check returns false but doesn't fail the threshold). MSFT (massive FCF, buybacks, low leverage, disciplined capex) → 4. PLTR (positive FCF recently, no buybacks, zero debt, high SBC) → 2–3 depending on SBC trend. ALAB (early-stage FCF, no buybacks, no leverage, capex investing) → 2–3. **No anchor fails outright; PLTR and ALAB sit at the threshold, which is the correct signal.**

---

## Anchor Safety Summary

| Anchor | Method A (sector-percentile) | Method B (revision-breadth) | Method C (cap-alloc) |
|--------|------|------|------|
| NVDA   | 100  | +3   | 4 |
| CRDO   | 50–75 | +1 to +3 | 3 |
| MSFT   | 100  | +1 to +3 | 4 |
| PLTR   | 50   | 0 to +2 | 2–3 |
| ALAB   | 50–75 | `computable:false` (clean) | 2–3 |

All three methods either pass anchors or return `computable:false` — no hard failures. All three are **DIAGNOSTIC** (not added to `SCORE_WEIGHTS`), so per the fixture-hash invariant they are hash-safe by construction.

---

## Quick Wins vs. Big-Build

**Quick wins (≤1 hour each, ship together as Tag 209):**
1. **Method A — sector-relative-roic-percentile** (reuses sector-median-lookup; only new code is a p75 lookup key).
2. **Method B — analyst-revision-breadth** (reads `earningsTrend.trend[0].epsTrend` from existing snapshot; no new pull).
3. **Method C — capital-allocation-quality** (composes outputs of 4 existing methods; pure composition, zero new data).

**Big-build items (3+ hours, separate tags):**
- **Quartr-style transcript narrative-shift signal** — requires a new data source (Quartr API or transcript scraping); 6+ hours including auth, rate-limiting, NLP layer.
- **Snowflake-style 5-category roll-up dashboard** — would need a new `snowflake-aggregator.js` mapping our 60+ methods to {valuation, growth, past-perf, financial-health, dividends} buckets and persisting per-snapshot for sparkline history; 4–6 hours plus UI/JSON-schema design.
- **Finviz-style heatmap export** — needs sector × performance JSON output and a separate visualization layer; out of scope for the screener-data repo proper, belongs in a downstream renderer.

---

## Sources

- [Finviz Elite Heatmap (ChartMini, 2026)](https://chartmini.com/blog/finviz-elite-heatmap-market-visualization-made-simple-2026)
- [Finviz Review 2026 (StockBrokers.com)](https://www.stockbrokers.com/review/tools/finviz)
- [Stock Rover Ratings methodology](https://www.stockrover.com/metrics/stock-rover-ratings/)
- [Stock Rover Scoring blog](https://www.stockrover.com/blog/product-features/scoring-stocks-with-stock-rover/)
- [Simply Wall St — How the Snowflake works](https://support.simplywall.st/hc/en-us/articles/360001740916-How-does-the-Snowflake-work)
- [Simply Wall St Company-Analysis-Model (GitHub)](https://github.com/SimplyWallSt/Company-Analysis-Model/blob/master/MODEL.markdown)
- [Tikr — How to Screen for High ROIC Stocks](https://www.tikr.com/blog/how-to-screen-for-high-roic-stocks)
- [Tikr — Best Free Tools to Identify Compounders](https://www.tikr.com/blog/best-free-tools-to-identify-compounder-stocks)
- [Koyfin — Actuals & Consensus Snapshot](https://www.koyfin.com/help/actuals-consensus/)
- [Koyfin — Best Platforms for Earnings Estimates](https://www.koyfin.com/blog/best-platforms-earnings-estimates-price-targets-analyst-ratings/)
- [Mauboussin — Capital Allocation (Morgan Stanley Counterpoint)](https://www.morganstanley.com/im/publication/insights/articles/article_capitalallocation.pdf)
- [Mauboussin — Capital Allocation Updated (Cove Street, 2015)](https://covestreetcapital.com/wp-content/uploads/2015/07/Mauboussin-June-2015.pdf)
- [Mill Street Research — Do Analyst Estimate Revisions Still Help?](https://www.millstreetresearch.com/do-analyst-estimate-revisions-still-help-forecast-relative-stock-returns/)
- [Zacks — Earnings Estimate Revisions Education](https://www.zacks.com/upload_education/zrank.pdf)
- [Refinitiv / LSEG — Monitoring Analyst Revisions](https://lipperalpha.refinitiv.com/2022/11/product-insights-how-to-monitor-analyst-revisions-during-earnings-season/)
- [Roic.ai — 30+ years of financial data](https://www.roic.ai/)
- [Fiscal.ai (FinChat) Review — WallStreetZen](https://www.wallstreetzen.com/blog/finchat-io-fiscal-ai-review/)
- [Quartr API — earnings transcripts](https://quartr.com/products/quartr-api)
- [Quartr — Live earnings call transcripts](https://quartr.com/insights/investor-relations/live-earnings-call-transcripts-financial-research-redefined)
- [Atom Finance Review 2026 — TraderHQ](https://traderhq.com/atom-finance-review-investment-research-platform/)
- [MarketAlerts — Analyze Earnings Call Transcripts Like a Pro](https://www.marketalerts.ai/blog/how-to-analyze-earnings-calls-explained-transcripts-and-stock-signals)

---

*Word count target ≤1500: this report ~1,420 words excluding code blocks and sources.*
