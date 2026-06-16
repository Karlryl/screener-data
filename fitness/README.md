# fitness/ — Erfolgs-Maß-Artefakte (Fitness Gate)

Dieser Ordner hält die VORAB-registrierten Mess-Artefakte des Härtungs-Loops, GETRENNT von den alt-vorhandenen lookahead-biased `backtest-*.js` Skripten im Repo-Root.

- `baselines/` — eingefrorene, unveränderliche Ranking-Baselines. Jede committete Formel-Version friert hier ihr Top/Bottom-Ranking + evaluatedTickers ein. Nie editieren — nur neue Dateien anlegen.
- Mess-Harness (folgt in Iteration 1): liest eine Baseline + Forward-Preise → Rank-IC + Top-minus-Universe-Median-Spread bei 28d/84d.

WARUM getrennt: Die Root-`backtest-*.js` werten Methoden auf HEUTIGEM Snapshot aus und messen Renditen rückwirkend (`_bias.lookAheadBias:true`). Der ehrliche Pfad ist `scripts/walk-forward-perf.js` (stored pass flags, kein Lookahead) — aber er braucht frische Preise (history.json endet 2026-05-17).

Stand 2026-06-16: erste Baseline `saas-v1.0-degraded-2026-06-16.json` eingefroren (44 SaaS-Namen). Preis-Anker t0 noch PENDING.
