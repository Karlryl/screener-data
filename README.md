# screener-data

Node.js stock-screener pipeline. Pulls fundamentals + price data for ~15 700 global tickers daily, scores each ticker against ~80 method modules, classifies into Hypergrowth / Quality-Compounder / Turnaround discovery modes, and publishes a static HTML dashboard to GitHub Pages.

Engineer-to-engineer reference. No marketing copy. For chronological context see `audit-reports/`.

---

## What this is

- **Inputs:** Yahoo Finance (`yahoo-finance2`), SEC EDGAR XBRL (financial-statement extension), SEC EDGAR Form 4 (insider transactions), SEC EDGAR 13F-HR (institutional holdings), NASDAQ Screener API, OTC Markets (OTCQX / OTCQB / Expert).
- **Universe:** ~15 700 tickers as of HEAD. Auto-refreshed each run by `refresh-universe.js`; max bound `MAX_UNIVERSE=13000` env-default (the watchlist exceeds the cap because manual additions accumulate above it).
- **Outputs:** `screener.html`, `modes-report.html`, `dashboard.html`, `diff-report.html`, `methods-report.html`, `outputs/*.{html,csv,md}`. Deployed to the `gh-pages` branch.
- **Schedule:** Daily 02:00 UTC (`cron: '0 2 * * *'`) plus `workflow_dispatch`. Single workflow file: `.github/workflows/daily-pull.yml`.
- **Wall-clock per run:** 2.5–4 h (Yahoo pull dominates; `timeout-minutes: 240`).
- **Runtime:** Node 22 (`engines.node >=22`).

This is a discovery / screener tool. There is no portfolio tracking, no buy/sell signal, no broker integration. Picks are surfaced in HTML for human review.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                  .github/workflows/daily-pull.yml                   │
│                  (single cron job, ~30 sequential steps)            │
└────────────┬────────────────────────────────────────────────────────┘
             │
             ▼
┌────────────────────────────┐        ┌─────────────────────────────┐
│  refresh-universe.js       │        │  pull-yahoo.js              │
│  (Wikipedia + SEC + NASDAQ │───┐    │  (concurrency 8, rate 2000ms│
│   + OTC + Finnhub)         │   │    │   per worker, retries 15s/  │
│  → watchlist.json          │   │    │   45s)                      │
└────────────────────────────┘   │    │  → snapshots/*.json         │
                                 ├──▶ │    + snapshots/_manifest.json
┌────────────────────────────┐   │    └────────────┬────────────────┘
│  pull-sec-xbrl.js          │   │                 │
│  pull-historical-prices.js │   │                 ▼
│  pull-earnings-dates.js    │───┘    ┌─────────────────────────────┐
│  scripts/pull-13f-...js    │        │  methods/runner.js +        │
│  scripts/pull-insider-...js│        │  methods/index.js (registry)│
│  scripts/refresh-fx.js     │        │  → per-ticker × per-method  │
└────────────────────────────┘        │    pass/fail + raw value    │
                                      └────────────┬────────────────┘
                                                   │
                                                   ▼
                                      ┌─────────────────────────────┐
                                      │  methods/score-aggregator.js│
                                      │  + methods/strategy-modes.js│
                                      │  → mode score 0-100 +       │
                                      │    tier A/B/NEAR_MISS/REJECT│
                                      └────────────┬────────────────┘
                                                   │
        ┌──────────────────────────────────────────┼──────────────────┐
        ▼                                          ▼                  ▼
┌──────────────────┐   ┌────────────────────┐   ┌───────────────────────────┐
│ generate-        │   │ generate-modes-    │   │ snapshot-picks.js +       │
│ screener.js      │   │ report.js          │   │ snapshot-methods-history. │
│ → screener.html  │   │ → modes-report.html│   │ js → picks-history/,      │
│ (6-tab dashboard)│   │                    │   │   methods-history/        │
└──────────────────┘   └────────────────────┘   └───────────────────────────┘
                                                   │
                                                   ▼
                                      ┌─────────────────────────────┐
                                      │ scripts/walk-forward-perf.js│
                                      │ scripts/method-effectiveness│
                                      │ scripts/methodology-report  │
                                      │ scripts/pick-diff.js        │
                                      └─────────────────────────────┘
```

---

## Methods (~80)

Method modules live in `methods/`. Each file exports a uniform interface (`id`, `evaluate(ctx)` → `{ pass, value, computable, ... }`). The registry is `methods/index.js` (explicit allow-list; 83 entries). Type taxonomy in `methods/method-types.js`:

| Type           | Role                                                  | Examples                                                            |
|----------------|-------------------------------------------------------|---------------------------------------------------------------------|
| **CORE**       | Input to `score-aggregator` (modes weight these).     | `rule-of-40`, `roic`, `quality-compounder-roic`, `altman-z-score`   |
| **DIAGNOSTIC** | Context shown in detail modals; not in `SCORE_WEIGHTS`. Fixture-hash safe. | `beneish-m-score`, `ohlson-o-score`, `intangible-adjusted-roic`, `gross-profitability`, `analyst-upside` |
| **DATAGUARD**  | Hard-fail hygiene (excludes from picks before scoring). | `q-spike-dataguard`, `revenue-shock-guard`, `closed-end-trust-guard`, `r40-sanity-cap` |

**Fixture-hash invariant.** `tag28-tests.js` includes a regression test (`fixture-hash: score-aggregator output is stable`) that pins the exact aggregator output across a fixed fixture set. Any change to a method listed in `SCORE_WEIGHTS` mutates this hash and forces a deliberate test update. DIAGNOSTIC and DATAGUARD additions are by construction hash-safe (DATAGUARDs run before scoring; DIAGNOSTICs are not weighted). See `audit-reports/` Tag 211 for context.

---

## Strategy modes

Three modes are scored. Definition lives in `methods/score-aggregator.js` (`SCORE_WEIGHTS`) and `methods/strategy-modes.js` (eligibility filters):

### HYPERGROWTH
| Method                          | Weight |
|---------------------------------|--------|
| `rule-of-40`                    | 0.25   |
| `revenue-growth-3y`             | 0.25   |
| `profitability-state`           | 0.15   |
| `hypergrowth-quality-class`     | 0.15   |
| `rule-of-x`                     | 0.10   |
| `gross-margin-stability`        | 0.10   |

### QUALITY_COMPOUNDER
| Method                          | Weight |
|---------------------------------|--------|
| `quality-compounder-roic`       | 0.25   |
| `margin-quality`                | 0.20   |
| `earnings-stability`            | 0.15   |
| `reinvestment-rate`             | 0.15   |
| `net-debt-ebitda`               | 0.10   |
| `premium-compounder-proof`      | 0.05   |
| `fcf-yield`                     | 0.05   |
| `above-200d-ma`                 | 0.05   |

### TURNAROUND
| Method                          | Weight |
|---------------------------------|--------|
| `profitability-state`           | 0.25   |
| `profitability-trend`           | 0.25   |
| `altman-z-score`                | 0.20   |
| `piotroski-f-score`             | 0.15   |
| `revenue-growth-3y`             | 0.10   |
| `estimate-revision-proxy`       | 0.05   |

Tier thresholds: A ≥ 80, B 65–79, NEAR_MISS 50–64 (or ≥65 with a red flag), REJECT < 50. Two additional tabs in the dashboard (`SMALL`, `R40`, `PRE_BREAKOUT`, `WATCH`) are filter views over the mode output, not separate scoring stacks.

---

## The dashboard

`generate-screener.js` produces a single self-contained `screener.html` (Bloomberg-terminal-styled, no external assets). Features:

- Six tabs: `HG`, `QC`, `SMALL`, `R40`, `PRE_BREAKOUT`, `WATCH`.
- Dark / light theme toggle (`Tag 210f`).
- Command palette (`Ctrl+K` / `Cmd+K` / `/`) — keyboard-first navigation across tickers and tabs (`Tag 213c`).
- Sector heatmap tab: rows = sectors, columns = metric medians, cell colour = global percentile rank (`Tag 210g`).
- Per-ticker detail modal with ΔScore badges and sparkline (fed by `scripts/snapshot-score-history.js`, `Tag 203`).
- Sticky headers + column toggles + accessibility / keyboard shortcuts (`Tag 223b`).

Run with `AUDIT_SCORE_MULTIPLIERS=1` to enable q-spike-penalty + listing-age multipliers in the aggregator (scoped to the dashboard step in CI; un-multiplied scores are kept for picks-history and fixture-hash stability).

---

## Repository layout

```
.
├── .github/workflows/daily-pull.yml      # the one production workflow
├── pull-yahoo.js                          # main fundamentals + quote pull
├── pull-sec-xbrl.js                       # monthly SEC financial-statement extension
├── pull-historical-prices.js              # daily OHLCV
├── pull-earnings-dates.js                 # Yahoo earnings calendar
├── refresh-universe.js                    # ticker universe assembly
├── detect-changes.js                      # state-diff + Discord alerts
├── snapshot-picks.js                      # freeze daily picks for walk-forward
├── snapshot-methods-history.js            # freeze per-method pass-rates
├── generate-screener.js                   # Bloomberg-style 6-tab dashboard
├── generate-modes-report.js               # mode-grouped report
├── generate-dashboard.js                  # legacy dashboard
├── generate-diff-report.js                # vs-prior-run diff
├── generate-methods-report.js             # per-method matrix (legacy)
├── engine-v7.3.js                         # legacy scoring engine (DEPRECATED per ADR-001)
├── score-orchestrator.js                  # legacy orchestrator (DEPRECATED per ADR-001)
├── manipulation-filters.js                # sub-profile classifier (used by sector-medians-compute)
├── engine-cli-tests.js                    # pre-pull guard
├── tag21-tests.js / tag22-tests.js / tag28-tests.js  # test suites (155 tests at HEAD)
├── methods/
│   ├── index.js                           # registry (allow-list, 83 entries)
│   ├── method-types.js                    # CORE / DIAGNOSTIC / DATAGUARD taxonomy
│   ├── score-aggregator.js                # production scorer (SCORE_WEIGHTS)
│   ├── strategy-modes.js                  # mode eligibility filters
│   ├── runner.js                          # per-ticker evaluation loop
│   ├── sector-medians-compute.js          # auto-computed peer medians
│   └── *.js                               # individual methods
├── scripts/
│   ├── pull-insider-form4.js              # SEC EDGAR Form 4
│   ├── pull-13f-institutional.js          # SEC EDGAR 13F-HR
│   ├── refresh-fx.js                      # currency rates
│   ├── prune-watchlist.js                 # delist / stale-ticker prune
│   ├── snapshot-score-history.js          # 30-entry per-ticker score window
│   ├── walk-forward-perf.js               # picks × prices forward-return
│   ├── method-effectiveness.js            # per-method predictive power
│   ├── methodology-report.js              # walk-forward + effectiveness combined
│   ├── pick-diff.js                       # what's new, what's gone, why
│   ├── elliott-export.js                  # CSV export for downstream Elliott-Wave tool
│   ├── archive-old-snapshots.js           # NDJSON compaction (keep-days policy)
│   ├── picks-regression-check.js          # pick-count drift Discord alert
│   ├── check-pull-stats.js                # pull-output shrink Discord alert
│   ├── pipeline-health-check.js           # per-script failure-rate aggregator
│   ├── compute-method-drift.js            # sparkline data
│   └── macro-regime.js                    # SPY 200d-MA → BULL/BEAR/SIDEWAYS
├── snapshots/                             # per-ticker JSON + _manifest.json
├── picks-history/                         # daily picks freeze (90d retention)
├── methods-history/                       # per-method pass-rates (7d retention)
├── prices/                                # OHLCV history (14d retention)
├── score-history/                         # 30-entry rolling per-ticker score
├── external-data/                         # SEC, 13F, Form 4 caches (git-ignored bulk)
├── outputs/                               # pick-diff, methodology, Elliott CSV
├── audit-reports/                         # chronological audit log (48 reports as of Tag 222c)
├── docs/decisions/                        # ADRs (currently: ADR-001)
└── watchlist.json                         # the universe ({_meta, stocks:[…], lastUniverseRefresh})
```

---

## Running locally

Prereqs: Node 22+, `npm ci`.

```bash
# 1. Refresh the universe (Wikipedia + SEC + NASDAQ + OTC; optional Finnhub via env)
FINNHUB_API_KEY=... node refresh-universe.js --watchlist watchlist.json

# 2. Pull fundamentals (multi-hour for full 15k; use a trimmed watchlist for smoke tests)
node --max-old-space-size=6144 pull-yahoo.js \
  --watchlist watchlist.json --output snapshots --rate-limit 2000

# 3. Score + classify (no separate step — the generators score on the fly)
node generate-modes-report.js --snapshots snapshots --out modes-report.html
AUDIT_SCORE_MULTIPLIERS=1 node generate-screener.js \
  --snapshots snapshots --out screener.html

# 4. Daily snapshots (frozen for walk-forward)
node snapshot-picks.js --snapshots snapshots --out picks-history
node snapshot-methods-history.js --out methods-history

# 5. Post-run analytics
node scripts/walk-forward-perf.js
node scripts/method-effectiveness.js
node scripts/methodology-report.js
node scripts/pick-diff.js
```

The `daily-pull.yml` workflow is the canonical sequence — see it for the exact ordering, env vars, and continue-on-error semantics.

---

## Tests

```bash
node engine-cli-tests.js     # pre-pull guard (engine + orchestrator + filters)
node tag21-tests.js          # legacy engine regression
node tag22-tests.js          # mode-eligibility / classifier regression
node tag28-tests.js          # methods + score-aggregator + fixture-hash invariant
```

`tag28-tests.js` is the most-load-bearing test (155/155 passing at HEAD). Its `fixture-hash: score-aggregator output is stable` assertion is the production guardrail for accidental scoring drift.

---

## GitHub Actions configuration

| Secret               | Required | Purpose                                                         |
|----------------------|----------|-----------------------------------------------------------------|
| `FINNHUB_API_KEY`    | Optional | Augments universe discovery via Finnhub `/stock/symbol`         |
| `DISCORD_WEBHOOK`    | Optional | Pick-regression, pull-stats, pipeline-health, failure notifications |

If `DISCORD_WEBHOOK` is unset the workflow logs `"… not configured — alerts disabled"` and continues. `FINNHUB_API_KEY` absence narrows the discovered universe but does not fail the run.

**Repo permissions:** Settings → Actions → General → Workflow permissions → "Read and write permissions". Required for the bot commit + `gh-pages` deploy.

**GitHub Pages:** Settings → Pages → Source: "Deploy from branch" → `gh-pages` / `(root)`.

**Cron trigger model:** the workflow runs on `schedule` + `workflow_dispatch` only. **Pushes do not trigger it.** Local commits do not re-run the pipeline; manual dispatch from the Actions UI is the only ad-hoc trigger.

---

## Operational notes

- **Yahoo throttling.** `PULL_CONCURRENCY=8` + `--rate-limit 2000ms` per worker. Run #107 (Tag 215f) hit 7 210 rate-limit failures at concurrency 20; do not raise concurrency without re-validating against Yahoo's CDN-edge throttle.
- **Coverage gate.** `max(2500, floor(n_total * 0.18))` snapshots required for the pull step to pass. Falls back to `.json` file-count if the manifest is missing.
- **Snapshot freshness gate.** ≥50 % of snapshots must have `asOf` or `fetchedAt` < 36 h old. Hard-fail on breach (Tag 218).
- **Date-rollover safety.** All snapshot scripts honour `RUN_DATE_UTC` (frozen at job start) over `Date.now()` so a pull crossing UTC midnight produces consistent vintages.
- **Atomic writes.** Output scripts use `tmp + rename` (Tag 218b hardening).
- **Push race.** The commit step retries-with-rebase up to 3× against `main`. On rebase loss the just-made commit SHA is cherry-picked back (Tag 179, F-CI-001 v2).

---

## Architecture decisions

`docs/decisions/ADR-001-retire-track-a-b-scoring.md` documents the consolidation of the legacy `engine-v7.3` Track-A / Track-B stack onto `methods/score-aggregator.js`. Phases 2 (deprecation warnings) and 4 (registry allow-list) are landed; Phases 3 (test migration) and 5 (delete dead code) are deferred — see the ADR's Status Update section.

---

## Tag history

Development is tagged sequentially (`Tag NNN`, `Tag NNNa`, `Tag NNNb` …). Audits live in `audit-reports/YYYY-MM-DD-tagNNN<letter>-<scope>.md`. Most recent waves:

- Tag 217–221: code-quality audit cycles (older methods, scripts, workflows, schema, cross-method consistency, data integrity, core engine, report generators).
- Tag 222: performance audit + documentation audit + bug-hunt.
- Tag 223: 3 new DIAGNOSTIC methods (analyst-upside, earnings-surprise-momentum, institutional-density) leveraging Tag 219/220c persisted fields; a11y + perf round.

`PROJECT-STATUS.md` is a current-state snapshot capped at 100 lines. For chronological context, read `audit-reports/` in date order.

---

## License

Proprietary (private repo). No external contributors expected.
