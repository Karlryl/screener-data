# Market-Screener — Projekt-Kontext

> **Stabile** Projekt-Wahrheit & Prozesse. Dynamische, sich mit dem Code ändernde Fakten leben im Memory (`~/.claude/projects/…-screener-data/memory/`), **nicht** hier. Globale Person/Umgebung: `~/.claude/CLAUDE.md`. Keine Info zwischen den Ebenen duplizieren.

## Was das Projekt ist
Growth-/Qualitäts-**Screener** für Aktien. Repo `Karlryl/screener-data` (Branch `main`, GitHub-Pages-Deploy via Cron `17 2 * * 2-6`, Di–Sa 02:17 UTC). Verbindliche Engine-Leitplanken & Details: `README.md` und `docs/` im Repo (Source of Truth für Engine-Regeln). `CONTEXT.md` ist ein SUPERSEDED-markiertes historisches Resume-Briefing — keine Engine-Wahrheit mehr.

## Masterplan (erster Lese-Stopp) & bindende Arbeitsregeln
**Vor Arbeitsbeginn zuerst lesen:** der lebende Masterplan im Vault —
`…\Jarvis\Knowledge\Trading\growth-screener\_MASTERPLAN-screener-findash.md`
(Kopf-Block „Wo stehen wir gerade" + aktuelle Phase). Er ist Source of Truth für Reihenfolge, Status und Akzeptanz; hier **nicht** duplizieren.
- **Update-Ritual (G2):** nach jedem erledigten Task im Masterplan Kästchen abhaken, „Wo stehen wir"-Block aktualisieren, WORKLOG-Eintrag mit den **4 Pflichtteilen** (Was+Commit / Warum so entschieden / Fehler & Schwierigkeiten / Lektion). Verallgemeinerbare Lektionen zusätzlich als 1 Zeile ins **Lektionen-Register (Masterplan Abschnitt 6.0)** — das Register ist Pflicht-Lektüre vor Arbeitsbeginn.
- **Commit-Konvention (H2):** `Tag <n>: <Betreff>` — `n` = höchste `Tag`-Nummer aus `git log --oneline` + 1, ein Tag pro logischem Chunk.
- **Push & Melde-Pflicht (H3):** Push auf `main` erlaubt bei grünen Gates; **Force-Push / History-Rewrite / Löschen nie ohne Karl**. Was nicht gepusht werden konnte, am Session-Ende explizit an Karl melden.
- **Schutzliste (nie löschen/überschreiben):** `picks-history/`, `methods-history/`, `earnings-calendar.json`, Branch `loop/formel-haertung`. `picks-history/` ist darüber hinaus **inhaltlich eingefroren** (Stichtag 2026-07-02, Karl 2026-08-16, dauerhaft) — auch keine Korrektur, kein Backfill, kein Aufräum-Commit und keine „Reparatur" von Prüfskript-Meldungen; Details und Begründung in [`picks-history/_FROZEN.md`](./picks-history/_FROZEN.md). Nachfolger: `board-history/`.

## Kern-Designprinzip: NUR Qualität, nie Bewertung
Der Screener misst **bewusst ausschließlich fundamentale Qualität** — nie ob eine Aktie günstig/teuer ist. Bewertung sowie Entry/Exit-Timing macht Karl **extern über Elliott-Wellen-Analyse** (getrennter, menschlicher Schritt nach dem Screen).
- Jedes preisnormierte Signal (Yield, P/E, PEG, EV/EBITDA, DCF/Margin-of-Safety, Target-Upside, Preis-Momentum) im 0–100-Score ist ein **Mandats-Verstoß** → raus aus `SCORE_WEIGHTS`.
- **BUFFETT-Mode** (value+quality, DCF/MoS) wird entfernt (Karl-Entscheidung 2026-06-20).
- **Fitness-Gate-Spannung:** Das Fitness-Maß (`scripts/rank-ic.js`, Mess-Artefakte in `fitness/`) optimiert Forward-Return-Rank-IC und belohnt damit strukturell Cheapness — es zieht genau die verbotenen Bewertungssignale zurück. Sinkt die Fitness nach dem Entfernen von Bewertung: **erwartet und korrekt, NICHT durch Wieder-Einbau „reparieren".**

## Pflicht-Test-Gates (bindend nach jeder Methoden-/Scoring-Änderung)
Die alten Root-Gates (`tag28-tests.js`, `engine-cli-tests.js`, `tests/integration-anchor-test.js`) sind **entfernt**. Bindend ist der volle CI-Gate-Glob aus `.github/workflows/daily-pull.yml` (`GATE_GLOB`) — **`tests/*test.js`, `tests/scoring/*test.js`, `lib/*test.js`** (jede Datei ist ein Standalone-Runner: `node <datei>`, Exit 0/1). Nach jeder Scoring-/Methoden-Änderung die **komplette Suite** grün fahren — Anker u. a. `tests/scoring/anchors.fixture.test.js` (Fixture-Oracle), `score.integration.test.js`, `run-screener.test.js`.
```powershell
Get-ChildItem tests/*test.js,tests/scoring/*test.js,lib/*test.js | ForEach-Object { node $_.FullName; if ($LASTEXITCODE) { "FAIL: $($_.Name)" } }
```
Score-Methoden-Änderungen flippen den Fixture-Hash → das ist gewollt und der Nachweis. Quelle der Wahrheit: `GATE_GLOB` in `.github/workflows/daily-pull.yml`. (node/gh sind auf PATH — siehe globale `~/.claude/CLAUDE.md`.)

## Formel-Entwicklungs-Prozess (Gauntlet — Pflicht vor Promotion zu CORE)
Einheit = eine Formel pro GICS-Sub-Industry. Jede Idee MUSS durch:
1. **Recherche** (multi-agent, an Primärquellen/SEC-XBRL geerdet)
2. **Council** (`ask-the-council`) → Empfehlung + stärkste Verbesserungen, Formel verschärfen
3. **Court of Judgment** (`court-of-judgment`) → adversarialer Kill-Test, **immer maximale Härte (≥8, ~10 % Pass)**
4. Bei DENIED: Council-Revision → **Retrial bis PASS** — oder Limitation bewusst & dokumentiert akzeptieren
5. Nur **PASSED** wird promoted. Alles scharf argumentiert (Mechanik/Zahl/Kausalkette, kein Vibe).

Neue Methoden starten **DIAGNOSTIC** (fixture-hash-safe); Promotion zu CORE erst nach Walk-Forward-Beleg pro Sektor.

**Vorgelagerter Forschungs-Prozess (6.1, seit 16.07.2026):** neue Board-/Achsen-KANDIDATEN entstehen im
Ideen-Ledger `…\Jarvis\Knowledge\Trading\growth-screener\_IDEEN-LEDGER-2026-07-16.md`
(Deep-Research mit verifizierten Quellen → Ledger-Eintrag → Council-Schärfung → Court; nur PASS wird
Bau-Task im Masterplan, max. 1 Bau-Projekt gleichzeitig). Der Ledger PARKT nur — jede Promotion
Richtung Scoring/Board läuft zusätzlich den vollen Gauntlet oben und ist Karl-Queue-pflichtig.

## Härtungs-Loop & Source of Truth
Der laufende Formel-Härtungs-Loop liest **ZUERST** das Ledger:
**`…\Jarvis\Knowledge\Trading\growth-screener\screener-formel-ledger.md`** (Fitness-Gate, eingefrorene Baseline, ✅/❌/⚠️-Befunde mit Verifizierbarkeits-Befehlen, P0/P1/P2-Backlog, WORKLOG). Mess-Artefakte in `screener-data\fitness\`.
**Kein Kostenlimit** beim Loop (Karl, 2026-06-16): voll exhaustiv arbeiten — großer Fan-out, viele parallele/adversariale Subagenten, mehrere Verifikationsrunden erwünscht. Keine Kosten-Rückfragen.

## Wissensbasis / Recherche (getrennt vom Code)
Sektor-Dossiers (evidence-graded, englisch, zitiert) liegen im **Obsidian-Vault**
`C:\Users\Anwender\OneDrive\Dokumente\GitHub\Jarvis\Knowledge\Trading\growth-screener\` — **NICHT** im screener-data-Repo. Hub: `growth-screener-knowledge-base`, verlinkt mit `elliott-wellen-referenz`.

## Engineering-Regeln für Multi-Agent-Arbeit
- **Nie shared Registry-Files parallel editieren:** `src/scoring/formulas/index.js`, `src/scoring/formulas/quality/index.js`, `src/scoring/score.js` → Write-Races. Stattdessen Coordinator-Pattern (ein Agent besitzt die Registry) **oder** in Wellen von 1–2 serialisieren. Kollisionsfrei parallel: neue `src/scoring/formulas/<sector>.js`, Per-Cycle-Audit-Reports.
- **`git commit` ohne Pathspec staged ALLES** (auch Dateien laufender Agenten) → vor Commit `git status --short`, dann gezielt `git commit -- <pfade>`.
- **`/audit`-Zyklen:** 5 general-purpose-Agenten parallel in **einer** Nachricht, dann je Output als `Tag NNNa-e` committen; Zyklus endet mit `audit-reports/YYYY-MM-DD-tagNNN-cycle.md` (+ Next-Cycle-Prioritäten → Loop bleibt selbst-tragend). `.claude/commands/audit.md` ist ein SUPERSEDED-markiertes altes Verfahren gegen entfernte Architektur — nicht wörtlich ausführen.

## Fallen
- **`GitHub\screener-data-fix`** = eingefrorene Kopie/Ex-Worktree (18.05.2026) — **nicht anfassen**.
- **`GitHub\docGPT`** = totes Fremd-Repo (zum Löschen markiert) — nie als Workspace nutzen.


## Zwei-Motoren-Betrieb (Codex) — Anker (2026-07-16)

- **Delegations-Default:** Fix-Loops mit vielen Iterationen, Chart-/Render-Iterationen und Bulk-Mechanik gehen an Codex (Skill `codex-delegieren`) — Selbermachen ist dort die begründungspflichtige Ausnahme (1 Log-Zeile). NIE delegieren: Scoring/Gauntlet/Methodik/Architektur — das schlägt auch einen „codex:"-Zwang von Karl (in 1 Zeile erklären, selbst machen).
- **Vor jeder Schreibarbeit:** Delegations-Lock prüfen (`%USERPROFILE%\.codex\delegation-locks\<repo>.lock.json`). Aktiv/pending → nicht ins Repo schreiben; Krisenpfad steht im Skill. Commits `WIP (Codex, ungereviewt)` zuerst reviewen (`git reset --soft HEAD~1`, dann richtig committen).
