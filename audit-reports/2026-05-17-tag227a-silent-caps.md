# Tag 227a — Silent Env-Cap Audit

**Date:** 2026-05-17
**Agent:** Tag 227a (silent-cap audit)
**Trigger:** Tag 226b surfaced `MAX_UNIVERSE=13000` env cap on `refresh-universe.js` while the watchlist is already 15,734. Classic memory `ci_coverage_gate_calibration.md` pattern — an absolute number set against a smaller universe quietly becomes a no-op as the universe grows.
**Scope:** Workflows, scripts/, lib/, root *.js, discovery/. Grepped for `MAX_*`, `--limit / --max / --top`, `slice(0, N)`, `Math.min/max(..., N)` constants, percentage gates that compound with universe size.
**Constraints honored:** no `methods/index.js` edit, no `FTS_CACHE_VERSION` touch, no `--no-verify`. All three regression suites stable (155→154 fail-count baseline unchanged — pre-existing orphan `methods/magic-formula.js` produces the same one fail without my edits).

---

## Findings

| # | Location | Cap | Classification | Action |
|---|----------|-----|----------------|--------|
| F1 | `.github/workflows/daily-pull.yml:100` + `refresh-universe.js:358` — `MAX_UNIVERSE='13000'` | hard cap on *discovered candidate set*; watchlist is 15,734 today | **NO-OP** | **FIXED Tag 227a-1**: raised 13000 → 25000 in both workflow env + script default. |
| F2 | `discovery/otc-markets.js:20` — `MAX_PAGES=10` × `PAGE_SIZE=500` = 5000 OTC ceiling | hard cap on OTC pagination | **Hidden cap** (warns only when API reports totalRecords > 5000) | DEFER. Tag 218 already added a `HIT MAX_PAGES` warning. Watchlist shows **0 `otc-markets`-attributed tickers** today, suggesting either the source returns < 5k (cap not bound) or attribution is mis-tagged to `auto-universe-refresh`. Flag for Karl to investigate source attribution before raising. |
| F3 | `discovery/nasdaq-api.js:31` — `REQUEST_LIMIT=10000` | per-exchange request size | **Live cap** (NASDAQ ~4000, NYSE ~3000, AMEX ~300 — 10k is generous) | Leave. Margin is 2.5×. |
| F4 | `.github/workflows/daily-pull.yml:297` — `min_ok=max(2500, total*0.18)` | coverage gate floor | **Live cap** (Tag 215e dual gate: `max(absolute, percent)`) | Leave. This is the *correct* pattern from `ci_coverage_gate_calibration.md` — already calibrated. |
| F5 | `generate-screener.js:509` — `tabs.R40 = tabs.R40.slice(0, 500)` | embedded-JSON size guard for R40 tab | **Live cap** (`5×` the "≥100 entries" requirement; doc'd as payload limiter) | Leave. Pure presentation cap, not a discovery cap. |
| F6 | `generate-methods-report.js` — `TOP_N=50 / TOP_DD=10 / TOP_PICKS_N=200 / TOP_MATRIX_N=300 / LEADERBOARD_TOP=30` | display caps for the methods-report HTML | **Live cap** (anti-OOM on artifact upload, documented at TOP_PICKS_N/TOP_MATRIX_N) | Leave. Pure presentation. |
| F7 | `snapshot-picks.js:258` — `deduped.slice(0, 100)` and `scripts/walk-forward-perf.js:291` — `allPicks.slice(0, 100)` | top-100 picks per mode | **Live cap** (intentional product spec, walk-forward consumer uses the same N — both safe) | Leave. |
| F8 | `pull-historical-prices.js:116` — per-ticker history `arr.length > 400` window | per-ticker price-history retention | **Live cap** (~16 months daily prices; downstream walk-forward needs ≤ 84 days) | Leave. |
| F9 | `scripts/check-pull-stats.js:38` — `DRIFT_THRESHOLD=0.25` vs trailing 4-run median | drift detector | **Live cap** (trailing-median based — robust to universe growth) | Leave. |
| F10 | `scripts/picks-regression-check.js:29` — `DRIFT_THRESHOLD=0.35` vs trailing 8-run median | drift detector | **Live cap** (trailing-median based — robust to universe growth) | Leave. |
| F11 | `methods/sector-medians-compute.js:17,20` — `MIN_STOCKS_PER_SECTOR=5 / MIN_STOCKS_PER_REGION_SECTOR=20` | minimum-sample gates | **Live cap** (floor, not ceiling — universe growth helps satisfy it) | Leave. |
| F12 | `scripts/method-effectiveness.js:42,43` — `MIN_VINTAGES=4 / MIN_SAMPLES_PER_GROUP=10` | minimum-sample gates | **Live cap** (floor, not ceiling) | Leave. |
| F13 | `scripts/refresh-fx.js:132` — `failed.length > CURRENCIES.length/2` | FX-failure gate | **Live cap** (count-of-failures, not size-dependent) | Leave. |
| F14 | `.github/workflows/daily-pull.yml:171` — Yahoo-Pull `timeout-minutes: 165` | per-step timeout | **Live cap** (Tag 226b already projected next scaling event at universe-18k+) | Leave; tracked separately by Tag 226b. |
| F15 | `scripts/pull-insider-form4.js:101` — `SAMPLE_LIMIT` env | sample-mode opt-in | **Live cap** (only applies when env set — production runs leave it null) | Leave. |

## Fixes Landed

### Tag 227a-1 — `MAX_UNIVERSE` 13000 → 25000

**Before:**
```yaml
MAX_UNIVERSE: '13000'
```
```js
const MAX_UNIVERSE = parseInt(process.env.MAX_UNIVERSE || '13000', 10);
```

**After:**
```yaml
MAX_UNIVERSE: '25000'
```
```js
const MAX_UNIVERSE = parseInt(process.env.MAX_UNIVERSE || '25000', 10);
```

**Rationale.** Today's watchlist is 15,734 — every newly-IPO'd or newly-discovered ticker from SEC EDGAR / Finnhub / OTC Markets / NASDAQ Screener API was competing for slots the cap had pre-filled at 13k. The cap was applied to the *discovered set* (then merged into `existing`), so when `allTickers.size > 13000`, the bottom ~7-12k were silently dropped — disproportionately the SEC/Finnhub/OTC null-mcap tickers (only 20% × 13k = 2600 slots reserved for them). 25k gives ~2-3 years of universe-growth headroom. Node OOM mitigated by the existing `--max-old-space-size=6144` on pull-yahoo and the 20%-null-mcap proportional split.

## Headline Finding

`MAX_UNIVERSE=13000` was a silent no-op: the existing watchlist already exceeds it, so the universe-refresh step has been effectively dropping new IPOs and freshly-indexed tickers on every run since the watchlist crossed 13k (somewhere in the Tag 200-220 era). One surgical fix lands the cap above the natural growth ceiling.

## Total Audited

**15 cap candidates audited; 1 no-op fixed; 1 hidden-cap flagged (F2 — OTC `MAX_PAGES`); 13 confirmed live and well-calibrated.**

---

## Commit Log

- **Tag 227a-1** (`15ecf52b0`) — raise `MAX_UNIVERSE` 13000 → 25000 in both workflow env and `refresh-universe.js` default.
- **Tag 227a-final** — this report. (File content first landed in commit `9769cb167` due to a parallel-agent race with Tag 227b — the bundle is harmless; this addendum makes the final-commit marker explicit per the brief.)

