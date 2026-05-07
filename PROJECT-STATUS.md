# Project Status — Karl's Stock-Screener

**Last Update:** 2026-05-07 — **Tag 75 erreicht.** 23 aktive Methoden + 4 disabled (im Repo erhalten).

## Aktueller Stand

- **70 Stocks** Watchlist (kein Position-Tracking, kein Buy-Signal)
- **23 Methoden** parallel, alle isoliert (kein Aggregat-Score)
- **Pipeline autonom** via GitHub Actions wöchentlich (Mo 08:00 UTC) + manuelle Trigger via PAT
- **Workflow** läuft in ~5-10 Min: Engine-Tests → Yahoo-Pull → Sektor-Median-Auto → Earnings-Calendar → Methods-Report → Diff-Report → Methods-History-Snapshot → Price-Pull
- **Sektor-relative Schwellen** für ROIC + FCF-Yield bei 6 Sub-Profile

## Aktive Methoden (23)

### Hypergrowth & Wachstum (5)
rule-of-40, revenue-growth-3y, multi-year-stability, quarterly-rev-acceleration, above-200d-ma

### Quality (5)
roic, gross-margin-stability, aktienfinder-quality, multi-year-stability, opinc-margin-spike

### Bewertung (4)
fcf-yield, forward-pe, peg, ev-ebitda

### Solvenz/Manipulation-Detektoren (7)
net-debt-ebitda, sloan-ratio, margin-decay, sbc-revenue, capex-trend, working-capital-anomaly, opinc-margin-spike

### Skin-in-the-Game (1)
insider-ownership

### Price/Trend (4)
drawdown-52w, high-proximity-52w, volatility-annualized, above-200d-ma

(Note: einige Methoden sind bewusst in mehreren Kategorien)

## Disabled Methoden (4, in methods/disabled/)

rule-of-x, roce, magic-formula, asset-growth-divergence — Tag 61 wegen Korrelation > 0.8 mit aktiven Methoden auskommentiert. Reaktivierung trivial via mv + runner.js-Edit.

## CLI-Tools

| Tool | Zweck |
|---|---|
| `watchlist-cli.js list/add/remove/info/import/export` | Watchlist-Verwaltung |
| `methods-cli.js list/describe ID` | Methoden-Übersicht + Live-Stats |
| `history-cli.js TICKER` | Werte-History pro Stock |
| `tune-threshold.js METHOD-ID` | Pass-Count bei verschiedenen Thresholds |
| `analyze-correlation.js` | Method-Correlation-Matrix |
| `aktienfinder-import.js path/csv` | Aktienfinder-Score-Import |
| `earnings-cli.js [--days N]` | Stocks mit Earnings in next N Tagen |
| `sector-trends.js` | Sektor-Pass-Rate über Zeit |
| `suggest-watchlist-additions.js` | Universe-Scanner (Stocks die ≥N/23 pass aber nicht in WL) |
| `suggest-watchlist-cleanup.js` | Stocks vorschlagen die konstant niedrig pass-en |
| `backtest-pass-vs-fail.js` | Performance-Backtest 30d + 90d |
| `methods/sector-medians-compute.js` | Sektor-Median-Auto-Compute |

## Reports (HTML)

- `methods-report.html` — Hauptreport mit Sektor-Distribution, Top-Picks-Ranking, Pass-Count-Quick-Filter, Filter-Presets, Modal-Detail-View, Mobile-Responsive
- `diff-report.html` — Diff vs. vorigem Run (Pass-Count-Changes, Werte-Changes ≥20%)

## Wichtige Files

- `methods/` — 23 active modules + 4 disabled + runner + helpers + sector-medians (hardcoded + auto) + trend
- `pull-yahoo.js` — Yahoo-Pull (quoteSummary + fundamentalsTimeSeries: financials + cash-flow + balance-sheet)
- `pull-historical-prices.js` — Closing-Prices für Backtest
- `pull-earnings-dates.js` — Earnings-Calendar-Pull
- `detect-changes.js` — Method-Pass-Fail-Tracking + alert-state + methodHistory + field-coverage
- `generate-methods-report.js` — Hauptreport mit Mobile-Responsive
- `generate-diff-report.js` — Diff-vs-previous-Run
- `snapshot-methods-history.js` — kumulative History
- `engine-cli-tests.js` + `tag21-tests.js` + `tag22-tests.js` + `tag28-tests.js` — Test-Suite (~40 tests)
- `engine-v7.3.js` + `score-orchestrator.js` + `manipulation-filters.js` — legacy (genutzt für Sub-Profile-Detection)
- `.github/workflows/daily-pull.yml` — Cron-Workflow

## Tag 21-75 Bilanz

55 Tage Code, 23 aktive Methoden, 12 CLI-Tools, 2 HTML-Reports, autonome wöchentliche Pipeline. Karl hat in dieser Zeit 0 manuelle GitHub-Klicks gemacht — alles via PAT.

Highlights:
- Tag 28 Architektur-Pivot: weg von Aggregat-Score → Plugin-System
- Tag 49 Sektor-Median-Auto-Compute (Council Counter#3-Antwort)
- Tag 58 Method-Correlation-Audit + Tag 61 Konsolidierung 21→17→23 (mit Re-Erweiterung um Trend-Methoden)
- Tag 66-70 Price-basierte Methoden (drawdown, high-proximity, volatility, 200d-MA, quarterly-acceleration)

## Mögliche Tag 76+ Roadmap

- **Backtest-Auswertung** sobald 4-12 Wochen Daten gesammelt sind (aktuell nur 1-2 Datenpunkte)
- **Branch-Score-Analyse**: Stocks die in Hypergrowth-Subset top sind aber Quality-Subset durchfallen
- **Methods-Effectiveness-Audit**: nach 3 Monaten — welche Methoden haben tatsächlich predictive power gezeigt?
- **News/Earnings-Calls-Integration** wenn Karl externe API-Source besorgt
- **Multi-Source-Layer (Finnhub Backup)** wenn Yahoo-Drift ein konkretes Problem wird
- **Watchlist-Erweiterung auf 200+ stocks** wenn Pipeline-Performance es erlaubt

## Zwischenspeicherung-Anker

Jeder Tag committed + gepusht. Bei Session-Abbruch: neue Session öffnen, diese Datei lesen, `git clone` mit existierendem PAT (in Cowork-Memory), weiter ab nächstem pending-Tag.
