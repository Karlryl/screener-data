# AGENTS.md — scripts\ (Zusatz, Root-Regeln gelten unverändert weiter)

Ergänzt `..\AGENTS.md` (Harte Regeln, Schutzliste, Commit-Konvention,
Test-Gate) — die stehen dort, nicht hier, und gelten unabhängig davon,
ob diese Datei geladen wird.

- Einmal-Skripte (Backfill, Migration, Cleanup) folgen dem Muster
  `tag<n><buchstabe>-<sache>.js` (Beispiel: `tag228a-cleanup-phantom-vintages.js`,
  `tag229a-stale-snapshot-verify.js`) — Muster beibehalten, nicht neu erfinden.
- Jedes Skript hier läuft standalone per `node scripts\<datei>.js`, ohne
  Test-Framework-Abhängigkeit.
- Änderst du hier etwas an Scoring-/Methoden-Logik: Root-Regel 4
  (Test-Gate `tests/scoring/*.test.js` komplett grün) gilt trotzdem —
  diese Datei wiederholt sie absichtlich nicht, sie steht in Root.
