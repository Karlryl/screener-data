# Market-Screener — Projekt-Kontext

> **Stabile** Projekt-Wahrheit & Prozesse. Dynamische, sich mit dem Code ändernde Fakten leben im Memory (`~/.claude/projects/…-screener-data/memory/`), **nicht** hier. Globale Person/Umgebung: `~/.claude/CLAUDE.md`. Keine Info zwischen den Ebenen duplizieren.

## Was das Projekt ist
Growth-/Qualitäts-**Screener** für Aktien. Repo `Karlryl/screener-data` (Branch `main`, GitHub-Pages-Deploy via täglichem Cron 02:00 UTC). Verbindliche Engine-Leitplanken & Details: **`CONTEXT.md`** und `docs/` im Repo (Source of Truth für Engine-Regeln).

## Kern-Designprinzip: NUR Qualität, nie Bewertung
Der Screener misst **bewusst ausschließlich fundamentale Qualität** — nie ob eine Aktie günstig/teuer ist. Bewertung sowie Entry/Exit-Timing macht Karl **extern über Elliott-Wellen-Analyse** (getrennter, menschlicher Schritt nach dem Screen).
- Jedes preisnormierte Signal (Yield, P/E, PEG, EV/EBITDA, DCF/Margin-of-Safety, Target-Upside, Preis-Momentum) im 0–100-Score ist ein **Mandats-Verstoß** → raus aus `SCORE_WEIGHTS`.
- **BUFFETT-Mode** (value+quality, DCF/MoS) wird entfernt (Karl-Entscheidung 2026-06-20).
- **Fitness-Gate-Spannung:** Das Fitness-Maß (`fitness/measure.js`) optimiert Forward-Return-Rank-IC und belohnt damit strukturell Cheapness — es zieht genau die verbotenen Bewertungssignale zurück. Sinkt die Fitness nach dem Entfernen von Bewertung: **erwartet und korrekt, NICHT durch Wieder-Einbau „reparieren".**

## Pflicht-Test-Gates (bindend nach jeder Methoden-/Scoring-Änderung)
```
node tag28-tests.js                      # Fixture-Hash (Test-Oracle)
node engine-cli-tests.js
node tests/integration-anchor-test.js    # 10 Anchors müssen PASS bleiben
```
Score-Methoden-Änderungen flippen den Fixture-Hash → das ist gewollt und der Nachweis. Quelle: `CONTEXT.md`. (node/gh sind auf PATH — siehe globale `~/.claude/CLAUDE.md`.)

## Formel-Entwicklungs-Prozess (Gauntlet — Pflicht vor Promotion zu CORE)
Einheit = eine Formel pro GICS-Sub-Industry. Jede Idee MUSS durch:
1. **Recherche** (multi-agent, an Primärquellen/SEC-XBRL geerdet)
2. **Council** (`ask-the-council`) → Empfehlung + stärkste Verbesserungen, Formel verschärfen
3. **Court of Judgment** (`court-of-judgment`) → adversarialer Kill-Test, **immer maximale Härte (≥8, ~10 % Pass)**
4. Bei DENIED: Council-Revision → **Retrial bis PASS** — oder Limitation bewusst & dokumentiert akzeptieren
5. Nur **PASSED** wird promoted. Alles scharf argumentiert (Mechanik/Zahl/Kausalkette, kein Vibe).

Neue Methoden starten **DIAGNOSTIC** (fixture-hash-safe); Promotion zu CORE erst nach Walk-Forward-Beleg pro Sektor.

## Härtungs-Loop & Source of Truth
Der laufende Formel-Härtungs-Loop liest **ZUERST** das Ledger:
**`…\Jarvis\Knowledge\Trading\growth-screener\screener-formel-ledger.md`** (Fitness-Gate, eingefrorene Baseline, ✅/❌/⚠️-Befunde mit Verifizierbarkeits-Befehlen, P0/P1/P2-Backlog, WORKLOG). Mess-Artefakte in `screener-data\fitness\`.
**Kein Kostenlimit** beim Loop (Karl, 2026-06-16): voll exhaustiv arbeiten — großer Fan-out, viele parallele/adversariale Subagenten, mehrere Verifikationsrunden erwünscht. Keine Kosten-Rückfragen.

## Wissensbasis / Recherche (getrennt vom Code)
Sektor-Dossiers (evidence-graded, englisch, zitiert) liegen im **Obsidian-Vault**
`C:\Users\Karlr\OneDrive\Dokumente\GitHub\Jarvis\Knowledge\Trading\growth-screener\` — **NICHT** im screener-data-Repo. Hub: `growth-screener-knowledge-base`, verlinkt mit `elliott-wellen-referenz`.

## Engineering-Regeln für Multi-Agent-Arbeit
- **Nie shared Registry-Files parallel editieren:** `methods/index.js`, `methods/method-types.js`, `tag28-tests.js`, `methods/score-aggregator.js` → Write-Races. Stattdessen Coordinator-Pattern (ein Agent besitzt die Registry) **oder** in Wellen von 1–2 serialisieren. Kollisionsfrei parallel: neue `methods/<name>.js`, Per-Cycle-Audit-Reports.
- **`git commit` ohne Pathspec staged ALLES** (auch Dateien laufender Agenten) → vor Commit `git status --short`, dann gezielt `git commit -- <pfade>`.
- **`/audit`-Zyklen:** 5 general-purpose-Agenten parallel in **einer** Nachricht, dann je Output als `Tag NNNa-e` committen; Zyklus endet mit `audit-reports/YYYY-MM-DD-tagNNN-cycle.md` (+ Next-Cycle-Prioritäten → Loop bleibt selbst-tragend).

## Fallen
- **`GitHub\screener-data-fix`** = eingefrorene Kopie/Ex-Worktree (18.05.2026) — **nicht anfassen**.
- **`GitHub\docGPT`** = totes Fremd-Repo (zum Löschen markiert) — nie als Workspace nutzen.
