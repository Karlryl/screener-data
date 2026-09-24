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

## S06 · Lane A · Effort low — rule40: Reserved-Name-Snapshots (`_CON.json`) gehoeren zum Universum
ZIEL: Pinnt cec884f "Tag 1346: rule40 uses isMetadataSnapshot instead of the blanket underscore filter" — Funktion `sammleKandidaten(opts)` in `scripts/write-rule40-export.js`, die Zeile `const dateien = fs.readdirSync(snapshotsDir).filter((f) => f.endsWith('.json') && !isMetadataSnapshot(f));` (Z. ~440). Der Waechter `tests/p1-welle8-metadata-filter.test.js` prueft nur den QUELLTEXT auf Blanket-Filter; ein VERHALTENS-Pin fehlt. Neuer Standalone-Runner `tests/rule40-reserved-name-snapshot.test.js` (Muster: `tests/rule40-universe.test.js` Z. 150-210, Fixture-Bauer `baueExport()` aus `tests/rule40-fixture.js`, `W = require('../scripts/write-rule40-export.js')`). Faelle:
(1) Fixture mit zwei normalen Eintraegen bauen. Danach den JSON-Inhalt eines der beiden geschriebenen Snapshots aus `f.snapshotsDir` lesen, `meta.ticker = 'CON'` und `meta.name = 'CON Inc'` setzen (eigener Name — der Emittenten-Dedup gruppiert ueber den Firmennamen) und als `_CON.json` in `f.snapshotsDir` schreiben; zusaetzlich `_manifest.json` = `{"pulled_at":"2026-09-17T00:00:00Z","n_total":1,"n_ok":1}` und `_last_good_disk.json` = `{}` daneben legen. `W.sammleKandidaten({ v1Dir: f.v1Dir, snapshotsDir: f.snapshotsDir })` muss `gelesen === 3` liefern (2 + `_CON`; NICHT 5) und `abgewiesen.snapshotUnlesbar === 0`.
(2) Der `_CON`-Kandidat steht in `res.kandidaten`. Welches Identitaetsfeld er traegt (Dateiname-Ticker `_CON` via `datei.slice(0, -5)`, `meta.ticker` `CON` oder `meta.name`), aus `scripts/write-rule40-export.js` Z. 440-564 ablesen und GENAU das heutige Verhalten pinnen — nicht das "richtige".
(3) Gegenprobe: ohne `_CON.json`, aber mit den beiden Metadateien, ist `gelesen === 2`.
Rueckgabeform: `{ index, kandidaten, abgewiesen, gelesen, aufBrett }` (Z. 564).
ZIEL-DATEIEN: neu `tests/rule40-reserved-name-snapshot.test.js`. `scripts/**`, `src/**`, `tests/scoring/**` unveraendert.
FERTIG-WENN: `node tests/rule40-reserved-name-snapshot.test.js` Exit 0. Break-once: den Filter in `sammleKandidaten` temporaer auf `f.endsWith('.json') && !f.startsWith('_')` zuruecksetzen → neuer Test rot (`gelesen` 2 statt 3). Erwartet ebenfalls rot in diesem Zustand: `tests/p1-welle8-metadata-filter.test.js` (Quelltext-Waechter, KONSUMENTEN_MIN 23) — im PR als bestaetigte Doppelabsicherung nennen. Wiederherstellen → beide gruen; Ausgaben im PR-Body.
VERIFIKATION: `node tests/rule40-reserved-name-snapshot.test.js`; danach der komplette Gate-Glob: `Get-ChildItem tests/*test.js,tests/scoring/*test.js,lib/*test.js | ForEach-Object { node $_.FullName; if ($LASTEXITCODE) { "FAIL: $($_.Name)" } }` — erlaubt sind nur die zwei bekannten lokalen Roten (`tests/scoring/calibration-ref.test.js` R2.9 Test B, `tests/waehrung-ausliefer-waechter.test.js` LIVE-Block); jede dritte rote Datei stoppt den Task.

## S07 · Lane A · Effort medium — Mess-Skripte T135 / T326: CLI-Vertrag und Selbsttest pinnen
ZIEL: Pinnt 596775b "T135 option B: measure the parity gap between productionCohortRanking and the small-cap board" und d7e3b0e "T135 script: smoke runs on the stale store are labelled non-evidence and get their own default path" (`scripts/t135-paritaetsluecke.js`: `arg()` Z. 19-25, `fail()` Z. 27, `main()` Z. 29-40 mit der Altbestand-Wache Z. 36) sowie b421bcc "T326: both stale-fundamentals definitions on ONE CI population" (`scripts/t-veraltung-zwei-definitionen.js`: `main(args)` Z. 200-212, `selftest()` Z. 174-198, `loadRules()`). Beide Skripte laufen ausschliesslich als CLI (`main()` beim Laden bzw. `require.main`), deshalb Kindprozess-Tests mit `spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', cwd: REPO, timeout: 120000 })` — Muster `tests/annual-spikes.test.js` Z. 401-410. T135 laedt beim Start `src/scoring/run-screener.js` & Co. (nur lesen, das ist erlaubt), rechne mit einigen Sekunden je Aufruf. Neuer Standalone-Runner `tests/mess-skripte-cli-vertrag.test.js`:
T135 (Temp-Basis via `mkdtemp`):
(a) ohne Argumente → `status === 1`, stderr enthaelt `--snapshots <dir> fehlt`.
(b) `--snapshots <tmp>/leer --vintage 21.09.2026` (Ordner existiert, leer) → 1, stderr `--vintage YYYY-MM-DD fehlt`.
(c) `--snapshots <tmp>/snapshots-smallcap --vintage 2026-09-21` (Ordner leer, aber exakt so benannt) → 1, stderr `lokales snapshots-smallcap/ ist Altbestand`.
(d) wie (c) plus `--lokal-kein-beleg` → weiterhin 1, aber stderr enthaelt `leere Small-Cap-Population` und NICHT `Altbestand` — Beleg, dass der Schalter die Altbestand-Wache umgeht und erst die naechste Wache greift. Sollte auf dem leeren Ordner eine andere Wache frueher werfen (z. B. aus `loadSmallcapUniverse`), GENAU deren Meldung pinnen, zusaetzlich `NICHT Altbestand` behalten und das im PR nennen.
(e) `--snapshots --vintage 2026-09-21` → 1, stderr `--snapshots ohne Wert`.
Fuer (a)-(e): `fs.readdirSync(path.join(REPO, 'reports'))` vor und nach dem Lauf vergleichen — es darf keine Datei entstehen.
T326:
(f) `--selftest` → `status === 0`, stdout enthaelt `SELFTEST PASS: 3 snapshots; both=1 / only D1=1 / only D2=0 / neither=1; counters=2/1/1/0` und `PASS: strict 7d/30d boundaries`. Das Skript laesst seine Fixtures in OS-Temp absichtlich liegen ("Temporary fixtures retained") — Skriptverhalten, nicht "reparieren" und nicht als Testmuell werten.
(g) `--now 2026-09-20T00:00:00Z` ohne Verzeichnis → 1, stderr `--now requires population-dir`.
(h) `--now` ohne Wert → 1, stderr `Missing/repeated --now`.
(i) `--foo` → 1, stderr `Unexpected argument: --foo`.
Fuer (f)-(i): `reports/t-veraltung-zwei-definitionen-2026-09-20.md` bleibt byte-identisch (Hash vorher/nachher).
Dokumentierte Grenze (als Kommentar im Test, keine Assertion): Reportpfad `-RAUCHTEST` und Kopfzeile "RAUCHTEST, KEIN BELEG" aus d7e3b0e sind ohne echte Small-Cap-Population nicht erreichbar (`runSmallcapPass` braucht Snapshots) und bleiben ungepinnt.
ZIEL-DATEIEN: neu `tests/mess-skripte-cli-vertrag.test.js`. Beide Skripte unveraendert.
FERTIG-WENN: Runner Exit 0. Break-once ZWEIMAL: (1) in `scripts/t135-paritaetsluecke.js` Z. 36 den Teil `&& !process.argv.includes('--lokal-kein-beleg')` temporaer entfernen → Fall (d) rot (stderr zeigt `Altbestand`); (2) in `scripts/t-veraltung-zwei-definitionen.js` Z. 210 die Assertion `'--now requires population-dir'` temporaer entfernen (Zeile zu `if (!directory) return;` machen) → Fall (g) rot. Beide wiederherstellen → gruen; alle vier Ausgaben im PR-Body.
VERIFIKATION: `node tests/mess-skripte-cli-vertrag.test.js`; danach der komplette Gate-Glob wie in S-HIST1 (gleiche Ausnahmeregel fuer die zwei bekannten lokalen Roten).

## S08 · Lane B · Effort high — k-Drift-Report: der Schlusssatz zaehlt seine eigenen Staende
ZIEL: Pinnt 244781b "k-drift report: the verdict sentence counts its own inputs (#349)" (Skript-Neuzugang: c5dd239 "Durchsatz-Lesehilfe + k-Drift-Messung") — `scripts/t-kdrift-signatur.js` `main()` Z. ~163-172: `const genugStaende = runs.length >= 3;` und `urteilsHinweis` = "`${runs.length} Stände verglichen; drift verlangt zusätzlich in JEDEM Schritt eine Veränderung ungleich null.`" bzw. "`${runs.length} Stände können eine Drift-Richtung nicht belegen.`"; der Satz steht in `summary` (`console.log(summary)` am Ende von `main()`) und im Report. Hindernis: das Skript liest `<ROOT>/data-health/annual-spikes-baseline.json` und `<ROOT>/scripts/watch-annual-spikes.js` und schreibt seinen Report an den FESTEN Pfad `<ROOT>/reports/t-kdrift-signatur-2026-09-20.md` mit `ROOT = path.resolve(__dirname, '..')`. Ein Test darf den eingecheckten Report NICHT ueberschreiben. Loesung: Temp-ROOT nachbauen — `mkdtemp`, darin `scripts/` mit byte-identischen Kopien von `t-kdrift-signatur.js` UND `watch-annual-spikes.js` (das Skript extrahiert daraus per Regex reine Funktionen), `data-health/annual-spikes-baseline.json` synthetisch = `{"hinweis":"test","faelle":[]}` (`main()` nutzt nur `baseline.faelle`), leeres `reports/`. Populationen: N Verzeichnisse `lauf1..laufN`, jedes mit `AAA.json` = `{"meta":{"ticker":"AAA"},"annual":{"annualRev":[{"value":1000000},{"value":100000000},{"value":2000000}]}}` — exakt die Reihe des eingebauten Self-Checks (`findeAusreisser(...)[0].index === 1`), damit ein Fund entsteht und die Tabellen-Schleife durchlaufen wird. Aufruf `spawnSync(process.execPath, [tmpRoot + '/scripts/t-kdrift-signatur.js', lauf1, lauf2(, lauf3)], { encoding: 'utf8' })`. Neuer Standalone-Runner `tests/t-kdrift-signatur-schlusssatz.test.js`:
(1) 2 Staende → `status === 0`; stdout UND Report enthalten `2 Stände können eine Drift-Richtung nicht belegen` und NICHT `Zwei Stände` und NICHT `Stände verglichen`.
(2) 3 Staende → `status === 0`; stdout UND Report enthalten `3 Stände verglichen; drift verlangt zusätzlich in JEDEM Schritt` und NICHT `können eine Drift-Richtung nicht belegen`.
(3) 1 Stand → `status === 1` (Usage-Assertion `args.length >= 2`).
(4) derselbe Ordner zweimal → `status === 1`, stderr `Repeated run directory`.
(5) nach jedem Lauf: Baseline im Temp-ROOT byte-identisch (das Skript prueft das selbst — der Test bestaetigt es unabhaengig per Hash), `reports/t-kdrift-signatur-2026-09-20.md` im Temp-ROOT existiert nach (1)/(2), und der ECHTE Repo-Report `reports/t-kdrift-signatur-2026-09-20.md` ist unveraendert (Hash vorher/nachher).
Umlaute als `ä`/`ö` im Test.
ZIEL-DATEIEN: neu `tests/t-kdrift-signatur-schlusssatz.test.js`. `scripts/t-kdrift-signatur.js`, `scripts/watch-annual-spikes.js`, `data-health/**`, `reports/**` unveraendert.
FERTIG-WENN: Runner Exit 0 in unter 30 s. Break-once: in `scripts/t-kdrift-signatur.js` `const genugStaende = runs.length >= 3;` temporaer auf `const genugStaende = false;` setzen → Fall (2) rot; wiederherstellen → gruen; beide Ausgaben im PR-Body. Achtung: der Test kopiert das Skript aus dem Repo-Stand — der Revert muss im Repo passieren, nicht in der Temp-Kopie.
VERIFIKATION: `node tests/t-kdrift-signatur-schlusssatz.test.js`; `git status --short reports/ data-health/` leer; danach der komplette Gate-Glob wie in S-HIST1.
