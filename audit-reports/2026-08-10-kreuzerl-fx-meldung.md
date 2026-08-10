# Kreuzerl-Bau 10.08. — Chunk B v2: Waehrungs-Ehrlichkeit

## 1. Geaenderte Dateien (vollstaendig)

- `pull-yahoo.js`
- `scripts/merge-shard-manifests.js`
- ~~`scripts/coverage-gate.js`~~ — im Nachzug (Abschnitt 6) zurueckgenommen, unveraendert gegenueber `main`
- `scripts/ccy-alarm-gate.js` (neu, Nachzug)
- `.github/workflows/daily-pull.yml` (Nachzug, nur die eine Zeile im Sammel-Schritt)
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

## 6. Review-Nachzug (Tag 629, zwei Reviews)

Die Abschnitte 1–5 beschreiben den v2-Stand (Tag 628). Der Nachzug korrigiert daran vier Punkte;
wo er einer Aussage oben widerspricht, gilt dieser Abschnitt.

- **Signalweg (HOCH, beide Reviews).** Der v2-Exit in `scripts/coverage-gate.js` ist **entfernt** —
  die Datei ist gegenueber `origin/main` wieder unveraendert. Grund: „Verify Pull Coverage" laeuft im
  `merge`-Job VOR Pull Historical Prices, den vier Daten-Waechtern, ATH-State und „Commit Snapshots";
  ein Exit dort wuergt den Tageslauf ab, bevor irgendetwas committet ist, und der `scoring`-Job
  (`needs: merge`) liefe gar nicht mehr. Stattdessen: neues Skript `scripts/ccy-alarm-gate.js`, das nur
  `snapshots/_manifest.json` liest, bei `n_ccy_missing_completely > 0` eine `::error::`-Sammelzeile
  ausgibt und mit Exit 1 endet; fehlendes Feld, fehlende oder kaputte Datei ergeben Exit 0 (das ist
  Sache der bestehenden Gates). Aufgerufen wird es im bestehenden Schritt „Daten-Waechter einsammeln
  (rotes X)" — das im Workflow selbst dokumentierte Muster „erst alles schreiben und committen, DANN
  einsammeln und rot faerben". Schwelle bleibt `> 0`, ohne Toleranz und ohne Ventil (Karl-Entscheid).
- **mcap-Ausnahme (HOCH).** Der Kanal feuert nur noch bei Antworten mit belastbarem `marketCap`
  (non-null, endlich). Duenne Yahoo-Antworten ohne `marketCap` — tote Ticker, im Manifest-Pool
  3527 `skipped-mcap` + 1855 `failed` — liefen bisher in den `skipped-mcap`-Loeschpfad (F-DQ-016);
  ohne diese Ausnahme haette der neue Skip sie konserviert **und** jeden Lauf rot gefaerbt.
- **OTC-Leerstring-Loch (MITTEL).** Die OTC-Ausnahme im Skip-Guard greift nur noch bei
  `meta.ccyAmbiguous === true` — nur dann faengt F-NY-004 (`_convertSnapshotToUSD`) den Fall
  nachweislich. Bei Leerstring-Waehrungen (`''` statt `null`) ist `ccyAmbiguous` false, F-NY-004 blieb
  untaetig und es blieb beim stillen USD; solche OTC-Faelle loesen jetzt den neuen Kanal aus.
  F-NY-004 selbst wurde nicht angefasst.
- **Waechter am Objekt (HOCH).** Der frueher tautologische Altbestand-Test blieb gruen, als das
  `return;` im Skip-Block testweise entfernt wurde. Ersetzt durch einen Quelltext-Waechter, der im
  Block zwischen `const canonical = mapYahooToCanonical` und `_convertSnapshotToUSDGuarded` die exakte
  Form `if (preserveSnapshotForMissingCurrency(...)) { … return; }` festnagelt und sich selbst prueft
  (gueltige Form muss durchgehen, entferntes `return;` und entfernter Block muessen auffliegen).
  Ausbau-Probe gefahren: mit entferntem `return;` 12 bestanden / 1 fehlgeschlagen, Exit 1; nach dem
  Zurueckbauen wieder 13/0.

### Bewusst nur dokumentiert (kein Bau in diesem Chunk)

1. **Shard-Timeout.** Ein Shard-Timeout wirft das Shard-Manifest ohnehin weg (vorbestehendes
   Workflow-Verhalten). In dem Fall ist auch dieser Kanal blind — die betroffenen Ticker tauchen im
   gemergten Zaehler nicht auf.
2. **`smallcap-pull.yml` hat kein Gate.** Dort bleibt es bei der `::warning::`-Sammelzeile aus
   `pullAll`; ein rotes X gibt es auf dieser Strecke nicht.
3. **Price-only-Schnellweg.** Refresht Altbestand ohne Mapper (siehe Abschnitt 4) — ein dort still als
   USD gefuehrter Snapshot erreicht den Kanal erst beim naechsten Voll-Pull.
4. **Grenze des Waechters.** `processOne` ist eine Closure in `pullAll` und von aussen nicht
   aufrufbar; ein echter Ausfuehrungstest des Skips im Lauf-Kontext ist damit nicht moeglich. Der
   Quelltext-Waechter ist der zweitbeste Beleg, kein Ersatz — bei einem Umbau von `pullAll` muss er
   mitgezogen werden.
