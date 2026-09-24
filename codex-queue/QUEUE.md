# Codex-Queue screener-data — Lauf 2026-09-24 (bis 20:45)

Diese Datei wird von Claude laufend erweitert. Vor JEDEM neuen Task:
`git fetch origin claude/codex-limit-optimization-2u1g6h` und diese Datei neu lesen
(`git show origin/claude/codex-limit-optimization-2u1g6h:codex-queue/QUEUE.md`).
Tasks von oben nach unten in der eigenen LANE abarbeiten. Erledigte Tasks stehen in deinem
eigenen Log (PR-Liste), nicht hier.

## Regeln (bindend, zusaetzlich zu AGENTS.md / CLAUDE.md)
- Arbeit NUR in einem eigenen Worktree ausserhalb des Repos:
  `git fetch origin main && git worktree add ..\codex-wt\screener-data\<ID> origin/main`
  (Branch `codex/<ID>`). Karls Haupt-Working-Tree nie anfassen.
- TABU-Pfade (automatisches Rot): alles in `.codex-deny.txt`, zusaetzlich `src/scoring/**`,
  `methods/**`, `tests/scoring/**`, `.github/**`, `*-history/`, `earnings-calendar.json`,
  `README.md` (Engine-Wahrheit), `docs/findash-export-v1*`.
- Nie: Dateien loeschen, Tests abschwaechen (kein skip/only/todo, keine gelockerten
  Assertions), Dependencies hinzufuegen, Netz-Calls in Tests, Force-Push.
- Neue Tests = Standalone-Runner wie die bestehenden `lib/*.test.js` (`node <datei>` → Exit 0/1,
  `assert` aus node:assert, keine Frameworks). Muster: `lib/alter-test-vorlage` gibt es nicht —
  nimm eine existierende `lib/*.test.js` als Vorlage.
- Commit: `Tag <n>: <Betreff>` (n = hoechste Tag-Nummer in `git log --oneline` + 1; Kollisionen
  zwischen Lanes sind ok). Gezielt per Pathspec committen.
- Push `codex/<ID>` + `gh pr create --base main --title "<ID>: <Betreff>"` mit Body im MELDEFORMAT:
  ```
  ## ERGEBNIS
  <was gebaut wurde, 3-6 Zeilen>
  ## VERIFIZIERT
  <exakte Befehle + Exit-Codes / Zaehler vorher→nachher>
  ## OFFEN / RISIKO
  <was nicht ging, was Claude pruefen soll>
  ```
  Wenn `gh` fehlschlaegt: nur pushen, PR-Erstellung im Schlussbericht als offen vermerken.
- Nach jedem Task: Worktree behalten (kein `worktree remove`), naechsten Task nehmen.
- Bekannt lokal rot (KEIN Defekt, nicht anfassen): `tests/scoring/calibration-ref.test.js`
  (Block R2.9 Test B) und `tests/waehrung-ausliefer-waechter.test.js` (LIVE-Block).

## SUBAGENTEN-PFLICHT (Karl, 19:40) und ZEITPLAN
- Du bist KOORDINATOR. Fuer jeden Task startest du einen Codex-Subagenten mit dem vollstaendigen
  Brief (Regeln oben + Task-Abschnitt + Worktree-Pfad). Bis zu 4 Subagenten GLEICHZEITIG, jeder
  in seinem eigenen Worktree/Branch. Sobald einer fertig ist: naechsten Task beanspruchen und
  den naechsten Subagenten starten. Du selbst implementierst nichts — du beanspruchst, briefst,
  pruefst, pushst.
- Vor jedem Push startest du einen zweiten Subagenten als REVIEWER (Diff gegen den Brief:
  TABU-Pfade, Test-Abschwaechung, Loeschungen, Verifikations-Befehl selbst laufen lassen).
  Nur mit Reviewer-Freigabe pushen; Befund im PR-Body unter „REVIEW" zitieren.
- Gibt es in deiner Codex-Version keine Subagenten: sequentiell arbeiten und das im
  Schlussbericht in einer Zeile vermerken.
- ZEITPLAN (lokale Zeit): letzter Push 20:38. Schlussbericht 20:40 (nicht 20:45). Der PC faehrt
  um 20:46 automatisch herunter (Timer setzt Karl; falls nicht gesetzt, EIN Thread:
  `shutdown /s /f /t <Sekunden bis 20:46>` — Fehler 1190 = schon geplant, ignorieren).

## Lanes
- **Lane A** = mechanisch (Effort: low/medium). **Lane B** = mittel (Effort: medium/high).
- **Lane C** = schwer (Effort: high/xhigh). Bei nur einem Thread: Lane ALL = A, dann B, dann C.

---

## S01 · Lane A · Effort low — Unit-Tests fuer 6 kleine lib-Helfer ohne Test
ZIEL: Fuer jede der folgenden Dateien eine Standalone-Testdatei `lib/<name>.test.js` anlegen
(sie laufen automatisch im CI-Gate `lib/*test.js`): `lib/spearman.js`, `lib/region-mapping.js`,
`lib/snapshot-fs.js`, `lib/alter.js`, `lib/sec-user-agent.js`, `lib/sec-rate-limit.js`.
Pro Export mindestens: Normalfall, Randfall (leer/null/NaN/negativ), und die dokumentierten
Konstanten (z. B. WINDOWS_RESERVED, MS_PRO_TAG). Verhalten NICHT aendern — nur testen; wenn ein
Test einen echten Bug zeigt: Test so schreiben, dass er den IST-Zustand dokumentiert, und den
Bug unter OFFEN melden (kein Fix am Produktionscode in diesem Task).
ZIEL-DATEIEN: nur die 6 neuen `lib/*.test.js`.
FERTIG-WENN: alle 6 Dateien laufen mit `node lib/<name>.test.js` Exit 0; jede hat >= 8 Assertions.
VERIFIKATION: `for f in lib/spearman.test.js ...; do node $f; echo $?; done` (PowerShell-Aequivalent).

## S02 · Lane B · Effort medium — Unit-Tests fuer 5 groessere lib-Module ohne Test
ZIEL: Standalone-Tests fuer `lib/fetch-retry.js` (Retry/Pause-Logik ueber injizierten fetch,
`_internals.warteAufSlot`), `lib/zip-stream.js` (Roundtrip mit In-Memory-Puffer),
`lib/sub-profile.js` (`classifySubProfile` fuer jeden SUB_PROFILE-Zweig + unbekannter Ticker),
`lib/ledger-single-appender.js` (`checkSingleAppender`/`resolveBaseRef` in einem tmp-Git-Repo),
`lib/sec-pit.js` (reine Funktionen aus den Exports; Datei-IO ueber tmp-Dir).
Kein Netz. Kein Zugriff auf echte `snapshots/`, `prices/`, `picks-history/`.
ZIEL-DATEIEN: neue `lib/fetch-retry.test.js`, `lib/zip-stream.test.js`, `lib/sub-profile.test.js`,
`lib/ledger-single-appender.test.js`, `lib/sec-pit.test.js`.
FERTIG-WENN: alle 5 Exit 0, je >= 10 Assertions, Laufzeit je < 10 s.
VERIFIKATION: `node lib/<name>.test.js` je Datei + Laufzeit.

## S03 · Lane B · Effort medium — `lib/price-history-store.js` Tests + Fehlerpfade
ZIEL: Standalone-Test `lib/price-history-store.test.js`: alle Exports gegen ein tmp-Verzeichnis
(Anlegen, Anhaengen, Lesen, korrupte Datei, fehlendes Verzeichnis, doppelte Datumszeile).
Dokumentiere jedes Verhalten, das du fuer einen Bug haeltst, unter OFFEN — kein Produktions-Fix.
ZIEL-DATEIEN: `lib/price-history-store.test.js`.
FERTIG-WENN: Exit 0, >= 12 Assertions, keine Spuren ausserhalb des tmp-Dirs.

## S04 · Lane C · Effort high — Voll-Gate lokal fahren und Befund schreiben
ZIEL: Die komplette CI-Gate-Suite lokal laufen lassen: `tests/*test.js`, `tests/scoring/*test.js`,
`lib/*test.js` (jede Datei `node <datei>`, Exit-Code + Laufzeit protokollieren; 30-45 min).
Ergebnis als `reports/codex-gate-lauf-2026-09-24.md`: Tabelle Datei | Exit | Sekunden, dann
Abschnitt „Rot" mit den ersten 30 Fehlerzeilen je roter Datei. Die zwei bekannt-lokal-roten
Dateien (siehe Regeln) als „bekannt/Umgebung" markieren. Fuer jede WEITERE rote Datei ausserhalb
`tests/scoring/**`: Ursache analysieren und — wenn der Fix klar ausserhalb von Scoring/Methoden
liegt — im selben PR fixen; sonst nur Diagnose mit Datei:Zeile.
ZIEL-DATEIEN: `reports/codex-gate-lauf-2026-09-24.md` + ggf. Fix-Dateien ausserhalb der TABU-Pfade.
FERTIG-WENN: Report vollstaendig (alle Dateien gelistet), PR offen.

## S05 · Lane A · Effort low — Standalone-Tests fuer CLI-Helfer `earnings-cli.js` / `watchlist-cli.js`
ZIEL: `tests/cli-helfer.test.js`: beide CLIs als Kindprozess (`child_process.spawnSync`, `node
<cli> --help` bzw. ohne Argumente) → Exit-Code, keine Exception, Hilfetext enthaelt jede
dokumentierte Option. Zusaetzlich: unbekannte Option → Exit != 0 und Fehlermeldung auf stderr.
Wenn eine CLI heute bei unbekannter Option Exit 0 liefert: Test dokumentiert IST, Befund unter OFFEN.
ZIEL-DATEIEN: `tests/cli-helfer.test.js`.
FERTIG-WENN: Exit 0, laeuft ohne Netz und ohne echte Snapshots.
