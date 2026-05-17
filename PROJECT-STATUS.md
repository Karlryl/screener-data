# Project Status — screener-data

**Last Update:** 2026-05-17 — **Tag 223 era.** Daily-cron discovery pipeline over ~15 700 tickers.

> For full context see `README.md`. For chronological history read `audit-reports/` in date order. This file is a state snapshot, capped at 100 lines.

## Current state

- **Universe:** 15 734 tickers in `watchlist.json` (`{_meta, stocks:[…], lastUniverseRefresh, lastManualExpansion}` schema since Tag 207a).
- **Methods registry:** 83 entries in `methods/index.js`; 79 typed in `methods/method-types.js` (CORE / DIAGNOSTIC / DATAGUARD). `methods/disabled/` does not exist (removed per ADR-001 Phase 2).
- **Production scorer:** `methods/score-aggregator.js` (`SCORE_WEIGHTS` for HYPERGROWTH / QUALITY_COMPOUNDER / TURNAROUND). Tier taxonomy A / B / NEAR_MISS / REJECT.
- **Legacy scorer:** `engine-v7.3.js` + `score-orchestrator.js` are deprecated but not deleted (Phase 3 / Phase 5 deferred — see ADR-001 status update). Still invoked by `engine-cli-tests.js` pre-pull guard.
- **Cron:** daily `'0 2 * * *'` UTC. Wall-clock per run 2.5–4 h. `timeout-minutes: 240`.
- **Tests:** 155/155 passing (`tag28-tests.js`) at HEAD; includes the fixture-hash invariant guarding aggregator drift.

## Pipeline outputs (HTML)

- `screener.html` — Bloomberg-style 6-tab dashboard (HG / QC / SMALL / R40 / PRE_BREAKOUT / WATCH); light-theme toggle; command palette `Ctrl+K`; sector heatmap; per-ticker detail modal with ΔScore sparkline.
- `modes-report.html` — mode-grouped report (primary user-facing artifact).
- `dashboard.html`, `diff-report.html`, `methods-report.html` — legacy / secondary reports.
- `outputs/*.{html,csv,md}` — pick-diff, methodology, Elliott-Wave CSV export.

All five HTML artifacts and the `outputs/` tree are deployed to the `gh-pages` branch each successful run.

## Pull / analytics scripts

| Script                                  | Cadence | Purpose                                              |
|-----------------------------------------|---------|------------------------------------------------------|
| `pull-yahoo.js`                          | daily   | Fundamentals + quotes (concurrency 8, rate 2000ms)   |
| `pull-historical-prices.js`              | daily   | OHLCV history                                        |
| `pull-earnings-dates.js`                 | daily   | Earnings calendar                                    |
| `pull-sec-xbrl.js`                       | monthly | SEC financial-statement extension                    |
| `scripts/pull-13f-institutional.js`      | quarterly | SEC 13F-HR institutional holdings                  |
| `scripts/pull-insider-form4.js`          | daily   | SEC Form 4 insider transactions                      |
| `scripts/refresh-fx.js`                  | daily   | Currency rates                                       |
| `refresh-universe.js`                    | daily   | Wikipedia + SEC + NASDAQ + OTC + Finnhub             |
| `scripts/prune-watchlist.js`             | daily   | Delist / stale-ticker prune                          |
| `snapshot-picks.js`                      | daily   | Freeze daily picks (90d retention)                   |
| `snapshot-methods-history.js`            | daily   | Freeze per-method pass rates (7d retention)          |
| `scripts/snapshot-score-history.js`      | daily   | 30-entry rolling per-ticker score                    |
| `scripts/walk-forward-perf.js`           | daily   | Picks × prices forward-return α                      |
| `scripts/method-effectiveness.js`        | daily   | Per-method predictive power                          |
| `scripts/methodology-report.js`          | daily   | Walk-forward + effectiveness combined                |
| `scripts/pick-diff.js`                   | daily   | What's new, what's gone, why                         |
| `scripts/elliott-export.js`              | daily   | CSV for downstream Elliott-Wave tool                 |
| `scripts/archive-old-snapshots.js`       | daily   | NDJSON compaction (keep-days policy)                 |
| `scripts/picks-regression-check.js`      | daily   | Pick-count drift Discord alert                       |
| `scripts/check-pull-stats.js`            | daily   | Pull-output shrink Discord alert                     |
| `scripts/pipeline-health-check.js`       | daily   | Per-script failure-rate aggregator                   |
| `scripts/compute-method-drift.js`        | daily   | Sparkline data                                       |
| `scripts/macro-regime.js`                | daily   | SPY 200d-MA → BULL/BEAR/SIDEWAYS                     |

## Open architectural debt

- **ADR-001 Phase 3** (migrate `engine-cli-tests.js` to `score-aggregator`, delete `scoreTrackA`/`scoreTrackB`): not executed.
- **ADR-001 Phase 5** (delete `score-orchestrator.js`, `diagnose-spec.js`): not executed. Both files are still present, neither carries a deprecation marker.
- **Tag 221a data-integrity** CRITICALs C1 (Tag 211l schema not yet deployed in pull-yahoo), C2 (`external-data/aktienfinder.json={}`), C3 (2026-05-12 date gap): tracked but deferred — partially closed by Tag 222b.
- **Beneish / Ohlson** methods: registered but `computable=false` on all snapshots until pull-yahoo extends balance-sheet / IS coverage (AR / PPE / CL / LTD / SGA / Dep / OCF).

## Where to read more

- `README.md` — architecture, modes, methods taxonomy, run instructions.
- `docs/decisions/ADR-001-retire-track-a-b-scoring.md` — scoring-stack consolidation rationale + current status.
- `audit-reports/` — 48 chronological audit reports (2026-05-14 → 2026-05-17). The directory tells the actual story of Tag 75 → Tag 223.
- `.github/workflows/daily-pull.yml` — the canonical operational sequence; comments document every Tag-level change.
