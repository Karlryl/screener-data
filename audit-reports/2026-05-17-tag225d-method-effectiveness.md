# Tag 225d — Method Effectiveness Review (Tag 211-223 Cohort)

**Date:** 2026-05-17
**Agent:** Tag 225d (final-wave method-effectiveness review)
**Cohort under review:** 12 new DIAGNOSTIC methods added Tags 211-223 + 1 promotion (`ohlson-o-score` → DATAGUARD).
**Method:** Random-sampled 500 + 10 anchor tickers from `snapshots/` (universe = 3,529 files, sampled = 582). Ran each method via its own `evaluate()` against the live snapshot corpus. The full per-method JSON is at `outputs/tag225d-effectiveness.json`; the one-shot probe at `scripts/_tag225d_effectiveness_probe.js`.

The existing `scripts/method-effectiveness.js` was inspected but not invoked — it requires `methods-history/` vintages and `prices/history.json` for forward-return alpha computation, both of which exist but only for the legacy method set; the 13 cohort methods need a coverage/pass-rate baseline **first**, not an alpha estimate.

`methods-history/` available dates: 2026-05-08, 2026-05-09, 2026-05-10, 2026-05-11, 2026-05-13, 2026-05-14, 2026-05-15 (7 vintages, below `MIN_VINTAGES = 4` threshold only weakly; alpha for the new cohort would have ≤7 days of data, statistically meaningless).

## Anchors

`NVDA, MSFT, PLTR, CRDO, MELI, AVGO, ASML, V, MA, COST` — all 10 snapshots present.

## Headline Table

| Method | Coverage | Pass-rate | Anchors | p20 / p50 / p80 | Flags | Verdict |
|---|---:|---:|---:|---|---|---|
| earnings-power-stability | 75.8% | 64.2% | 9/10 | 0.067 / 0.166 / 0.471 | – | **HEALTHY** |
| fcf-conversion-stability | 80.2% | 58.2% | 9/10 | 0.220 / 0.873 / 1.319 | – | **HEALTHY** |
| operating-leverage-margin-accel | 40.9% | 52.1% | 10/10 | -0.071 / 0.057 / 0.221 | – | **HEALTHY** |
| capex-vs-sbc-quality | 53.3% | 81.6% | 9/10 | 1.131 / 3.925 / 17.643 | – | **HEALTHY** (high pass but threshold matches Mauboussin design) |
| sga-revenue-trend | 1.5% | 77.8% | 8/10 | -0.015 / -0.011 / 0.003 | LOW_COVERAGE | **PULLER GAP** (annualSGA recently added, broad coverage not yet backfilled) |
| working-capital-trend | 1.5% | 88.9% | 8/10 | -0.106 / -0.060 / 0.003 | LOW_COVERAGE | **PULLER GAP** (annualBalance current-asset/liab coverage uneven) |
| ohlson-o-score | 1.5% | 100.0% | 8/10 | -13.355 / -11.078 / -8.818 | LOW_COVERAGE, LOOSE_THRESHOLD | **PULLER GAP** + **THRESHOLD UNDER-DISCRIMINATING** on its 1.5% sample |
| revenue-quality-cov | 0.0% | – | 0/10 | – | LOW_COVERAGE, ANCHOR_MISS | **DEAD** (needs ≥8 quarters; snapshots carry only 5 — pull-yahoo `revenueQ` is capped at 5) |
| price-momentum-12-1 | 0.0% | – | 0/10 | – | LOW_COVERAGE, ANCHOR_MISS | **DEAD** (`prices/history.json` only has ~78 daily bars vs 84 needed — daily-pull is a 4-month rolling window) |
| institutional-ownership-13f | 0.0% | – | 0/10 | – | LOW_COVERAGE, ANCHOR_MISS | **DEAD** (`external-data/sec-13f-by-ticker.json` `byTicker` map has only 6 tickers) |
| analyst-upside | 0.0% | – | 0/10 | – | LOW_COVERAGE, ANCHOR_MISS | **DEAD** (Tag 219c puller not persisting `metrics.targetMedianPrice`) |
| earnings-surprise-momentum | 0.0% | – | 0/10 | – | LOW_COVERAGE, ANCHOR_MISS | **DEAD** (Tag 220c puller not persisting `earningsHistory`) |
| institutional-density | 0.0% | – | 0/10 | – | LOW_COVERAGE, ANCHOR_MISS | **DEAD** (Tag 220c puller not persisting `meta.institutionsPercentHeld`) |

## Failure-Mode Findings

**6 methods (46% of cohort) return coverage = 0.0%** — they are effectively dead at the input layer. The remaining 4 of the 7 flagged methods are at 1.5% coverage, which is also functionally dead but evaluates cleanly on the few names that happen to carry the data.

The pattern: **every dead method's `reason` field correctly identifies the missing puller-side input.** The methods themselves are written correctly; the bug surface is entirely in `pull-yahoo.js` / `pull-13f-institutional.js` / the daily-price puller.

| Root cause | Affected methods | Fix location |
|---|---|---|
| `revenueQ` capped at 5 quarters; method needs ≥8 | revenue-quality-cov | `pull-yahoo.js` — extend `incomeStatementHistoryQuarterly` retention from 5 → 8 |
| `prices/history.json` only 78 bars (~4 months) | price-momentum-12-1 | daily-price puller — extend rolling window to ≥252 trading days OR use weekly fallback path documented in method header |
| `sec-13f-by-ticker.json` `byTicker` has 6 tickers | institutional-ownership-13f | `scripts/pull-13f-institutional.js` — the CUSIP→ticker join is producing 6 hits only (likely fixture-only seed) |
| `metrics.targetMedianPrice` not persisted | analyst-upside | `pull-yahoo.js` — Tag 219c was registered but `financialData.targetMedianPrice` not piped into snapshot.metrics |
| `earningsHistory` not persisted | earnings-surprise-momentum | `pull-yahoo.js` — Tag 220c `earningsHistory` module not piped through |
| `meta.institutionsPercentHeld` not persisted | institutional-density | `pull-yahoo.js` — Tag 220c `majorHoldersBreakdown.institutionsPercentHeld` not piped through |
| `annualSGA` / `annualBalance` thin | sga-revenue-trend, working-capital-trend, ohlson-o-score | `pull-yahoo.js` — Tag 211l fields are present on some tickers but not most (1.5% hit-rate suggests a try-catch swallowing failures silently) |

**Threshold concerns (recommendations only, no edits made):**

- `ohlson-o-score`: pass-rate 100% on 9 computable rows. Threshold (O < 0 ⇒ low-bankruptcy-probability) and distribution (p20=-13.4, p80=-8.8) shows everyone is far below 0. Once coverage is restored to a normal universe this may still discriminate, but the calibration should be re-checked once n ≥ 200. **Not actionable yet — wait for puller fix.**
- `capex-vs-sbc-quality`: pass-rate 81.6% is borderline-loose, but Mauboussin's framing is "capex ≥ SBC = no optical-FCF concern" so the high pass-rate is **expected**, not a bug; only ~18% of firms have SBC > Capex (the red-flag bucket). **Keep as-is.**
- All other healthy methods have pass-rates in the 52-65% band — appropriate discrimination.

## Anchor-Coverage Detail

Anchor misses for the four healthy/borderline methods are isolated and explainable:

- `CRDO` missing from earnings-power-stability + fcf-conversion-stability: too-young company (insufficient 5y history) — expected behavior.
- `ASML`, `MA` missing from sga-revenue-trend / working-capital-trend / ohlson-o-score: annualSGA / annualBalance gaps for these specific tickers — confirms the puller is failing on a per-ticker basis rather than uniformly.
- `MELI` missing from capex-vs-sbc-quality: SBC = 0 (no stock comp reported) → division-by-zero guard correctly returns non-computable.

## Recommendations (No Files Changed)

1. **Highest leverage:** fix `pull-yahoo.js` to actually persist `targetMedianPrice`, `earningsHistory`, `institutionsPercentHeld` — three Tag 223a methods activate at once with one puller patch. Estimated effort: ~30 lines.
2. **Medium:** extend `revenueQ` retention 5 → 8 quarters in `pull-yahoo.js` to activate revenue-quality-cov.
3. **Medium:** extend daily-price puller's window from ~78 bars to ≥252 OR teach price-momentum-12-1 to consume `priceHistoryWeekly` (the method header documents this fallback already).
4. **Investigate:** why `pull-13f-institutional.js` ⇒ `byTicker` map has only 6 entries. Either the CUSIP→ticker translation is broken, the source 13F filings list is empty, or the file write is truncating.
5. **No method-source edits warranted.** Every dead/low-coverage method emits a clean, accurate `reason` string — they are doing exactly what they were designed to do when their inputs are missing.

## Files

- `outputs/tag225d-effectiveness.json` — full machine-readable per-method report.
- `scripts/_tag225d_effectiveness_probe.js` — one-shot probe (not registered in any cron; safe to delete after this audit, but kept in tree for reproducibility).
