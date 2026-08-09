# P1-Chunk 3 — Schlussmeldung

## 1. Geaenderte Dateien (vollstaendige Liste)

- `audit-reports/2026-08-09-p1-chunk3-meldung.md`
- `scripts/watch-exchange-coverage.js`
- `scripts/watch-fx-sanity.js`
- `scripts/watch-unrouted-quote.js`
- `scripts/check-pull-stats.js`
- `scripts/plan-check.js`
- `scripts/watch-annual-spikes.js`
- `tests/p1-welle3-waechter-wahrheit.test.js`

## 2. Je Cluster: was und warum

- **Cluster A:** Exchange- und FX-Waechter unterscheiden ENOENT von einer vorhandenen unlesbaren Baseline; Korruption fuehrt laut zu Exit 1 und niemals zum Baseline-Write. Der FX-Waechter schreibt ausserdem nach einem Null-Scan keine Null-Anker.
- **Cluster B:** Der Unrouted-Waechter wirft bei korrupter Label-Baseline und behandelt `routable=0` als sichtbaren Fehlerzustand ohne Gesundmeldung und ohne Write. Echte Erstanlage per ENOENT bleibt erlaubt.
- **Cluster C:** `uncheckedStats` nennt jede wegen null oder unvollstaendiger Referenz nicht pruefbare Metrik im ansonsten driftfreien Gesamtfazit. Damit bleibt `priceTickerCount` nach einem Store-Lesefehler sichtbar.
- **Cluster D:** Manifest- und Verzeichnis-Lesefehler werden als `measurement_errors` und `NICHT MESSBAR` in Status und Bericht getragen. Sobald ein solcher Grund vorliegt, kann der Bericht nicht mehr `Universe/Detektoren/Cache im Rahmen` behaupten; der Selftest deckt null/null ab.
- **Cluster E:** Gewaehlt ist der Median der juengsten zusammenhaengenden positiven Phase; alte Seed-Nullen vor dem letzten Lebensbeginn verzerren den Anker nicht, eine nachfolgende Null beendet aber weiterhin die Phase nicht durch Baseline-Fortschreibung. Live-Probe: KOSDAQ `[0×8,68,71,72,70,72,72]` wird bei 0 heute alarmierbar (aktive Median-Referenz 71,5); Kuala Lumpur, Dubai und `(unknown)` bleiben mit je 14 Nullen bewusst still, weil nie ein laufender Zustand belegt war.
- **Cluster F:** Neue Schluessel verwenden Periodenende, soweit vorhanden, sonst die stabile Wert-/Nachbar-Signatur statt Array-Index. Zwei-Generationen-Lesbarkeit wurde gewaehlt: alte Indexschluessel akzeptieren den bisherigen Index und genau die Verschiebung `+1` durch ein neues Geschaeftsjahr; neue Baselines schreiben nur die stabile Form, die produktive Datendatei blieb unangetastet.

## 3. Test-/Verifikationsausgabe

### Rot-Beweis gegen unveraenderten Stand (`git archive HEAD` vor dem Fix)

Ausgefuehrt wurde die neue Testdatei in einem Archiv des Vorher-Stands (mit dem vorhandenen `node_modules` verlinkt):

```text
FAIL   Cluster A: korrupte Exchange-/FX-Baselines sind kein Erstseeding
FAIL   Cluster B: korrupte Label-Baseline wirft; leerer Scan ist sichtbar leer
FAIL   Cluster C: Null-Metrik bleibt im Gesamtfazit als ungeprueft sichtbar
FAIL   Cluster D: nicht messbare Manifest-/Snapshot-Fakten verbieten "im Rahmen"
FAIL   Cluster E: aktive KOSDAQ-Phase alarmiert trotz alter Nullen; tote Reihen bleiben still
FAIL   Cluster F: stabile Signatur ueberlebt Indexverschiebung und liest Altbestand
P1-Welle 3: 0 bestanden, 6 fehlgeschlagen
EXIT_CODE=1
```

### Gruener Lauf der neuen Repro-Datei

```text
ok   Cluster A: korrupte Exchange-/FX-Baselines sind kein Erstseeding
ok   Cluster B: korrupte Label-Baseline wirft; leerer Scan ist sichtbar leer
ok   Cluster C: Null-Metrik bleibt im Gesamtfazit als ungeprueft sichtbar
ok   Cluster D: nicht messbare Manifest-/Snapshot-Fakten verbieten "im Rahmen"
ok   Cluster E: aktive KOSDAQ-Phase alarmiert trotz alter Nullen; tote Reihen bleiben still
ok   Cluster F: stabile Signatur ueberlebt Indexverschiebung und liest Altbestand
P1-Welle 3: 6 bestanden, 0 fehlgeschlagen
```

### Gesamtlauf (letzte Zeilen)

```text
# tests 1
# suites 0
# pass 1
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 16.595931
EXIT_CODE=1
```

Der einzige Fehlschlag war `tests/early-detection-confirmatory.test.js`: Das im Brief erlaubte `pip install numpy==2.3.5` scheiterte am gesperrten Package-Netz (`Tunnel connection failed: 403 Forbidden`), danach meldete der unveraenderte verbotene Early-Detection-Test `ModuleNotFoundError: No module named 'numpy'`. Alle uebrigen Gate-Dateien liefen gruen; insbesondere `tests/scoring/bh-w2-watchers.test.js` meldete `15 ok, 0 fail`.

## 4. Offene Punkte / Unsicherheiten / gemeldete Workflow-Folgen

- **FERTIG-WENN Gesamtsuite: UNERFUELLT wegen Environment-Limit:** Der exakte Gate-Befehl endet nur wegen des fehlenden, nicht installierbaren NumPy mit Exit 1; gemaess Brief wurde weder ein Netzwerk-Workaround gebaut noch der verbotene Early-Detection-Pfad veraendert.
- Exchange/FX/Unrouted geben bei vorhandener korrupter Baseline nun Exit 1 aus; Unrouted gibt zusaetzlich bei `routable=0` Exit 1 aus. Das ist die verlangte fail-loud-Semantik; der aufrufende Workflow muss fachlich nicht geaendert werden, kann aber nun in diesen Blindheitsfaellen rot werden.
- Der Jahresdaten-Snapshot-Vertrag stellt fuer diese drei Annual-Reihen derzeit keine Periodenenden bereit; deshalb ist die stabile Fallback-Identitaet die exakte Werte-Dreiergruppe. Identische Dreiergruppen innerhalb derselben Ticker/Reihe wuerden bewusst als derselbe Befund gelten; das ist enger als ein pauschales Ticker/Reihe-Matching.
- Alle sechs Cluster sind umgesetzt; keine Datei unter `src/scoring/`, `tests/scoring/`, `protocol/`, `data-health/`, `.github/` oder mit `early-detection` im Pfad wurde veraendert.

## 5. Brief-Feedback

- **Unklar/fehlte:** Fuer Cluster F fehlte der explizite Hinweis, dass die gespeicherten Annual-Reihen im aktuellen Snapshot-Vertrag keine Periodenenden tragen, weshalb die vorgeschlagene Datumsidentitaet nicht direkt verfuegbar ist.
- **Gut funktioniert:** Die aktuellen Zeilenanker, die eng begrenzten Zieldateien und die ausdrueckliche Teilerfolgs-/Environment-Melderegel machten Scope und Abbruchkriterien eindeutig.
