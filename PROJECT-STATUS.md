# Project Status — Karl's Stock-Screener

**Last Update:** 2026-05-07 — Tag 61 done. 17 Methoden konsolidiert (von 21).

## Aktueller Stand

- **70 Stocks** in der Watchlist (kein Position-Tracking, kein Buy-Signal-Layer)
- **22 Methoden** (4 disabled in methods/disabled/) parallel, alle isoliert (kein Aggregat-Score)
- **Pipeline autonom** via GitHub Actions wöchentlich (Mo 08:00 UTC) + manuelle Trigger
- **Workflow** läuft in ~3-7 Min: Engine-Tests → Yahoo-Pull → Sektor-Median-Auto-Compute → Methods-Report → Methods-History-Snapshot → Price-Pull → Diff-Report
- **Sektor-relative Schwellen** für ROIC + ROCE + FCF-Yield bei 6 Sub-Profile (auto-computed wenn ≥5 stocks/sektor, sonst hardcoded)

## Aktive Methoden (21)

### Hypergrowth (4)
- rule-of-40, rule-of-x, revenue-growth-3y, multi-year-stability

### Quality (5)
- roic, roce, gross-margin-stability, magic-formula, aktienfinder-quality

### Bewertung (4)
- fcf-yield, forward-pe, peg, ev-ebitda

### Solvenz/Manipulation-Detektoren (7)
- net-debt-ebitda, sloan-ratio, asset-growth-divergence, margin-decay, sbc-revenue, capex-trend, working-capital-anomaly

### Skin-in-the-Game (1)
- insider-ownership

## Tools (CLI)

- `node watchlist-cli.js list/add/remove/info` — Watchlist-Verwaltung
- `node history-cli.js TICKER` — Methoden-Werte über Zeit für einen Stock
- `node tune-threshold.js METHOD-ID` — Pass-Count-Sweep um optimale Schwelle zu finden
- `node analyze-correlation.js` — Method-Correlation-Matrix (Redundanzen finden)
- `node aktienfinder-import.js path/to/csv` — Aktienfinder-Score CSV-Import
- `node backtest-pass-vs-fail.js` — Performance-Backtest (30d + 90d)
- `node methods/sector-medians-compute.js ./snapshots` — Sektor-Median-Auto

## Reports (HTML)

- `methods-report.html` — Methoden-Matrix mit Sektor-Distribution, Top-Picks-Ranking, Pass-Count-Quick-Filter, Filter-Presets, Modal-Detail-View
- `diff-report.html` — Watchlist-Diff vs. vorigem Run (Pass-Count-Wechsel, Werte-Changes ≥20%)

## Ergebnisse Tag 46-60

Tag 46 ROCE ✓ · Tag 47 Magic Formula ✓ · Tag 48 Aktienfinder-Helper ✓ · Tag 49 Sektor-Median-Auto ✓ · Tag 50 Watchlist-Diff ✓ · Tag 51 Forward-PE ✓ · Tag 52 TTM skip (Yahoo-limit) · Tag 53 Multi-Year-Stability ✓ · Tag 54 PEG ✓ · Tag 55 EV/EBITDA ✓ · Tag 56 Insider-Ownership ✓ · Tag 57 Performance-Tracker dual-horizon ✓ · Tag 58 Method-Correlation ✓ · Tag 59 Threshold-Tuning-CLI ✓ · Tag 60 Status-Recap ✓

## Bekannte Korrelationen (von Tag 58)

- rule-of-40 ↔ rule-of-x: r=0.97 (erwartet)
- roic ↔ roce: r=0.93 (erwartet)
- fcf-yield ↔ magic-formula: r=0.88
- asset-growth-divergence ↔ working-capital-anomaly: r=0.84

→ wenn Karl Methoden-Anzahl reduzieren will: 1 aus jedem Pair behalten = 17 statt 21.

## Wichtige Files

- `methods/` — 21 Plugin-Modules + runner + helpers + sector-medians (hardcoded + auto) + trend
- `pull-yahoo.js` — Yahoo-Pull (quoteSummary + fundamentalsTimeSeries: financials + cash-flow + balance-sheet)
- `pull-historical-prices.js` — Closing-Prices für Backtest
- `detect-changes.js` — Method-Pass-Fail-Tracking + alert-state + methodHistory
- `generate-methods-report.js` — HTML-Matrix-Report
- `generate-diff-report.js` — Diff-vs-previous-Run
- `snapshot-methods-history.js` — kumulative History
- `backtest-pass-vs-fail.js` — Performance-Backtest dual-horizon
- `analyze-correlation.js` + `tune-threshold.js` — Analyse-Tools
- `watchlist-cli.js` + `history-cli.js` + `aktienfinder-import.js` — User-Tools
- `engine-cli-tests.js` + `tag21-tests.js` + `tag22-tests.js` + `tag28-tests.js` — Test-Suite (20+ tests)
- `engine-v7.3.js` + `score-orchestrator.js` + `manipulation-filters.js` — legacy (für Sub-Profile-Detection)
- `.github/workflows/daily-pull.yml` — Cron-Workflow

## Mögliche Tag 61-75 Roadmap

| Tag | Idee |
|---|---|
| 61 | Methoden-Redundanz-Cleanup: Karl entscheidet welche aus den 4 corr-Pairs raus |
| 62 | Watchlist-Wachstums-Vorschläge: aus S&P500 stocks finden die ≥7/21 pass aber nicht in WL |
| 63 | Earnings-Calendar Helper | ✓ done |
| 64 | Quarterly-Rev-Acceleration | ✓ done |
| 65 | Methods-Report Mobile-Responsive | ✓ done |
| 66 | Drawdown-52w | ✓ done |
| 67 | 52w-High-Proximity | ✓ done |
| 68 | Volatility-Annualized | ✓ done |
| 69 | Watchlist CSV Bulk-Import/Export | ✓ done |
| 70 | Above-200d-MA | ✓ done |
| 71-75 | offen's Bedürfnissen |

## Zwischenspeicherung

Jeder Tag wird sofort committed + gepusht. Bei Session-Abbruch:
1. Neue Session öffnen
2. Diese Datei lesen für Stand
3. `git clone` mit dem vorhandenen PAT (in Cowork-Memory) + weiter ab nächstem pending-Tag
