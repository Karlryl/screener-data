# Project Status — Karl's Stock-Screener

**Last Update:** 2026-05-07 — Tag 53 done, Tag 54-60 pending

## Aktueller Stand

- **70 Stocks** in der Watchlist (kein Position-Tracking)
- **18 Methoden** parallel laufend, alle isoliert
- **Pipeline autonom** via GitHub Actions wöchentlich (Mo 08:00 UTC)
- **Workflow** läuft in ~3-6 Min: Engine-Tests → Yahoo-Pull → Methods-Report → Methods-History-Snapshot → Price-Pull
- **Sektor-relative Schwellen** für ROIC + FCF-Yield bei 6 Sub-Profile

## Aktive Methoden (13)

| # | ID | Threshold | Type |
|---|---|---|---|
| 1 | rule-of-40 | ≥ 40 | Hypergrowth |
| 2 | rule-of-x | ≥ 60 | Hypergrowth (Bessemer) |
| 3 | roic | ≥ 15% (sektor-relativ) | Quality |
| 4 | net-debt-ebitda | ≤ 3 | Solvenz |
| 5 | sloan-ratio | \|·\| ≤ 10% | Bullshit-Detektor |
| 6 | revenue-growth-3y | ≥ 25% CAGR | Hypergrowth |
| 7 | fcf-yield | ≥ 5% (sektor-relativ) | Bewertung |
| 8 | gross-margin-stability | CoV ≤ 10% | Quality |
| 9 | asset-growth-divergence | ≤ 1.5 | Bullshit-Detektor |
| 10 | margin-decay | GMI ≤ 1.10 | Bullshit-Detektor |
| 11 | sbc-revenue | ≤ 15% | Verwässerungs-Detektor |
| 12 | capex-trend | ≤ 1.5 | Cash-Burn-Frühwarn |
| 13 | working-capital-anomaly | ≤ 1.3 | Manipulation-Detektor |

## Roadmap Tag 46-60

| Tag | Was | Status |
|---|---|---|
| 46 | ROCE-Methode (EU-Standard) | ✓ done |
| 47 | Magic-Formula-Combined (Greenblatt) | ✓ done |
| 48 | Aktienfinder-Score-CSV-Helper | ✓ done |
| 49 | Sektor-Median-Auto-Compute | ✓ done |
| 50 | Watchlist-Diff-Detector | ✓ done |
| 51 | Forward-PE-Methode | ✓ done |
| 52 | TTM-Variants — Yahoo limitiert, skip mit Doku | ⊘ skip |
| 53 | Multi-Year-Stability-Score | ✓ done |
| 54 | PEG-Methode | pending |
| 55 | EV/EBITDA-Methode | pending |
| 56 | Insider-Ownership (wenn Yahoo liefert) | pending |
| 57 | Performance-Tracker 90d | pending |
| 58 | Method-Correlation-Analyse | pending |
| 59 | Threshold-Tuning-Tool | pending |
| 60 | Status-Recap + Roadmap-Refresh | pending |

## Wichtige Files

- `methods/` — 13 Plugin-Modules + runner + helpers + sector-medians + trend
- `pull-yahoo.js` — Yahoo-Pull (quoteSummary + fundamentalsTimeSeries)
- `pull-historical-prices.js` — Closing-Prices für Backtest
- `detect-changes.js` — Method-Pass-Fail-Tracking + alert-state
- `generate-methods-report.js` — HTML-Matrix-Report
- `snapshot-methods-history.js` — kumulative History
- `backtest-pass-vs-fail.js` — Performance-Backtest (braucht 4+ Wochen Daten)
- `watchlist-cli.js` — CLI für Watchlist-Verwaltung
- `history-cli.js` — Stock-History-Lookup
- `engine-cli-tests.js` + `tag21-tests.js` + `tag22-tests.js` + `tag28-tests.js` — Test-Suite
- `engine-v7.3.js` + `score-orchestrator.js` + `manipulation-filters.js` — legacy (für Sub-Profile-Detection)
- `.github/workflows/daily-pull.yml` — Cron-Workflow

## Zwischenspeicherung

Jeder Tag wird sofort committed + gepusht. Bei Session-Abbruch:
1. Neue Session öffnen
2. Diese Datei lesen für Stand
3. `git clone` + `cd screener-data` + weiter machen ab nächstem pending-Tag

PAT (in der Cowork-Session-Memory; gültig bis 2026-06-06).

