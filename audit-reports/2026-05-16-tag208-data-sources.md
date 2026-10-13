# Tag 208 — Alternative Data Source Research

**Date:** 2026-05-16
**Author:** Research agent (Claude)
**Scope:** Identify free / near-free data sources to complement (and partially de-risk) our Yahoo Finance dependency.
**Status:** Research-only. No code changes.

---

## TL;DR

We already pull from two sources: **Yahoo Finance** (runtime, 4018 tickers) and **SEC EDGAR companyfacts** (monthly overlay, US only, via `pull-sec-xbrl.js`). **Finnhub** is wired as a GitHub Secret (`FINNHUB_API_KEY`) but currently used *only* for universe discovery in `discovery/finnhub.js` — its free 60 req/min budget is mostly idle.

The single most valuable next integration is **SEC EDGAR Form 4 (insider transactions) + 13F (institutional holdings)** — both are free, keyless, already on a host we trust (`data.sec.gov`), and add signals Yahoo doesn't expose at all (per-insider buy/sell timing, QoQ institutional accumulation). The second-most-valuable is **expanding Finnhub's already-paid-for budget** to fill the non-US gaps (analyst estimates, insider sentiment for European tickers).

---

## 1. Current State (Baseline)

| Source | Used for | Pull frequency | Cost | Pain points |
|---|---|---|---|---|
| Yahoo Finance (`yahoo-finance2`) | All runtime fundamentals + price for 4018 tickers | Daily | Free | Schema drift (Tag 203d), 403 throttling, 7+ hr pulls, currency gaps (Tag 204a), no global insider data |
| SEC EDGAR companyfacts | Audited fundamentals overlay (US only) | Monthly (`monthly-sec-xbrl.yml`) | Free | Not yet merged into snapshots (per pull-sec-xbrl.js header) |
| Finnhub (discovery only) | Symbol lists per exchange | Weekly-ish | Free | Massive headroom left on 60 req/min budget |

---

## 2. Top 5 Candidate Sources (Verified May 2026)

### 2.1 SEC EDGAR — Form 4 + 13F bulk JSON
- **Pricing:** Free, no key, no daily cap.
- **API style:** REST + bulk JSONL.gz downloads. Base: `https://data.sec.gov/`.
- **Rate limit:** **10 req/sec/IP**, enforced — exceed and IP is blocked ~10 min. `User-Agent` header **required** (must include contact email per acceptable-use policy).
- **Key fields offered:**
  - Form 3/4/5 (insider transactions) — full filings as JSONL.gz, one line per filing, monthly partitions.
  - Form 13F-HR (institutional holdings ≥$100M AUM) — CUSIP, shares, value, voting authority, ~3000–4000 managers/quarter since 2013.
  - Already-integrated: `submissions/CIK*.json`, `companyfacts/CIK*.json`, `companyconcept`, `frames`.
- **Status:** Highest-confidence recommendation. Same infra we already trust (`pull-sec-xbrl.js`).

### 2.2 Finnhub (free tier expansion)
- **Pricing:** Free tier confirmed 2026: **60 req/min** (internal cap 30 req/sec).
- **API style:** REST + WebSocket.
- **Free-tier limits:** 1 year of history per request; some "as-reported" financials gated; WebSocket capped at 50 symbols.
- **Key fields free-tier-accessible:** company news, basic fundamentals, SEC filings, **insider transactions (US + selected EU)**, **insider sentiment**, earnings transcripts (alt-data tier), recommendation trends, basic analyst estimates, FDA calendar, lobbying disclosures, ESG scores.
- **Status:** API key already provisioned. Adding endpoints = zero new secret-management work.

### 2.3 FRED (Federal Reserve Bank of St. Louis)
- **Pricing:** Free with API key.
- **API style:** REST (`fred/series`, `fred/releases`, etc.).
- **Rate limit:** Not publicly documented as a hard number; community reports ~120 req/min are fine. ToU prohibits *commercial redistribution* of third-party series (FRED-curated series are fine for research).
- **Key fields:** ~800,000 macro series — UST yield curve, CPI, M2, unemployment, ISM, OECD CLI, VIX, fed-funds. Daily/weekly/monthly cadence.
- **Status:** Pure overlay (macro context, not per-ticker). Lightweight integration.

### 2.4 OpenFIGI (Bloomberg's free identifier mapper)
- **Pricing:** Free, no daily/weekly/monthly cap.
- **API style:** REST POST.
- **Rate limit:** No key → **25 mapping req/min, 10 jobs/req**. With key → **25 req/6 sec, 100 jobs/req** (= ~25,000 instruments/min).
- **Key fields:** ISIN ↔ CUSIP ↔ SEDOL ↔ FIGI ↔ ticker mapping; share class / exchange disambiguation. 20+ identifier types including WKN (German), CINS, Italian Identifier.
- **Status:** Fixes the Yahoo currency/ADR issue (Tag 204a) at the *identifier* layer — we'd know a ticker is an ADR before we even pull it.

### 2.5 Alpha Vantage / Polygon (Massive) / Tiingo — **all rejected**
- **Alpha Vantage free:** Now only **25 req/day** (down hard from 500/day in 2023). Useless for 4018 tickers.
- **Polygon.io:** Rebranded to **Massive.com** late 2024. Free tier is **5 req/min**, paid stocks Starter $29/mo with 15-min-delayed data and no real-time. Fundamentals require higher tier (~$79+/mo).
- **Tiingo free:** End-of-day prices only — fundamentals API and news API are paid add-ons.
- **IEX Cloud:** **Shut down 31 August 2024.** Do not design against it. (Tiingo / Databento are the cited successors; both paid.)

---

## 3. Three Concrete Integration Proposals

### 3.1 `pull-sec-insider.js` — SEC Form 4 insider transactions
- **Signal added:**
  - Net insider buy/sell USD over trailing 90/180 days per ticker
  - "Cluster buy" flag (≥3 insiders buying within 30 days — a documented alpha factor)
  - CEO/CFO-specific transaction tag (signal weight differs from director buys)
- **Architecture sketch:**
  - New script `pull-sec-insider.js` modelled on `pull-sec-xbrl.js` (same `get()` helper, same `User-Agent`, same rate logic).
  - Pull monthly Form 4 JSONL.gz bundle from SEC (one file/month, ~50 MB).
  - Parse and aggregate per CIK; resolve CIK→ticker via the existing `discovery/sec-tickers.js` mapping.
  - Cache to `external-data/sec-insider/<ticker>.json` (git-ignored), commit `_manifest.json`.
  - Schedule: weekly via new workflow `weekly-sec-insider.yml` (Form 4 filings have a T+2 deadline so daily is overkill).
  - Merge into snapshot in a follow-up PR after 4 weeks of validation, behind a feature flag (`INSIDER_OVERLAY=1`) — same staged rollout pattern as XBRL.
- **Risk:**
  - Rate-limit blowback: low (monthly bulk file, single endpoint).
  - Schema drift: low (SEC schemas are FOIA-stable).
  - US-only coverage: Russell-1000 portion of watchlist (~1500 tickers) gets the signal; EU/Asia gets nothing (acceptable — better than current zero).
  - ToS: SEC EDGAR is public domain. No redistribution issue.

### 3.2 `pull-finnhub-overlay.js` — fill the non-fundamentals gap
- **Signal added (per ticker, gated by free-tier coverage):**
  - **Insider sentiment** (Finnhub's MSPR / share-monthly metric) — works for US + several EU exchanges Yahoo doesn't cover.
  - **Recommendation trends** (buy/hold/sell counts) for global tickers where Yahoo has nothing.
  - **Earnings surprise history** (last 4 quarters actual vs estimate).
- **Architecture sketch:**
  - New script `pull-finnhub-overlay.js`. Use existing `FINNHUB_API_KEY` secret.
  - Budget: 60 req/min × 1500 ms safety margin → ~3500 tickers/hr. Full watchlist in ~75 min.
  - Endpoints per ticker: `/stock/insider-sentiment`, `/stock/recommendation`, `/stock/earnings`. Three calls × 4018 = 12,054 calls = ~3.5 hr at 60/min — split across **two daily-pull jobs** (US-first, RoW-second) to stay below 7-hr budget.
  - Cache `external-data/finnhub/<ticker>.json`, atomic-write via `lib/atomic-write.js`.
  - Daily integration into snapshot under feature flag.
- **Risk:**
  - Rate limit: real (we already discovered this in `discovery/finnhub.js`). Mitigation: 1100 ms inter-call delay, single concurrency, exponential backoff on 429.
  - Vendor lock-in: medium. Finnhub's free tier could shrink (Alpha Vantage just did). Mitigation: keep cache files self-describing, parser modular.
  - ToS: Finnhub free tier explicitly permits non-commercial use; Karl's hobby project qualifies.

### 3.3 `pull-fred-macro.js` — macro overlay (regime detection)
- **Signal added (cross-watchlist, not per-ticker):**
  - UST 10Y-2Y yield-curve spread (recession indicator)
  - VIX level + 30-day delta (risk-off flag)
  - Trade-weighted USD index (boosts/hurts USD-revenue exporters)
  - OECD Composite Leading Indicator (global growth regime)
- **Architecture sketch:**
  - New script `pull-fred-macro.js`. New secret `FRED_API_KEY` (free registration).
  - Pulls ~12 series, ~120 req total — fits in <1 min once per day.
  - Output: single `external-data/macro/latest.json` consumed by a new method `methods/macro-regime.js` that injects a regime score into snapshots.
  - Schedule: prepend to `daily-pull.yml` (no impact on critical path).
- **Risk:**
  - Rate limit: negligible (12 calls/day).
  - ToS: FRED prohibits commercial redistribution of *some* third-party series (e.g., S&P). Sticking to BEA / Fed / BLS / OECD series sidesteps this.
  - **Fixture-hash invariant:** must register as a `DIAGNOSTIC` method (not in `SCORE_WEIGHTS`) per `fixture_hash_invariant.md`, otherwise it'll break the deterministic-fixture test.

---

## 4. API Key Management Plan

We already use the `secrets.FOO` GitHub Actions pattern (`FINNHUB_API_KEY`, `DISCORD_WEBHOOK`, `GITHUB_TOKEN`). New keys follow the same pattern:

| Key | Source | Add via |
|---|---|---|
| `FRED_API_KEY` | https://fred.stlouisfed.org/docs/api/api_key.html (free, instant) | GitHub → Settings → Secrets and variables → Actions → New repository secret |
| `OPENFIGI_API_KEY` (optional, only if we exceed 25/min) | https://www.openfigi.com/api → Get API Key (free) | same |
| **SEC EDGAR** | **No key needed** — just User-Agent header (already correct in `pull-sec-xbrl.js`) | n/a |

Convention to keep:
- Every new pull script must `silently skip if its key is unset` (pattern used in `discovery/finnhub.js`) so local dev / CI without secrets still passes.
- Keys are **never** logged; redact via `${KEY:0:4}***` style if any debug print is added.
- Document each new secret in `PROJECT-STATUS.md` under a "Secrets" section.

---

## 5. Yahoo-Replacement Risk Analysis

Yahoo's `yahoo-finance2` library has broken silently several times in 2025–2026 (Tag 203d operatingIncome, Tag 204a currency). The library is a single maintainer's reverse-engineering — there is **no SLA**. A worst-case scenario:

| Failure mode | Likelihood | Blast radius | Mitigation we have today | Mitigation to add |
|---|---|---|---|---|
| Single field drops (e.g., FCF) | High | One method scores wrong | `pipeline-health-check` allowlist (Tag 193) | Cross-validate against SEC XBRL when ticker is US |
| Crumb/cookie auth breaks | Medium | All pulls fail | yahoo-finance2 ships fix in ~days | Capture stale cache (last good snapshot) and run in degraded mode |
| Yahoo blocks GitHub Actions IPs | Medium | Full outage | None | **Tier-A fallback: switch to Finnhub for top-tier US tickers** (Russell-1000 ⊂ Finnhub free coverage); accept loss of Asia/EU short-term |
| Library unmaintained (>6 mo no update) | Low–medium | Slow rot | None | Fork; or migrate price-only flow to **Stooq** (free CSV, no key) and fundamentals to **SEC XBRL + Finnhub** |

**Backup plan in priority order:**
1. **Today already works:** SEC XBRL gives us US fundamentals if Yahoo dies for US.
2. **Add next:** Finnhub overlay (proposal 3.2) — once integrated, it covers US + half of EU as a Yahoo backup for non-price fields.
3. **Last resort:** Stooq CSV for prices (free, no key, daily EOD only — but enough to keep the screener running in degraded mode).

The key insight: **with SEC EDGAR + Finnhub integrated, a Yahoo outage degrades from "screener offline" to "Asia coverage lost, US/EU continues."** That's a meaningful resilience upgrade.

---

## 6. Recommendation

**Build order (highest ROI first):**

1. **Proposal 3.1 — SEC Form 4 insider transactions.** No new secret, free, adds a signal we literally cannot get elsewhere on the free tier. ETA: ~1 dev day for pull script + 1 day for snapshot merge.
2. **Proposal 3.2 — Finnhub overlay.** Uses already-provisioned key. Fills the non-US analyst/insider gap. ETA: ~2 dev days (rate-limit tuning is the real work).
3. **Proposal 3.3 — FRED macro overlay.** Lowest-effort, lowest-blast-radius diagnostic enhancement. ETA: ~half a day.

OpenFIGI is a nice-to-have for fixing the ADR currency problem at the source — defer until we hit it again.

---

## Sources Verified
- SEC EDGAR rate limits & Form 4/13F JSON: tldrfiling.com/blog/sec-edgar-api-rate-limits-best-practices (2026)
- Finnhub free tier: 60 req/min, insider data included — multiple corroborating dev articles (May 2026)
- Polygon→Massive rebrand: massive.com/blog/polygon-is-now-massive (LinkedIn announcement late 2024)
- IEX Cloud shutdown 31 Aug 2024: iexcloud.org official notice
- Alpha Vantage free tier downgrade to 25 req/day: alphavantage.co/support (2026)
- OpenFIGI rate limits: openfigi.com/api/documentation (2026)
- FRED ToU: fred.stlouisfed.org/docs/api/terms_of_use.html
