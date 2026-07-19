# AGENTS.md — Anweisungen für Codex (und alle Nicht-Claude-Agenten)

**Lies zuerst `CLAUDE.md` in diesem Verzeichnis und halte dich exakt daran.**
Vor Arbeitsbeginn außerdem den Masterplan lesen (Pfad steht in CLAUDE.md).
`CONTEXT.md` ist ein eingefrorenes Resume-Briefing (Stand Tag 231, SUPERSEDED-Banner
oben in der Datei) — keine bindende Engine-Wahrheit, nicht mehr referenzieren.

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

**0. Vorbedingung:** `git status` muss sauber sein — wenn nicht: anhalten und
melden, nie über fremde Änderungen hinweg arbeiten oder committen.
Die Datei `.codex-deny.txt` ist **TABU** (nie ändern).

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

## Delegationsmodus (Auftrag kommt von Claude via `codex exec`)

Erkennbar am Brief (ZIEL / ZIEL-DATEIEN / VERBOTEN / FERTIG-WENN / MELDEFORMAT):
1. Der Brief ist bindend — **nichts** außerhalb der ZIEL-DATEIEN anfassen
   (jede fremde Datei im Diff schlägt im Gate automatisch Rot).
2. **NIE committen oder pushen** — Review und Commit macht Claude.
3. Tests nie abschwächen (kein skip/only/todo, keine gelockerten Assertions,
   keine gelöschten Testfälle) — rote Tests werden im Code gefixt.
4. Schlussnachricht exakt im MELDEFORMAT des Briefs.
Bei Widerspruch gilt: Brief > diese Datei > Bequemlichkeit.
