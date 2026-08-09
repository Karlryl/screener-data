# P1-Chunk 2 v2 — Schlussmeldung

## 1. Geaenderte Dateien (vollstaendige Liste)

- `.github/workflows/monthly-sec-xbrl.yml`
- `audit-reports/2026-08-09-p1-chunk2-meldung.md`
- `lib/atomic-write.js`
- `merge-sec-xbrl.js`
- `pull-sec-xbrl.js`
- `pull-yahoo.js`
- `scripts/build-secannual-smallcap.js`
- `tests/p1-welle2-datenquellen-wahrheit.test.js`

## 2. Je Befund: was und warum

- **F-CGPT-004/NRG-SK-001:** Alle benannten Yahoo-Loeschpfade laufen jetzt ueber `_removeStaleFiles`, das EPERM & Co. zaehlt und warnt; misslingt die Bereinigung, wird der Ticker als `failed-delete`/Failure statt als sauberer `skipped-mcap`- oder `fx-unknown`-Erfolg gebucht. Der Zaehler `snapshotDelete` steht in inkrementellem und finalem Manifest sowie in der Abschlusszeile des Silent-Error-Tallys.
- **F-CGPT-014:** Gewaehlt wurde die enge Default-Umkehr: `writeJsonAtomic` prueft non-finite Zahlen standardmaessig und erlaubt das alte verlustbehaftete Verhalten nur mit explizitem `{ assertFinite: false }`. Reale Aufrufer, die normale `null`-Werte serialisieren, brauchen kein Opt-out; die komplette Suite fand keinen legitimen NaN/Infinity-Aufrufer.
- **S4-SEC-004:** Ein 200er-Body wird vor `writeFileAtomic` mit `JSON.parse` validiert. HTML/Syntaxmuell laeuft dadurch in den vorhandenen `errors`-/`lastError`-Pfad, waehrend der Altbestand unangetastet und der CIK retry-faehig bleibt.
- **S4-SEC-002:** Bei identischem `end` gewinnt nun das lexikografisch spaetere ISO-`filed`-Datum und damit die spaeter eingereichte Korrektur. Ein eigenes Repro mit zwei 10-K-Fassungen belegt den Wechsel von `10`/`old` auf `12`/`restated`.
- **AE-CI-004:** Ein leeres Small-Cap-Universum wirft jetzt vor SEC-Ticker-Abruf und Ausgabeschreib statt mit Exit 0 zurueckzukehren; der wertvolle Altbestand bleibt unveraendert, aber der Workflow-Step wird rot. Der unmittelbar zugehoerige Workflow-Kommentar beschreibt diese Fail-loud-Semantik jetzt korrekt.

## 3. Test-/Verifikationsausgabe

### Rot-Beweise gegen den ungefixten Stand (Git-Archiv von `HEAD` vor dem Diff)

Ausgefuehrt mit:

```text
rm -rf /tmp/p1w2-red && mkdir /tmp/p1w2-red && git archive HEAD | tar -x -C /tmp/p1w2-red
cp tests/p1-welle2-datenquellen-wahrheit.test.js /tmp/p1w2-red/tests/
ln -s /workspace/screener-data/node_modules /tmp/p1w2-red/node_modules
(cd /tmp/p1w2-red && node tests/p1-welle2-datenquellen-wahrheit.test.js)
```

Relevante Ausgabe (Exit 1):

```text
FAIL F-CGPT-004/NRG-SK-001: TypeError: yahoo._removeStaleFiles is not a function
FAIL F-CGPT-014: AssertionError: Missing expected exception.
FAIL S4-SEC-004: TypeError: validateCompanyfactsBody is not a function
FAIL S4-SEC-002: AssertionError: 10 !== 12
FAIL AE-CI-004: TypeError: assertNonEmptyUniverse is not a function
P1-Welle 2: 0 bestanden, 5 fehlgeschlagen
RED_EXIT=1
```

### Gruener neuer Repro-Test

```text
$ node tests/p1-welle2-datenquellen-wahrheit.test.js
ok F-CGPT-004/NRG-SK-001: unlink-Fehler wird sichtbar gezaehlt
ok F-CGPT-014: writeJsonAtomic verweigert NaN standardmaessig
ok S4-SEC-004: SEC-200-HTML wird vor Persistenz abgewiesen
ok S4-SEC-002: gleiches Periodenende nimmt die spaeter eingereichte Korrektur
ok AE-CI-004: leeres Small-Cap-Universum ist kein erfolgreicher No-Op
P1-Welle 2: 5 bestanden, 0 fehlgeschlagen
```

### Kompletter GATE_GLOB-Lauf

Der bindende Befehl endete **nicht gruen (Exit 1)**, weil der erlaubte Environment-Setup-Schritt `pip install numpy==2.3.5` wegen gesperrtem Paketnetz (Proxy 403) scheiterte. Wie im Brief verlangt wurde danach kein Workaround gebaut; der einzige gemeldete Testfehler war `tests/early-detection-confirmatory.test.js` mit `ModuleNotFoundError: No module named 'numpy'` (verbotener Nicht-Ziel-Pfad blieb unangetastet).

Letzte Zeilen des ansonsten durchgelaufenen Gates:

```text
# pass 1
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 15.525214
GATE_EXIT=1
```

Damit ist das binaere Fertig-Kriterium „komplette Suite Exit 0“ **UNERFUELLT (Environment-Limit)**; die fuenf Code-Fixes und ihre neue Testdatei sind geliefert (Teilerfolg statt Verwerfen).

## 4. Offene Punkte / Unsicherheiten / ausgewiesene Wertaenderungen

- **Offen:** Den kompletten Gate-Befehl in einer Umgebung mit installierbarem/verfuegbarem `numpy==2.3.5` erneut ausfuehren; hier scheiterte bereits der ausdruecklich erlaubte Installationsschritt am Proxy 403.
- **S4-SEC-002 bestehende Fixtures/Tests:** keine beobachtete Wertaenderung in bestehenden Fixtures oder Tests. Nur das neue synthetische Repro aendert erwartungsgemaess den Gewinner von Wert `10` (`filed=2026-02-01`) auf Wert `12` (`filed=2026-03-15`).
- `git diff --name-only | rg '^(src/scoring/|tests/scoring/|protocol/)|early-detection'` lieferte keine Treffer; unter den verbotenen Pfaden liegt kein Diff.
- Der verpflichtende Masterplan war in der Linux-Sandbox unter `/workspace` und `/root` nicht vorhanden; da dies ein expliziter Delegationsbrief und kein Masterplan-Arbeitsmodus ist, wurde keine externe Datei ersetzt oder improvisiert.

## 5. Brief-Feedback

- **Unklar/fehlend:** Fuer den Fall eines gesperrten Paketindex waere hilfreich gewesen, ob ein bereits vorhandener alternativer Python-Runtime-Pfad als Environment-Setup gilt; der Brief verlangte stattdessen korrekt den Abbruch ohne Workaround.
- **Gut funktioniert:** Die aktualisierten Zeilenanker, die klaren Semantik-Grenzen und die ausdrueckliche Teilerfolg-Regel machten die fuenf kleinen, isolierten Fixes eindeutig umsetzbar und auditierbar.
