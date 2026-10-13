# Tag 208 — Open-Source Stock-Screener Survey

**Date:** 2026-05-16
**Type:** Research / pattern-borrowing (no code changes)
**Constraint:** Fixture-hash-safe (DIAGNOSTIC default), MIT/Apache preferred over GPL/AGPL
**Scope:** GitHub repos in stock-screener / fundamental-analysis / value-investing / yahoo-finance topics

---

## Executive summary

Surveyed 10 active OSS stock-screener repos plus a handful of supporting
libraries (cinar/indicator, yfinance internals). Most projects are either
(a) thin Magic-Formula / Piotroski wrappers around yfinance with no novel
ideas, or (b) full-stack web apps (FastAPI + Postgres + Celery) whose
*architecture* is more interesting than their scoring math. We already
implement the bulk of the well-known fundamental signals (Piotroski F,
Altman Z, FCF-Yield, ROIC-trend, Magic-Formula-style EarningsYield+ROC,
margin-acceleration, insider clusters, etc.). The five genuine gaps worth
borrowing — all anchor-safe DIAGNOSTIC additions — are: Beneish M-score,
Ohlson O-score, Novy-Marx gross-profitability, RS-O'Neil weighted relative
strength, and a Benford's-Law accounting-anomaly flag. On the architecture
side, Redis-cached OHLCV with per-market refresh queues (xang1234) and
yfinance's cookie-swap retry strategy are concrete patterns worth lifting.

---

## Top 10 GitHub repos examined

| # | Repo | Stars | Lang | Last commit | License | Value-prop |
|---|------|------:|------|-------------|---------|------------|
| 1 | [vnstock](https://github.com/topics/stock-screener) | 1.3k | Python | 2026-05-16 | n/a | VN-market toolkit; broad financial-data ETL patterns |
| 2 | [TradingView-Screener](https://github.com/topics/stock-screener) | 948 | Python | 2026-05-16 | MIT | Python wrapper over TV's screener API (filter DSL) |
| 3 | [Screeni-py](https://github.com/topics/stock-screener) | 685 | Python | 2026-05-05 | GPL-3 | NSE breakout/pattern scanner |
| 4 | [PKScreener](https://github.com/topics/stock-screener) | 351 | Python | 2026-05-16 | OSI | Breakout scanner, NSE focus |
| 5 | [sss (asafravid)](https://github.com/asafravid/sss) | 156 | Python | 2024-01-21 | **GPL-3** | yfinance-based multi-market fundamental scanner |
| 6 | [stock_screener (lseffer)](https://github.com/lseffer/stock_screener) | 141 | Python | 2026-04-26 | unspecified | Nordic Piotroski+MagicFormula+NCAV, Postgres+Flask |
| 7 | [Norn-StockScreener](https://github.com/zmcx16/Norn-StockScreener) | 79 | JS+Py | active | **MIT** | Beneish, Benford, ESG, 14 named strategies |
| 8 | [fundamental-analysis (hjones20)](https://github.com/hjones20/fundamental-analysis) | 76 | Python | 2020-06 | unspec | DCF + 8y-median-ROE screener |
| 9 | [stock-screener (xang1234)](https://github.com/xang1234/stock-screener) | 48 | Python | 2026-05-16 | **Apache-2.0** | 80+ filters, Redis-cached OHLCV, multi-market queues |
| 10 | [growth-stock-screener (starboi-63)](https://github.com/starboi-63/growth-stock-screener) | 35 | Python | active | **MIT** | O'Neil-style 5-stage filter pipeline, RS-weighted |
| (ref) | [cinar/indicator](https://github.com/cinar/indicator) | 854 | Go | 2026-04-19 | AGPL/comm. | 100+ TA indicators + stream-based backtest engine |
| (ref) | [faizancodes/Automated-Fundamental-Analysis](https://github.com/faizancodes/Automated-Fundamental-Analysis) | 227 | Python | active | unspec | Sector-relative percentile grading (A+..F → /100) |

---

## 5 new method ideas

### 1. Beneish M-Score (earnings-manipulation flag)
- **Source:** [zmcx16/Norn-StockScreener](https://github.com/zmcx16/Norn-StockScreener) (MIT); also [WongYC19/QuickView](https://github.com/WongYC19/QuickView)
- **Pseudocode** (8-variable model):
  ```
  DSRI = (AR_t/Sales_t)         / (AR_{t-1}/Sales_{t-1})
  GMI  = (GM_{t-1})             / (GM_t)
  AQI  = (1 - (CA+PPE)/TA)_t    / same_{t-1}
  SGI  = Sales_t / Sales_{t-1}
  DEPI = (Dep_{t-1}/(Dep+PPE)_{t-1}) / same_t
  SGAI = (SGA_t/Sales_t)        / (SGA_{t-1}/Sales_{t-1})
  LVGI = (LTD+CL)/TA  _t / same_{t-1}
  TATA = (NI - CFO) / TA_t
  M = -4.84 + 0.92*DSRI + 0.528*GMI + 0.404*AQI + 0.892*SGI
      + 0.115*DEPI - 0.172*SGAI + 4.679*TATA - 0.327*LVGI
  → M > -1.78 ⇒ likely manipulator
  ```
- **Differs from ours:** We have Sloan-Ratio, Working-Capital-Anomaly, Q-Spike guards, Forecast-Contamination — all useful but none aggregate into a single research-validated bankruptcy-fraud composite. Beneish is the canonical sibling to Altman-Z (which we already do).
- **Anchor-safety:** DIAGNOSTIC. Add as score-history-only signal; do NOT weight into final score until backtested. Fixture-hash-safe (not in SCORE_WEIGHTS).

### 2. Ohlson O-Score (logit-based bankruptcy probability)
- **Source:** [WongYC19/QuickView](https://github.com/WongYC19/QuickView); referenced in [Norn-StockScreener](https://github.com/zmcx16/Norn-StockScreener)
- **Pseudocode** (9-variable logit):
  ```
  O = -1.32 - 0.407*log(TA/CPI)
       + 6.03*(TL/TA)        - 1.43*(WC/TA)
       + 0.0757*(CL/CA)      - 1.72*X (1 if TL>TA else 0)
       - 2.37*(NI/TA)        - 1.83*(CFO/TL)
       + 0.285*Y (1 if NI<0 last 2y else 0)
       - 0.521*((NI_t - NI_{t-1}) / (|NI_t| + |NI_{t-1}|))
  P(bankruptcy) = 1 / (1 + exp(-O))
  ```
- **Differs from ours:** Complements Altman-Z. Ohlson uses logit (probability) rather than discriminant; tends to flag *different* bankruptcies (services, low-leverage). Pair-of-models reduces single-model false-negative risk.
- **Anchor-safety:** DIAGNOSTIC overlay. Hash-safe.

### 3. Novy-Marx Gross Profitability
- **Source:** Quant-Investing notes & [lseffer/stock_screener](https://github.com/lseffer/stock_screener); idea referenced widely
- **Pseudocode:**
  ```
  GP_TA = (Revenue - COGS) / TotalAssets   // gross profit / assets
  // rank cross-sectionally; top-decile = "quality"
  // optional: pair with low EV/EBITDA for "quality + value" composite
  ```
- **Differs from ours:** We have `margin-quality`, `gross-margin-stability`, `gross-margin-acceleration` — all margin-*level*. Novy-Marx's insight is that gross-profits-to-**assets** (not to sales) is the cleanest quality factor; it explains why some low-ROE-by-revenue firms still outperform when their asset base is small. We do not currently normalize gross profit by assets.
- **Anchor-safety:** DIAGNOSTIC at first; could later replace one of the margin sub-scores in COMPOUNDER mode if backtest shows lift. Fixture-hash-safe.

### 4. O'Neil Weighted Relative-Strength (RS-Rank)
- **Source:** [starboi-63/growth-stock-screener](https://github.com/starboi-63/growth-stock-screener) (MIT) — exact formula in their README
- **Pseudocode:**
  ```
  RS_raw = 0.2*Q1_ret + 0.2*Q2_ret + 0.2*Q3_ret + 0.4*Q4_ret
  // where Q4 = most recent quarter price change
  RS_rank = percentile_rank(RS_raw across universe)  // 1..99
  // "stage-2" gate: price > SMA50 > SMA150 > SMA200, all sloping up,
  //                 within 25% of 52w high, ≥30% above 52w low
  ```
- **Differs from ours:** We track `high-proximity-52w`, `drawdown-52w`, `above-200d-ma`, `trend` — all binary or single-window. We do NOT compute a **weighted** multi-quarter momentum percentile-ranked across the universe. The 0.4 weight on Q4 captures freshness, the percentile makes it sector-comparable.
- **Anchor-safety:** DIAGNOSTIC. Universe-relative ranks shift each run — never let it gate anchors; surface as score-history field only. Fixture-hash-safe.

### 5. Benford's-Law accounting-anomaly flag
- **Source:** [zmcx16/Norn-StockScreener](https://github.com/zmcx16/Norn-StockScreener) (MIT)
- **Pseudocode:**
  ```
  // Pull all reported line-items (last 8-12 quarters) for one ticker:
  digits = [first_digit(abs(x)) for x in line_items if x != 0]
  observed = histogram(digits, bins=1..9) / len(digits)
  expected = [log10(1 + 1/d) for d in 1..9]   // Benford's distribution
  chi2     = sum((o-e)**2 / e for o,e in zip(observed, expected))
  flag     = chi2 > threshold (e.g. 15.5 ≈ p<0.05, df=8)
  ```
- **Differs from ours:** Completely new vector. We have no statistical fraud-fingerprint check. Cheap (no extra API calls — uses data already pulled). Pairs naturally with Beneish.
- **Anchor-safety:** DIAGNOSTIC. Needs ≥30 non-zero datapoints — gracefully N/A for young tickers. Fixture-hash-safe.

---

## 3 architecture improvements

### A. yfinance cookie-swap retry (drop-in for `pull-yahoo`)
- **Source:** [ranaroussi/yfinance](https://github.com/ranaroussi/yfinance/blob/main/yfinance/data.py)
- **Pattern:** On HTTP 429, yfinance flips its cookie strategy (`basic` ↔ `csrf`) and retries before raising `YFRateLimitError`. Today our retry logic backs off but reuses the same session/cookie. Adding a cookie/UA rotation on 429 would meaningfully reduce hard failures during US-market-open rush.
- **Effort:** small; touches the shared HTTP helper. No new deps.

### B. Per-market refresh queues with independent locks
- **Source:** [xang1234/stock-screener](https://github.com/xang1234/stock-screener) (Apache-2.0)
- **Pattern:** Each market (US, EU, Asia) has its own Celery queue + lock so one slow exchange never blocks the others; 5y OHLCV cached in Redis with a PG fallback. We don't need Celery, but the *idea* — segment the universe by exchange-tz, run their refreshes as independent steps in the GH-Action matrix, and cache the long-tail OHLCV separately from the daily-deltas — would shorten our `daily-pull` wall-clock and isolate region-specific Yahoo flakiness (exchange-fail reporting we just added in tag 190 confirms region-skew exists).
- **Effort:** medium; could be a workflow-only change first (split job by exchange-prefix).

### C. Sector-relative percentile grading as an output format
- **Source:** [faizancodes/Automated-Fundamental-Analysis](https://github.com/faizancodes/Automated-Fundamental-Analysis)
- **Pattern:** Each metric is graded A+..F against its **sector** peers (stddev/3 → percentile bucket), inverse metrics (P/E etc.) use the 10th-percentile as A+. Letter grades roll up into a /100 composite. We already compute sector medians (`sector-medians-auto.json`) but our snapshot HTML shows raw scores, not sector-relative letters. Adding a "sector-grade" column to the dashboard would make the existing data far more actionable without changing the scoring math.
- **Effort:** small; UI-only change to `snapshot-picks.js` HTML render.

---

## License notes

- **Avoid copying code from:** `asafravid/sss` (GPL-3), `Screeni-py` (GPL-3), `cinar/indicator` (AGPL/commercial). Borrow *concepts* only, re-derive formulas from primary academic sources (Beneish 1999, Ohlson 1980, Novy-Marx 2013, O'Neil "How to Make Money in Stocks") rather than from these repos.
- **Safe to study & adapt:** `xang1234/stock-screener` (Apache-2.0), `zmcx16/Norn-StockScreener` (MIT), `starboi-63/growth-stock-screener` (MIT), `m-turnergane/stock-screener` (MIT), `TradingView-Screener` (MIT).
- All five proposed methods are published in academic literature or in MIT/Apache repos; **none** require touching GPL code. Pseudocode above was synthesized from primary sources.

---

## Compatibility check vs. existing methods

| Proposed | Overlap with existing | Verdict |
|---|---|---|
| Beneish M | Sloan-Ratio, Working-Capital-Anomaly, Forecast-Contamination-Guard | Composite, distinct signal — keep |
| Ohlson O | Altman-Z | Sibling model, different false-negative profile — keep |
| Gross-Prof/TA | margin-quality, gross-margin-* | New denominator (assets, not sales) — keep |
| O'Neil RS | high-proximity-52w, above-200d-ma, trend | Weighted multi-quarter momentum, universe-percentile — new |
| Benford's Law | (none) | Entirely new vector — keep |

All five default to DIAGNOSTIC (per fixture-hash invariant). None enter `SCORE_WEIGHTS` until backtested via `walk-forward-perf.js`. Hash-safe.

---

## Recommended next steps (research-only; no implementation)

1. **Tag 209 candidate:** implement Beneish-M as DIAGNOSTIC. Cheapest win, all inputs already in our yfinance pull (AR, Sales, GM, PPE, Dep, SGA, LTD, CL, TA, NI, CFO).
2. **Tag 210 candidate:** implement Ohlson-O (same data set as Beneish, near-zero marginal cost).
3. **Workflow tweak (low-risk):** split `daily-pull` matrix by exchange-tz to isolate regional Yahoo failures (architecture pattern B).

---

**Word count:** ~1,180
