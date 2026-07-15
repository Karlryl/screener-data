# AGENTS.md — Anweisungen für Codex (und alle Nicht-Claude-Agenten)

**Lies zuerst `CLAUDE.md` und `CONTEXT.md` in diesem Verzeichnis und halte dich exakt daran.**
Vor Arbeitsbeginn außerdem den Masterplan lesen (Pfad steht in CLAUDE.md).

## Harte Regeln (Kurzfassung — Details in CLAUDE.md)

1. **NUR Qualität, nie Bewertung:** kein preisnormiertes Signal (Yield, P/E, PEG,
   EV/EBITDA, DCF, Target-Upside, Preis-Momentum) in `SCORE_WEIGHTS` — Mandats-Verstoß.
2. **Schutzliste — nie löschen/überschreiben:** `picks-history/`, `methods-history/`,
   `earnings-calendar.json`, Branch `loop/formel-haertung`.
3. **Commit-Konvention:** `Tag <n>: <Betreff>` (n = höchste Tag-Nummer aus
   `git log --oneline` + 1). Vor Commit `git status --short`, dann gezielt
   `git commit -- <pfade>` — nie pauschal alles stagen.
4. **Test-Gate nach jeder Scoring-/Methoden-Änderung:** komplette Suite
   `tests/scoring/*.test.js` grün fahren (jede Datei: `node <datei>`, Exit 0/1).
5. Force-Push, History-Rewrite, Datei-Löschungen: **nie** ohne Karls OK.
6. `GitHub\screener-data-fix` und `GitHub\docGPT` nie anfassen.
7. Antworten auf Deutsch, knapp.

## Arbeitsteilung
Claude Code ist Lead (Formeln, Scoring, Methodik — läuft über den Gauntlet-Prozess).
Codex übernimmt klar umrissene Einzelaufgaben (Tests, Refactorings, Doku, Charts).
Im Zweifel: kleiner Diff, nichts außerhalb des Auftrags anfassen.
