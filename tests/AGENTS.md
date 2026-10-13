# AGENTS.md — tests\ (Zusatz, Root-Regeln gelten unverändert weiter)

Ergänzt `..\AGENTS.md`.

- Jede `*.test.js` läuft standalone per `node <datei>`, Exit 0 = grün,
  Exit 1 = rot. Kein zusätzliches Test-Framework.
- `tests\scoring\*.test.js` ist die in Root-Regel 4 gemeinte Pflicht-Suite —
  nach jeder Scoring-/Methoden-Änderung komplett grün fahren, unabhängig
  davon, in welchem Ordner die eigentliche Änderung passiert ist.
- Tests nie abschwächen (kein skip/only/todo, keine gelockerten Assertions,
  keine gelöschten Testfälle).
