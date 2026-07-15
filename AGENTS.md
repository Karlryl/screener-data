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
Codex übernimmt klar umrissene Einzelaufgaben (Tests, Refactorings, Doku, Charts)
und Masterplan-Tasks nach dem Modus unten. Im Zweifel: kleiner Diff, nichts
außerhalb des Auftrags anfassen.

## Masterplan-Arbeitsmodus (wenn Karl "masterplan" sagt)

Du hast keinen Zugriff auf Claudes Skills/Memory — dieser Abschnitt ersetzt sie.

**1. Lesen (Pflicht, in dieser Reihenfolge):**
- `..\Jarvis\Knowledge\Trading\growth-screener\_MASTERPLAN-screener-findash.md`
  (relativ zu diesem Repo: `..\..\GitHub\Jarvis\...` — absoluter Pfad:
  `C:\Users\Anwender\OneDrive\Dokumente\GitHub\Jarvis\Knowledge\Trading\growth-screener\_MASTERPLAN-screener-findash.md`)
  → Kopf-Block „Wo stehen wir gerade" + aktuelle Phase + Lektionen-Register (Abschnitt 6.0).
- `CONTEXT.md` in diesem Repo (Engine-Regeln).

**2. Task wählen — nur aus dieser erlaubten Klasse:**
- ERLAUBT: klar spezifizierte Implementierungs-Tasks (Anzeige-Spalten, Export-Felder,
  Tests, Refactorings, Doku, CI-Kleinkram, Chart-/Report-Verbesserungen).
- VERBOTEN (bleibt bei Claude): alles mit `@klasse:gauntlet`, jede Änderung an
  `SCORE_WEIGHTS`, Scoring-Formeln, Methoden-Promotion (DIAGNOSTIC→CORE),
  Fitness-Gate, sowie Architektur-Entscheidungen. Wenn der nächste offene Task
  in diese Kategorie fällt: NICHT ausführen, sondern Karl melden „Task X braucht
  Claude" und den nächsten erlaubten Task nehmen.
- Bei Unklarheit, welcher Task dran ist: den obersten offenen erlaubten Task
  der aktuellen Phase nehmen und die Wahl im Ergebnis begründen.

**3. Umsetzen:** kleiner Diff, Regeln oben einhalten, komplette Test-Suite
`tests/scoring/*.test.js` grün fahren.

**4. Abschluss-Ritual (Pflicht, sonst gilt der Task als NICHT erledigt):**
- Commit `Tag <n>: <Betreff>` (gezielt per Pathspec), Push auf `main` nur bei
  grünen Gates. Vorher `git pull --rebase origin main` (täglicher CI committet).
- Im Masterplan: Kästchen abhaken, „Wo stehen wir"-Block aktualisieren,
  WORKLOG-Eintrag mit 4 Pflichtteilen (Was+Commit / Warum so entschieden /
  Fehler & Schwierigkeiten / Lektion). Verallgemeinerbare Lektion zusätzlich
  als 1 Zeile ins Lektionen-Register (Abschnitt 6.0).
- Karl auf Deutsch knapp melden: Was ist rausgekommen → warum so entschieden
  → woran verifiziert.

**Nie:** Force-Push, Löschen, Schutzlisten-Dateien anfassen, kostenpflichtige
API-Calls, neue Dependencies ohne Karls OK.
