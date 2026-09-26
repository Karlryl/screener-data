# Market-Screener — Projekt-Kontext

> **Stabile** Projekt-Wahrheit & Prozesse. Dynamische, sich mit dem Code ändernde Fakten leben im Memory (`~/.claude/projects/…-screener-data/memory/`), **nicht** hier. Globale Person/Umgebung: `~/.claude/CLAUDE.md`. Keine Info zwischen den Ebenen duplizieren.

## Was das Projekt ist
Growth-/Qualitäts-**Screener** für Aktien. Repo `Karlryl/screener-data` (Branch `main`, GitHub-Pages-Deploy via Cron `17 2 * * 2-6`, Di–Sa 02:17 UTC). Verbindliche Engine-Leitplanken & Details: `README.md` und `docs/` im Repo (Source of Truth für Engine-Regeln). `CONTEXT.md` ist ein SUPERSEDED-markiertes historisches Resume-Briefing — keine Engine-Wahrheit mehr.

## Regelblatt, Einstieg (erster Lese-Stopp) & bindende Arbeitsregeln
**Bindend (Karl 26.09.2026):** `C:\Users\Anwender\OneDrive\Dokumente\GitHub\karl-plan\REGELBLATT-v4.md` — gilt für Claude, Codex und jede Automatik; ältere Fassungen sind Geschichte, bei Widerspruch gewinnt das Regelblatt. Vor Arbeitsbeginn zuerst lesen.
**Vault-Einstieg (Source of Truth im Vault):** `C:\Users\Anwender\OneDrive\Dokumente\GitHub\Jarvis\Knowledge\Trading\growth-screener\START.md`.
Reihenfolge und Status: `C:\Users\Anwender\OneDrive\Dokumente\GitHub\karl-plan\WUNSCHLISTE.md` (neue Zeilen/Reihenfolge nur durch Karl). Der Vault-Masterplan (`…\growth-screener\_MASTERPLAN-screener-findash.md`) ist Archiv/Nachschlagewerk, kein Auftragsgeber.
- **Arbeitsnachweis:** Tests, Freigabe und nötige Übergabe knapp dokumentieren. Das alte Update-Ritual (Masterplan-Häkchen, WORKLOG mit 4 Pflichtteilen, Lektionen-Register als Pflicht-Lektüre) ist archiviert (Karl 26.09.2026).
- **Commit-Konvention (H2):** `Tag <n>: <Betreff>` — `n` = höchste `Tag`-Nummer aus `git log --oneline` + 1, ein Tag pro logischem Chunk.
- **Push/Merge auf `main`:** grüne Gates UND Prüfung durch jemand anderen als den Erbauer (Claude↔Codex; ist Claude leer: zweite blinde Codex-Prüfung + grüne Tests). Force-Push/History-Rewrite nur mit Karls Ja; Löschen nach den zwei Klassen (global). Was nicht gepusht werden konnte, am Session-Ende explizit an Karl melden.
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

## Formel-Änderungen (Karl 26.09.2026, ersetzt Gauntlet/F-16/3-grüne-Läufe)
Einheit = eine Formel pro GICS-Sub-Industry. Eine Formel darf sich ändern: sichtbar, mit Vorher/Nachher auf dem echten Board, von der zweiten KI (Claude↔Codex) blind geprüft, alt und neu höchstens 4 Wochen parallel, dann Umschalten. Alte Vorschläge werden nie geschönt. Rat/Gericht nur bei großer Auswirkung („groß" = ändert sichtbare Board-Zahlen, kostet Geld oder ist nicht umkehrbar; Regelblatt v4 Teil 2).

Neue Methoden starten **DIAGNOSTIC** (fixture-hash-safe); Promotion zu CORE erst nach Walk-Forward-Beleg pro Sektor.

Neue Board-/Achsen-Kandidaten: belegte Recherche → Formel-Weg (oben). Reihenfolge nur über `karl-plan\WUNSCHLISTE.md`. Das Ideen-Ledger `…\growth-screener\_IDEEN-LEDGER-2026-07-16.md` parkt nur (Nachschlagewerk).

## Formel-Arbeit & Budget
Formel-Arbeit nur aus Wunschliste-Zeilen über den Formel-Weg. Übriges Limit → größter sinnvoller Hebel, Bulk bis ~60 Agenten erlaubt, wenn sinnvoll. Keine Rückfragen zum Token-Budget; jeder Euro braucht weiter Karls Ja.
Nachschlagewerk (kein Auftragsgeber): Formel-Ledger `…\growth-screener\screener-formel-ledger.md` (Fitness-Baseline, Befunde); Mess-Artefakte in `screener-data\fitness\`. Der frühere Dauer-Härtungs-Loop ist archiviert.

## Wissensbasis / Recherche (getrennt vom Code)
Sektor-Dossiers (evidence-graded, englisch, zitiert) liegen im **Obsidian-Vault**
`C:\Users\Anwender\OneDrive\Dokumente\GitHub\Jarvis\Knowledge\Trading\growth-screener\` — **NICHT** im screener-data-Repo. Hub: `growth-screener-knowledge-base`, verlinkt mit `elliott-wellen-referenz`.

## Engineering-Regeln für Multi-Agent-Arbeit
- **Nie shared Registry-Files parallel editieren:** `src/scoring/formulas/index.js`, `src/scoring/formulas/quality/index.js`, `src/scoring/score.js` → Write-Races. Stattdessen Coordinator-Pattern (ein Agent besitzt die Registry) **oder** in Wellen von 1–2 serialisieren. Kollisionsfrei parallel: neue `src/scoring/formulas/<sector>.js`, Per-Cycle-Audit-Reports.
- **`git commit` ohne Pathspec staged ALLES** (auch Dateien laufender Agenten) → vor Commit `git status --short`, dann gezielt `git commit -- <pfade>`.
- **`/audit`-Zyklen:** 5 general-purpose-Agenten parallel in **einer** Nachricht, dann je Output als `Tag NNNa-e` committen; Zyklus endet mit `audit-reports/YYYY-MM-DD-tagNNN-cycle.md`. Audit-Befunde sind Vorschläge; Auftrag werden sie erst, wenn ein Fehler an etwas nachgewiesen ist, das Karl sieht, oder eine konkrete Daten-/Sicherheitsgefahr belegt ist — oder Karl es beauftragt. `.claude/commands/audit.md` ist ein SUPERSEDED-markiertes altes Verfahren gegen entfernte Architektur — nicht wörtlich ausführen.

## Fallen
- **`GitHub\screener-data-fix`** = eingefrorene Kopie/Ex-Worktree (18.05.2026) — **nicht anfassen**.
- **`GitHub\docGPT`** = totes Fremd-Repo (Kandidat für die monatliche Löschliste) — nie als Workspace nutzen.
- **Zwei Tests sind auf dieser Maschine dauerhaft rot und in CI grün — kein Defekt, sondern Umgebung.** Gemessen 30.08.2026 gegen den gleichen Stand, der als PR-Check grün durchlief:
  - `tests/scoring/calibration-ref.test.js` — genau ein Block (*R2.9 Test B*) hat eine **Vorbedingung**, die lokal nicht gilt: er braucht die Kohorte `utilities|unprofitable` als FEHLEND im lokalen Kalibrier-Artefakt. Lokal ist sie da. 16 von 17 Blöcken grün.
  - `tests/waehrung-ausliefer-waechter.test.js` — der LIVE-Block läuft über die **lokal ausgelieferten** Beine und findet dort Kreuznotiz-Verstöße (Mehrfachlistings desselben Emittenten). Das ist die bekannte Listing-Währungs-Falle. **Listing-Währungs-Klasse: keine Datums-Sperre**; Bau erlaubt, Bedingung: Vorher/Nachher auf der ausgelieferten Menge zeigt 0 veränderte korrekte Zeilen, zweite KI geprüft. Die synthetischen Blöcke derselben Datei sind grün.
  - **Regel:** Diese zwei lokalen Roten sind **kein** Grund, einen Chunk anzuhalten oder zu „reparieren". Jede *dritte* rote Datei ist es sehr wohl. Wer den lokalen Lauf sauber braucht: `git config core.autocrlf false` beseitigt eine dritte, ältere Klasse (Zeilenenden), nicht diese beiden.


## Zwei-Motoren-Betrieb (Codex) — Stand 26.09.2026 (Regelblatt v4 G17–G19)

- **Gleichberechtigt:** Codex plant mit (Fable + Codex), baut und prüft gleichberechtigt — auch Scoring/Methodik/Architektur; wer baut, wird vom anderen geprüft. Planung/Review auf höchstem Aufwand (astra). Codex' Rechte stehen ausschließlich in `C:\Users\Anwender\.codex\AGENTS.md`.
- **Delegations-Default:** Fix-Loops mit vielen Iterationen, Chart-/Render-Iterationen und Bulk-Mechanik gehen an Codex (Skill `codex-delegieren`) — Selbermachen ist dort die begründungspflichtige Ausnahme (1 Log-Zeile).
- **Vor jeder Schreibarbeit:** Delegations-Lock prüfen (`%USERPROFILE%\.codex\delegation-locks\<repo>.lock.json`). Aktiv/pending → nicht ins Repo schreiben; Krisenpfad steht im Skill. Commits `WIP (Codex, ungereviewt)` zuerst reviewen (`git reset --soft HEAD~1`, dann richtig committen).
