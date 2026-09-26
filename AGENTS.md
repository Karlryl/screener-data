# AGENTS.md — Anweisungen für Codex (und alle Nicht-Claude-Agenten)

**Bindend:** `C:\Users\Anwender\OneDrive\Dokumente\GitHub\karl-plan\REGELBLATT-v4.md` (Karl 26.09.2026).
Codex' Rechte stehen ausschließlich in `C:\Users\Anwender\.codex\AGENTS.md`; diese Datei ergänzt nur Repo-Fakten.
Danach lesen: `CLAUDE.md` in diesem Verzeichnis (Repo-Regeln, Test-Gates, Fallen), die Wunschliste
`C:\Users\Anwender\OneDrive\Dokumente\GitHub\karl-plan\WUNSCHLISTE.md` und den Vault-Einstieg
`C:\Users\Anwender\OneDrive\Dokumente\GitHub\Jarvis\Knowledge\Trading\growth-screener\START.md`.
Der Vault-Masterplan ist Archiv/Nachschlagewerk, kein Auftragsgeber.
`CONTEXT.md` ist ein eingefrorenes Resume-Briefing (Stand Tag 231, SUPERSEDED-Banner
oben in der Datei) — keine bindende Engine-Wahrheit, nicht mehr referenzieren.

## Harte Regeln (Kurzfassung — Details in CLAUDE.md)

1. **NUR Qualität, nie Bewertung:** kein preisnormiertes Signal (Yield, P/E, PEG,
   EV/EBITDA, DCF, Target-Upside, Preis-Momentum) in `SCORE_WEIGHTS` — Mandats-Verstoß.
2. **Schutzliste — nie löschen/überschreiben:** `picks-history/`, `methods-history/`,
   `earnings-calendar.json`, Branch `loop/formel-haertung`. `picks-history/` ist zusätzlich
   **inhaltlich eingefroren** (Stichtag 2026-07-02, Karl 2026-08-16, dauerhaft): keine
   Korrektur, kein Backfill, kein Aufräum-Commit, keine „Reparatur" einer Prüfskript-Meldung
   (z. B. `coverageWarning` aus `walk-forward-perf.js`). Begründung: `picks-history/_FROZEN.md`.
   Nachfolger ist `board-history/`.
3. **Commit-Konvention:** `Tag <n>: <Betreff>` (n = höchste Tag-Nummer aus
   `git log --oneline` + 1). Vor Commit `git status --short`, dann gezielt
   `git commit -- <pfade>` — nie pauschal alles stagen.
4. **Test-Gate nach jeder Scoring-/Methoden-Änderung:** komplette Suite grün fahren —
   `node scripts/test-gate.js --mode=all` (CI-Gate-Glob `tests/*test.js`, `tests/scoring/*test.js`,
   `lib/*test.js`; jede Datei einzeln: `node <datei>`, Exit 0/1).
5. Force-Push, History-Rewrite und Löschen nur mit Karls Ja. Secrets nie ausgeben, committen oder in Reports schreiben.
6. `GitHub\screener-data-fix` und `GitHub\docGPT` nie anfassen.
7. Code, Commits und Agenten-Prompts auf Englisch; Berichte an Karl auf Deutsch, knapp.

## Arbeitsteilung
Codex ist gleichberechtigter Partner (Regelblatt v4 G17/G18): plant mit (Fable + Codex), baut und prüft —
auch Formeln, Scoring, Methodik, Architektur und Tests. Wer baut, gibt nicht selbst frei: vor Merge oder
Deploy prüft die andere Engine (Claude; ist Claude leer: eine zweite, blinde Codex-Session plus grüne Tests).
Gauntlet, F-16 und „3 grüne Läufe" sind keine Sperren; Formeländerungen laufen über den Formel-Weg in
`CLAUDE.md` (Vorher/Nachher sichtbar, zweite KI prüft, alt/neu höchstens 4 Wochen parallel).
Pro Repo genau ein Schreiber: vor dem Schreiben den Delegations-Lock unter
`C:\Users\Anwender\.codex\delegation-locks\` reservieren; fremde Locks nicht übernehmen.
Im Zweifel: kleiner Diff, nichts außerhalb des Auftrags anfassen.

## Arbeitsmodus (eigener Auftrag)

**0. Vorbedingung:** `git status` muss sauber sein — wenn nicht: anhalten und
melden, nie über fremde Änderungen hinweg arbeiten oder committen.
`.codex-deny.txt` (Schutzliste des Delegations-Gates: Daten-Verläufe + Selbstschutz) ändern
Claude oder Codex nur mit Prüfung durch den anderen.

**1. Auftrag wählen:** aus `karl-plan\WUNSCHLISTE.md` (Reihenfolge bestimmt Karl) oder aus einem
konkreten Auftrag; die Wahl im Ergebnis begründen.

**2. Umsetzen:** kleiner Diff, Regeln oben einhalten, komplette Suite grün (Regel 4).

**3. Abschluss:**
- Commit `Tag <n>: <Betreff>` (gezielt per Pathspec) auf einem eigenen Branch, vorher auf aktuellem
  `origin/main` aufsetzen (täglicher CI committet). Merge nach `main` erst nach bestandener
  Zweitprüfung und grünen Gates.
- Karl auf Deutsch knapp melden: Was ist rausgekommen → warum so entschieden
  → woran verifiziert. Das alte Masterplan-/WORKLOG-Ritual ist archiviert.

**Nie:** Schutzlisten-Dateien überschreiben oder löschen, kostenpflichtige API-Calls.

## Delegationsmodus (Auftrag kommt von Claude via `codex exec`)

Erkennbar am Brief (ZIEL / ZIEL-DATEIEN / VERBOTEN / FERTIG-WENN / MELDEFORMAT):
1. Der Brief ist bindend — **nichts** außerhalb der ZIEL-DATEIEN anfassen
   (jede fremde Datei im Diff schlägt im Gate automatisch Rot).
2. Commit/Push nach dem Brief. Freigabe und Merge nie durch den Erbauer selbst —
   die andere Engine prüft den Diff vorher.
3. Tests nie abschwächen (kein skip/only/todo, keine gelockerten Assertions,
   keine gelöschten Testfälle) — rote Tests werden im Code gefixt.
4. Schlussnachricht exakt im MELDEFORMAT des Briefs.
Bei Widerspruch gilt: Regelblatt v4 > `~\.codex\AGENTS.md` > Brief > diese Datei > Bequemlichkeit.
