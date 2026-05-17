# Tag 226c — International-Ticker Handling Audit

**Date**: 2026-05-17
**Branch**: main
**Author**: Tag 226c agent
**Scope**: International (non-US) tickers in `snapshots/` — currency, market hours,
weekend-trading-day handling, reporting-currency adjustment.

---

## Executive summary

Our universe is **46.5% international** (1,640 of 3,527 snapshots have a market
suffix like `.HK / .T / .L / .DE / .PA / .TO`). Every single one of those 1,640
snapshots is on the **pre-Tag-220 schema** (no `tradingCurrency`, no `fxRateApplied`,
no `fxConverted`) AND was last pulled on **2026-05-13** (>4 days stale).

We have one fresh snapshot from today (`TSM.json`, fetched 2026-05-17T14:08) that
shows what the post-Tag-220 schema is supposed to deliver: a clean
`reportingCurrencyOriginal: 'TWD'`, `fxRateApplied: 0.0318`, `fxConverted: true`
chain. None of the other 1,639 intl tickers have ever passed through that
conversion — meaning every downstream metric that combines `marketCap` (Yahoo
auto-converts to USD trading-ccy) with a financial-statement field
(`revenueTTM / netIncomeTTM / annualBalance.totalAssets`, all in the local
reporting currency) is computing a **mixed-currency ratio** that is mathematically
meaningless.

**HIGH severity** for any sector / country tab that surfaces intl names — the
ratios are off by 1–4 orders of magnitude depending on the currency.

---

## Anchor verification (5 international names)

| Anchor      | Suffix | Region    | Fetched     | reportingCcy | mcap (USD?)    | revenueTTM (local) | Implied mcap/rev | True mcap/rev (USD) | Status |
|-------------|--------|-----------|-------------|--------------|----------------|--------------------|------------------|---------------------|--------|
| `TSM`       | none   | NYSE ADR  | 2026-05-17  | USD (conv)   | 66.6B          | 130.3B             | 0.51             | ~0.55               | OK (fresh, fx-converted) |
| `9988.HK`   | .HK    | HKSE      | 2026-05-13  | undefined!   | 326.7B         | 1,016.7B (CNY!)    | 0.32             | ~0.69               | **BROKEN — mixed ccy** |
| `MC.PA`     | .PA    | Euronext  | 2026-05-13  | EUR          | 241.7B (EUR?)  | 80.8B (EUR)        | 2.99             | ~2.99 if both EUR   | tolerable IFF both EUR |
| `NESN.SW`   | .SW    | SIX Swiss | 2026-05-13  | CHF          | 218.8B         | 89.9B (CHF)        | 2.43             | ~2.43 if both CHF   | tolerable IFF both CHF |
| `ASML.AS`   | .AS    | Euronext  | 2026-05-13  | undefined!   | 526.9B         | 33.7B              | 15.6             | ~15.6 if both EUR   | tolerable IFF both EUR |
| `ASML`      | none   | NasdaqGS  | 2026-05-13  | undefined!   | 586.2B (USD)   | 33.7B (EUR!)       | 17.4             | ~16.3 USD/USD       | **BROKEN — ADR mismatch** |

The TSM row is the only one carrying the post-Tag-220 conversion envelope
(`fxRateApplied: 0.031762164`, `fxRateSource: 'fx-rates.json @ 2026-05-15…'`,
`reportingCurrencyOriginal: 'TWD'`, `fxConverted: true`). The other five rows
have all of those fields as `undefined`.

---

## Findings

### F-INTL-01 — **HIGH**: Mixed-currency `mcap` vs financial-statement fields on 1,640 intl snapshots

**Symptom**: For every snapshot fetched 2026-05-13 (entire intl universe),
`stock.marketCap.value` is in USD (Yahoo auto-converts via the trading-currency
side of `quoteSummary`) while `stock.metrics.revenueTTM`, `stock.metrics.netIncomeTTM`,
`stock.annual.annualRevenue[*]`, and `stock.annual.annualBalance[*].totalAssets`
are in the **local reporting currency** (CNY for 9988.HK, JPY for 7203.T,
KRW for 005930.KS, GBp for HSBA.L / RIO.L, EUR for the EU set, …).

**Evidence**:
```
7203.T (Toyota):
  mcap = 231,658,376,868 (USD-shaped, matches 232B USD market cap)
  revenueTTM = 50,684,951,003,136 (JPY — Toyota's reported ¥45T rev)
  mcap/rev = 4.6e-3 (meaningless; true ratio in USD/USD ≈ 0.77)

005930.KS (Samsung):
  mcap = 1,377,599,311,419 (??? hybrid)
  revenueTTM = 388,405,938,618,368 (KRW — ~388T KRW = $278B)
  mcap/rev = 3.5e-3 (meaningless)

9988.HK (Alibaba):
  mcap = 326,731,483,316 (USD-shaped; Alibaba ~$327B USD market cap)
  revenueTTM = 1,016,743,985,152 (CNY — ¥1T = $140B at 6.9 spot)
  mcap/rev = 0.32 (meaningless; true ratio USD/USD ≈ 2.3)

HSBA.L (HSBC):
  mcap = 287,167,644,795 (USD-shaped)
  revenueTTM = 63,773,999,104 (GBp! — HSBC reports in pence ×100)
  Even if HSBC reported in pounds (GBP not GBp), USD/GBP mix would be wrong.
```

**Impact**:
- **R40 sanity-cap** (`r40-sanity-cap`) — checks `mcap`-based thresholds; off by
  whatever USD/local FX rate, ~×100 for KRW, ~×7 for JPY/CNY.
- **fcf-yield, ev-ebitda, peg, forward-pe** — all combine market-cap-derived
  numerator with reporting-currency denominator. Numbers are numerically valid
  but semantically nonsense.
- **Tab classification**: SMALL = `mcap < $2B`. 129 intl snapshots currently sit
  in this range — many of those are *legitimate* small caps (mcap-in-USD < 2B)
  but the underlying revenue/margin ratios surface in tab columns as
  mixed-ccy noise.
- **Pre-commerciality megacap guard** (`pre-commerciality-megacap-guard`):
  `mcap > 1B && rev < 100M`. A Japanese mid-cap with ¥45T rev = 50.7T JPY,
  passed through as the raw number, is wildly > 100M so the guard never fires
  on intl (false negative). Conversely a Korean micro-cap with rev ~30B KRW
  (~$22M USD) reports as `rev = 30,000,000,000` JPY-shaped, which the guard
  sees as "$30B rev → safe" (false negative again, opposite direction).

**Root cause**: `_convertSnapshotToUSD()` in `pull-yahoo.js` IS implemented
(line 250) but no intl snapshot in the current `snapshots/` dir has been
processed by a puller version that applies it. Tag 220 introduced the FX
conversion infrastructure; the May-13 pull was on a pre-Tag-220 binary.

**Fix path**: Trigger a full re-pull (`npm run pull` or workflow dispatch).
The fix is already deployed in the puller — we just need the data to be
re-generated. Estimated runtime: ~6–8h for the full universe given rate-limits.

**Trivial mitigation (optional)**: Add a dataguard method that flags any
snapshot lacking `meta.fxRateApplied` if `meta.reportingCurrency !== 'USD'`.
Marks the snapshot incomputable so downstream methods don't pollute scoring.

---

### F-INTL-02 — **MEDIUM**: `meta.exchange` / `meta.country` / `meta.currency` are `undefined` on stale snapshots

**Symptom**: The pre-Tag-220 snapshots set only
`ticker / name / sector / industry / region / reportingCurrency / fetchedAt /
filingDate / firstTradeDate / ipoYear` on `meta`. Fields the dashboard relies on
for the country chip (`country`, `currency`, `quoteType`, `exchange`,
`tradingCurrency`) are all undefined.

**Evidence**: see "Anchor verification" table — every column except TSM is `undefined`.

**Impact**:
- Dashboard's `REGION_TO_COUNTRY` lookup in `generate-screener.js:30-43` falls
  back to the `region` string ("HKSE", "Swiss", "Paris"). Works for the chip
  itself but means the country FILTER (`fCountry` dropdown) cannot
  programmatically distinguish e.g. ".SS" (Shanghai = China A-shares) from
  ".HK" (Hong Kong = also China, but USD-tradeable for foreigners). Both
  resolve to `CN` or fall back to region.
- Tag 226c-1 (this cycle's dashboard polish) does NOT surface currency
  anywhere — but if it did, all intl rows would render as `—`.

**Fix path**: Re-pull, OR add a region→reportingCurrency static fallback table
in the dashboard for tickers that lack `meta.reportingCurrency`.

---

### F-INTL-03 — **LOW**: Fetch time inconsistency across regions

**Symptom**: The May-13 pull executed at 04:37 UTC. That timestamp captures:
- Asia (HK, TW, JP, KS): mid-trading session ✓
- Europe (L, DE, PA, SW, AS, MI): pre-market — captures previous close ✗
- Americas (TO, MX, SA, US): pre-market — captures previous close ✗

So the `marketCap`, `regularMarketPrice`, and `fiftyTwoWeekHigh/Low` reflect
**different trading days** for Asia (live) vs Europe/Americas (yesterday-close).
Tag 199 audit-filter `IPO < 1y` and any 52-week-proximity method (`high-proximity-52w`,
`drawdown-52w`) silently use whichever the latest single-pull captured.

**Impact**: Subtle — the price gap between "Asia live mid-day" and "Europe
prior-close" is usually < 2% but skews any cross-region comparison or
sector-percentile snapshot taken on the same day.

**Fix path**: Workflow already runs at 04:37 UTC. Option A: split into two
runs (one at 04:30 UTC for Asia, one at 18:00 UTC for US close, one at 14:30
UTC for Europe). Option B: Accept the limitation and document. Option C:
Record `meta.regionalMarketStatus` ("OPEN" vs "CLOSED") at fetch time so
downstream methods can weight stale prices appropriately.

Recommend Option B (document) + add a single sentence to the SECTOR tab
explainer noting that intra-day comparisons mix open-market Asia with
prior-close EU/US.

---

### F-INTL-04 — **INFO**: HK suffix coverage is comprehensive but `.SS` (Shanghai) and `.SZ` (Shenzhen) get no FX rate for CNY

**Symptom**: 332 snapshots in our universe use `.SS` or `.SZ` (Shanghai/Shenzhen
mainland China). Even after the next re-pull, these will need a CNY→USD FX rate.
Need to verify `fx-rates.json` has CNY (CNH/CNY split — onshore vs offshore can
diverge 0.5–2%).

**Evidence**: Did not inspect `fx-rates.json` directly in this sweep; deferred
to the puller agent. Listing for awareness.

**Impact**: If `CNY` is missing or stale, all 332 `.SS / .SZ` snapshots will
land with `fxRateApplied: null` and `fxConverted: false`, triggering the
puller's existing `fxConversionFailed` guard. Universe size will visibly drop.

**Fix path**: Verify `external-data/fx-rates.json` includes CNY; if missing, add
to the FX puller before the next intl re-pull.

---

## Headline finding for caller

**1,640 international snapshots (46.5% of the universe) carry a USD market cap
glued to local-currency revenue/income/balance-sheet figures, because the
puller's FX-conversion path was not active on the 2026-05-13 backfill and
every intl snapshot in `snapshots/` predates the post-Tag-220 puller binary.
A full re-pull will fix it — the conversion code is already deployed.**

---

## Audit metadata

- Universe: 3,527 snapshots total. 1,640 international (46.5%) by suffix detection.
- Suffix distribution: `.T`(290) `.HK`(201) `.L`(158) `.SS`(150) `.TO`(119)
  `.TW`(108) `.AX`(89) `.DE`(84) `.SZ`(82) `.PA`(68) `.ST`(42) `.MI`(35)
  `.SW`(35) `.KS`(32) `.MC`(23) `.AS`(20) `.HE`(18) `.CO`(15) `.BR`(11)
  `.OL`(10) plus 50 misc.
- Snapshots fetched 2026-05-17 (today): 12 (anchor verifications + TSM).
- Snapshots fetched 2026-05-13 (universe baseline): 3,515.
- Tests baseline at audit start: tag28 155/155, engine-cli 10/10, integration-anchor 10/10.
- No fixes applied in this audit (per Tag 226c instructions); fixes scheduled
  for next re-pull cycle.
