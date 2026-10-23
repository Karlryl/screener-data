# AGENTS.md — Anweisungen für Codex (und alle Nicht-Claude-Agenten)

**Regeln:** der gemeinsame Kern in `C:\Users\Anwender\.codex\AGENTS.md` (bei Widerspruch gilt
`C:\Users\Anwender\OneDrive\Dokumente\GitHub\karl-plan\REGELBLATT-v4.md`). Codex' Rechte stehen ausschließlich
dort; diese Datei zitiert keine Regeln und ergänzt nur Repo-Fakten.
Danach lesen: `CLAUDE.md` in diesem Verzeichnis (Repo-Fakten, Test-Gates, Fallen), die Wunschliste
`C:\Users\Anwender\OneDrive\Dokumente\GitHub\karl-plan\WUNSCHLISTE.md` und den Vault-Einstieg
`C:\Users\Anwender\OneDrive\Dokumente\GitHub\Jarvis\Knowledge\Trading\growth-screener\START.md`.
Der Vault-Masterplan ist Nachschlagewerk, kein Auftraggeber.

## Repo-Fakten (Details in CLAUDE.md)

1. **Score misst Qualität, nie Preis:** kein preisnormiertes Signal (Yield, P/E, PEG,
   EV/EBITDA, DCF, Target-Upside, Preis-Momentum) in einer Score-Formel unter `src/scoring/formulas/`.
2. **Schutzliste — nie löschen/überschreiben** (deckungsgleich mit `.codex-deny.txt`): `picks-history/`,
   `methods-history/`, `board-history/`, `score-history/`, `r40rx-history/`, `earnings-calendar.json`.
   `picks-history/` ist zusätzlich
   **inhaltlich eingefroren** (Stichtag 2026-07-02, Karl 2026-08-16, dauerhaft): keine
   Korrektur, kein Backfill, kein Aufräum-Commit, keine „Reparatur" einer Prüfskript-Meldung
   (z. B. `coverageWarning` aus `walk-forward-perf.js`). Begründung: `picks-history/_FROZEN.md`.
   Nachfolger ist `board-history/`.
3. **Commit-Konvention:** `Tag <n>: <Betreff>` (n = höchste Tag-Nummer aus
   `git log --oneline origin/main` + 1; endgültig erst beim Zusammenführen). Vor Commit `git status --short`,
   dann gezielt `git commit -- <pfade>` — nie pauschal alles stagen.
4. **Test-Gate nach jeder Scoring-/Methoden-Änderung:** komplette Suite grün fahren —
   `node scripts/test-gate.js --mode=all` (blockierende Spur, `BLOCKING_GLOBS` in `scripts/test-gate.js`:
   `tests/*test.js`, `tests/scoring/*test.js`, `lib/*test.js`, `tests/druckenmiller/*test.js`;
   jede Datei einzeln: `node <datei>`, Exit 0/1).
5. `C:\Users\Anwender\OneDrive\Dokumente\GitHub\screener-data-fix` und
   `C:\Users\Anwender\OneDrive\Dokumente\GitHub\docGPT` nie anfassen.
6. Das Repo ist öffentlich: was nie in eine Datei, einen Commit oder einen Bericht darf, sagt der Kern.

## Arbeitsteilung
Rollen, Prüfung durch die andere KI, Formel-Weg und die Sperre vor dem ersten Schreiben stehen im Kern
(Abschnitte „Fragen oder machen“ und „Bauen und Prüfen“). Für dieses Repo heißt die Sperre
`C:\Users\Anwender\.claude\skills\codex-delegieren\gate-check.ps1 -Mode Claim -Repo C:\Users\Anwender\OneDrive\Dokumente\GitHub\screener-data`.
Im Zweifel: kleiner Diff, nichts außerhalb des Auftrags anfassen.

## Arbeitsmodus (eigener Auftrag)

**0. Vorbedingung:** `git status` muss sauber sein — wenn nicht: anhalten und
melden, nie über fremde Änderungen hinweg arbeiten oder committen.
`.codex-deny.txt` (Schutzliste des Delegations-Gates: Daten-Verläufe + Selbstschutz) und das
Gate (`gate-check.ps1`) passt Claude an, nicht Codex (`C:\Users\Anwender\.codex\AGENTS.md`); die
Datenpfade bleiben dabei immer geschützt und werden nie gestrichen.

**1. Auftrag wählen:** aus `karl-plan\WUNSCHLISTE.md` (ihre Reihenfolge gilt) oder aus einem
konkreten Auftrag; die Wahl im Ergebnis begründen.

**2. Umsetzen:** kleiner Diff, Repo-Fakten oben einhalten, komplette Suite grün (Punkt 4).

**3. Abschluss:**
- Commit `Tag <n>: <Betreff>` (gezielt per Pathspec) auf einem eigenen Branch, vorher auf aktuellem
  `origin/main` aufsetzen (täglicher CI committet). Merge nach `main` erst nach bestandener
  Zweitprüfung und grünen Gates.
- Meldung an Karl nach dem Kern, Abschnitt „Karl, Sprache, Antworten“.

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
