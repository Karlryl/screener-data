# Kreuzerl-Bau 10.08. — Chunk B v2: Waehrungs-Ehrlichkeit

## 1. Geaenderte Dateien (vollstaendig)

- `pull-yahoo.js`
- `scripts/merge-shard-manifests.js`
- `scripts/coverage-gate.js`
- `tests/f-neu-01-ccy-ehrlichkeit.test.js`
- `audit-reports/2026-08-10-kreuzerl-fx-meldung.md`

## 2. Was/warum und Review-Auflagen

Der Mapper markiert die vollstaendig fehlende Waehrung mit Falsy-Logik fuer Nicht-Strings und getrimmte Leerstrings, waehrend `ccyAmbiguous` unveraendert bleibt. Nicht-OTC-Ticker werden vor Konverter und Loeschpfaden mit Status `ccy-missing-completely` uebersprungen, sodass der am echten Dateipfad gepruefte Altbestand byte-identisch bleibt; OTC/Pink laeuft dagegen weiter in F-NY-004 und erreicht `fxConversionFailed`. Der Zaehler steht sowohl im inkrementellen als auch finalen Slim-Manifest, wird von `merge-shard-manifests.js` summiert und laesst erst das harte, nicht mit `continue-on-error` versehene `coverage-gate.js` mit einer rohen `::error::`-Sammelzeile ungleich null enden; der Shard-Prozess gibt nur eine rohe `::warning::`-Sammelzeile aus und erhielt keinen Exit-Umbau. Die Wirkungs-Tests (a)–(f) fuehren Mapper/Skip mit echtem Dateisystem, Leerstring-/Ambiguous-/OTC-Pfade, Merge-Summe und das Gate als Kindprozess aus; ein zusaetzlicher Verdrahtungswaechter pinnt Skip-Reihenfolge und beide Slim-Manifeste.

Aufrufkette im gelesenen Workflow: Shards laufen mit `continue-on-error: true`; danach wird `node scripts/merge-shard-manifests.js` in „Merge shard manifests“ aufgerufen (`daily-pull.yml`, Zeilen 833–843), anschliessend laeuft `node scripts/coverage-gate.js` in „Verify Pull Coverage“ ohne `continue-on-error` (`daily-pull.yml`, Zeilen 869–873). Die Workflow-Datei wurde nur gelesen und nicht geaendert.

## 3. Rot-zuerst-Ausgaben und gruener Lauf

Rot-zuerst wurde aus `git archive HEAD` in einem Temp-Verzeichnis ausgefuehrt, mit verlinktem `node_modules` und hineinkopiertem neuen Test:

```text
RED_EXIT=1
FAIL   (a) ... actual undefined, expected true
FAIL   (b) ... actual undefined, expected true
FAIL   (c) ... actual undefined, expected false
FAIL   (d) ... actual undefined, expected true
FAIL   (e) ... undefined !== 5
FAIL   (f) ... erwartete ::error::-Zeile fehlte
f-neu-01-ccy-ehrlichkeit: 0 bestanden, 6 fehlgeschlagen
```

Der gefixte Einzeltest:

```text
ok   (a) Nicht-OTC: echter Altbestand bleibt byte-identisch; Status und Zaehler feuern
ok   (b) leere Strings gelten als komplett fehlende Waehrung
ok   (c) nur financialCurrency fehlt: ccyAmbiguous bleibt, neuer Kanal schweigt
ok   (d) OTC bleibt im F-NY-004-fxConversionFailed-Loeschpfad erreichbar
ok   (e) Merge summiert n_ccy_missing_completely ueber Shards
ok   (f) hartes Coverage-Gate endet bei gemergtem Feld >0 mit ::error:: und Exit != 0
ok   Verdrahtung: Skip liegt vor Konverter; inkrementelles und finales Slim tragen den Zaehler
f-neu-01-ccy-ehrlichkeit: 7 bestanden, 0 fehlgeschlagen
```

Der vorgegebene Gesamtlauf lief alle Globs bis zum Ende, endete aber ausschliesslich wegen der akzeptierten Sandbox-Ausnahme `tests/early-detection-confirmatory.test.js` ungleich null: der erlaubte Setup-Aufruf `pip install numpy==2.3.5` erhielt am Netz-Proxy `403 Forbidden`, danach fehlte `numpy`. Es gab keinen weiteren `FAIL:`-Eintrag. Letzte Zeilen des Laufs:

```text
TAP version 13
# Subtest: bare-object shape ignores metadata keys
ok 1 - bare-object shape ignores metadata keys
1..1
# tests 1
# pass 1
# fail 0
# duration_ms 16.619537
```

## 4. Offene Punkte / Betriebs-Wirkung

- Erwartete Groessenordnung im echten Lauf: normalerweise `0`; bereits ein einziger Nicht-OTC-Ticker ohne jede Waehrungsangabe macht nach vollstaendig erhaltenem Shard-Manifest den Merge-Gate-Schritt rot. Der betroffene Alt-Snapshot bleibt unveraendert und wird damit nicht durch eine neue USD-Notluege ersetzt.
- Bekannte, akzeptierte Grenze: Der Price-only-Schnellweg refresht Bestands-Snapshots ohne Mapper. Ein dort bereits still als USD gefuehrter Altbestand erreicht den neuen Kanal deshalb erst beim naechsten Voll-Pull; dieser Chunk baut den Schnellweg absichtlich nicht um.
- OTC/Pink ohne Waehrung bleibt bewusst im vorhandenen F-NY-004-Loeschpfad; dort kann ein falsch-waehriger Altbestand weiterhin entfernt werden.
- Einziger Test-Umgebungspunkt ist das fehlende `numpy` nach dem durch den Proxy abgewiesenen Setup; Produktionscode und erlaubte Zieltests benoetigen keine neue Dependency.

## 5. Brief-Feedback

- Die explizite v2-Architektur trennte den neuen Altbestand-erhalten-Pfad klar von der sicherheitskritischen OTC-Loeschung.
- Die Forderung nach Rot-zuerst im archivierten HEAD machte den Unterschied zwischen bestehender Ambiguitaetsmarkierung und neuem harten Signalkanal auditierbar.
- Die Benennung des harten Merge-Gate-Kandidaten war hilfreich; die Workflow-Pruefung bestaetigte `scripts/coverage-gate.js` als erlaubten Zielpunkt.
- Die akzeptierte `early-detection-confirmatory`-Sandbox-Ausnahme war notwendig, weil der einzige erlaubte Netzaufruf am Proxy scheiterte.
