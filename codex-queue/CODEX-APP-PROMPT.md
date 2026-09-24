REPO=screener-data        <- pro Thread anpassen: screener-data | findash
LANE=ALL                  <- pro Thread anpassen: A | B | C | ALL

Du arbeitest bis 20:45 Uhr (lokale Zeit) autonom eine Task-Queue ab. Kein Rueckfragen, keine Pausen.
Repo: C:\Users\Anwender\OneDrive\Dokumente\GitHub\<REPO>. Lies dort zuerst AGENTS.md und CLAUDE.md.

QUEUE HOLEN (vor jedem Task neu, sie waechst waehrend du arbeitest):
  git fetch origin claude/codex-limit-optimization-2u1g6h
  git show origin/claude/codex-limit-optimization-2u1g6h:codex-queue/QUEUE.md
Die Datei enthaelt bindende Regeln (Worktree ausserhalb des Repos, TABU-Pfade, Testregeln,
Commit-/PR-Format) und die Tasks mit ID, Lane und Effort.

SCHLEIFE:
1. Naechsten offenen Task deiner LANE nehmen (LANE=ALL: erst A, dann B, dann C, von oben nach unten).
2. Task beanspruchen, damit kein anderer Thread ihn doppelt macht:
     git push origin origin/<main|master>:refs/heads/codex/<ID>
   Schlaegt der Push fehl, weil der Branch schon existiert -> Task ist vergeben, naechsten nehmen.
3. Worktree anlegen (Pfad ..\codex-wt\<REPO>\<ID>, Branch codex/<ID>), Task exakt nach Brief umsetzen,
   Verifikation ausfuehren, gezielt committen, pushen, PR im MELDEFORMAT der Queue oeffnen.
4. Zurueck zu QUEUE HOLEN. Ist in deiner Lane nichts mehr offen: Tasks anderer Lanes nehmen.
   Ist gar nichts offen: 5 Minuten warten (Start-Sleep 300), Queue erneut holen — bis 20:45.

HART: nie Dateien loeschen, nie Tests abschwaechen, nie TABU-Pfade anfassen, nie Force-Push,
nie Scoring/Formeln/Methoden/Architektur aendern, keine neuen Dependencies, keine kostenpflichtigen Calls.
Wenn ein Task nach 2 ernsthaften Anlaeufen nicht gruen wird: PR trotzdem als DRAFT mit Diagnose oeffnen
und weitergehen — kein Task darf mehr als 45 Minuten blockieren.

UM 20:45: Schlussbericht auf Deutsch: Tabelle ID | PR-URL | Status (gruen/draft/offen) | Verifikations-Befehl,
danach Liste OFFEN (was Claude reviewen muss). Nichts mehr pushen nach dem Bericht.
