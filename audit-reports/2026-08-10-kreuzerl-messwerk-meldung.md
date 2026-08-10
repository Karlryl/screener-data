# Kreuzerl-Bau 10.08. — Messwerk-Meldung (Chunk A v2)

## 1. Geänderte Dateien (vollständig)

- `scripts/rank-ic.js`
- `scripts/walk-forward-perf.js`
- `scripts/qc-rho-k2.js`
- `tests/kreuzerl-messwerk-wahrheit.test.js`
- `audit-reports/2026-08-10-kreuzerl-messwerk-meldung.md`

## 2. Befunde: was/warum und Review-Auflagen

### F-CGPT-042

`loadVintage()` bleibt für fehlende oder kaputte Vollarchive tolerant und markiert die gestrippte Rückgabe mit dem aufgelösten Archivpfad; `boardsOf()` und alle Existenzprüfungen laufen deshalb weiter. Erst der scharfe Delivery-IC-Konsum wirft mit `Vollarchiv <pfad> fehlt/kaputt — Delivery-IC ohne PIT-Daten nicht messbar (F-CGPT-042)`, während der unveränderte Bestandstest für den toleranten Fallback grün bleibt.

### R1-SC-007

Board-Tage werden vor `disjointDecisionDates()` anhand des realen `boardsByDate`-Inhalts auf Vintages mit `v.cohort` begrenzt; Sidecar-/Fremd-Tage können das Fenster daher nicht mehr sperren. Der bereits einmal in `evaluate()` gebaute Index wird an den beobachteten Lauf und alle Familienläufe durchgereicht (statt `(2+F)` vollständiger Dateizugriffs-Runden); `datesExcluded` verwendet konsistent dieselbe existierende Board-Datumsbasis.

### AY-SCR-001

Die Benchmark-Wahl prüft für jeden Kandidaten konkret, ob `nearestTradingDay` sowohl Entry als auch Exit auflöst, und hält bei mehreren Qualifizierten die Priorität SPY→QQQ→IWM ein; eine lange zeitfremde Serie verdrängt damit keine kurze passende. Qualifiziert keiner, bleibt `benchmarkInsufficient: true` erhalten und der längste vorhandene Kandidat liefert das Label; die gewählte Serie braucht keine `|| asOfDate`-Ersatzanker mehr, unterschiedliche Ticker über Horizonte erzeugen genau eine rohe `::warning::`-Zeile pro Vintage, und `benchPresent` verlangt nun eine nichtleere `Map`.

Der Kommentar in `rank-ic.js` dokumentiert ausdrücklich die absichtliche Abweichung: Dort bleibt der Benchmark-Anker ohne Verhaltensänderung am ersten vorhandenen Kandidaten.

### BM-SK-002

K2 regressiert CFO/NI jetzt gegen den echten FY-Index `i` statt gegen die verdichtete Position gültiger Punkte, sodass eine NI-Lücke die Zeitachse nicht zusammenschiebt. An `scripts/qc-rho-k2.js` wurde sonst nichts geändert; der bestehende Zwei-Punkte-Anker bleibt grün.

## 3. Rot-zuerst-Ausgaben und grüner Lauf

Rot-zuerst wurde aus `git archive HEAD` in einem temporären Verzeichnis ausgeführt; nur der neue Test wurde hineinkopiert und das bestehende `node_modules` verlinkt:

```text
RED_EXIT=1
FAIL   F-CGPT-042: Existenzpfad bleibt tolerant, erst Delivery-Konsum wirft
       AssertionError [ERR_ASSERTION]: Missing expected exception.
FAIL   R1-SC-007: nicht vorhandener Board-Tag sperrt keinen Entscheidungspunkt
       actual: ['2020-01-01']; expected: ['2020-01-01', '2020-02-01']
FAIL   AY-SCR-001: passende kurze Serie schlaegt lange zeitfremde Serie
       'SPY' !== 'QQQ'
FAIL   AY-SCR-001: ohne Fensterabdeckung bleibt insufficient samt laengstem Label
       actual benchmarkInsufficient: undefined; expected: true
FAIL   BM-SK-002: FY-Luecke bleibt auf der echten Zeitachse
       erwartet 1 auf FY-Indizes 0,2,3; war 1.5
Kreuzerl-Messwerk: 1 bestanden, 5 fehlgeschlagen
```

Der neue Wahrheitstest auf dem Fixstand:

```text
ok   F-CGPT-042: Existenzpfad bleibt tolerant, erst Delivery-Konsum wirft
ok   R1-SC-007: nicht vorhandener Board-Tag sperrt keinen Entscheidungspunkt
ok   AY-SCR-001: passende kurze Serie schlaegt lange zeitfremde Serie
ok   AY-SCR-001: ohne Fensterabdeckung bleibt insufficient samt laengstem Label
ok   AY-SCR-001: SPY gewinnt bei gleicher Fensterqualifikation
ok   BM-SK-002: FY-Luecke bleibt auf der echten Zeitachse
Kreuzerl-Messwerk: 6 bestanden, 0 fehlgeschlagen
```

Die letzten Zeilen des vollständigen GATE_GLOB-Laufs waren:

```text
# tests 1
# suites 0
# pass 1
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 15.704247
FULL_EXIT=1
```

Der einzige Fehlschlag war wie im Brief vorweggenommen `tests/early-detection-confirmatory.test.js`: Das vorgeschaltete `pip install numpy==2.3.5` scheiterte nach fünf Versuchen am gesperrten Proxy (`Tunnel connection failed: 403 Forbidden`), anschließend meldete Python `ModuleNotFoundError: No module named 'numpy'`. Alle übrigen Dateien des Globs liefen grün; die beiden Pflichtanker meldeten `bh-b02-rankic.test.js: 14 ok, 0 fail` beziehungsweise TAP `tests 4, pass 4, fail 0`.

## 4. Offene Punkte / Mess-Wirkungen (Größenordnungen)

- Der vollständige Gate-Exit bleibt ausschließlich wegen der dokumentierten Sandbox-/Netzgrenze bei 1; für einen buchstäblichen Exit 0 muss der Orchestrator NumPy 2.3.5 in einer Umgebung mit Paketquelle bereitstellen und denselben Befehl erneut ausführen.
- R1-SC-007 kann je Board/Horizont einzelne bis mehrere Entscheidungspunkte verschieben beziehungsweise zusätzlich nutzbar machen; die konkrete Größenordnung hängt von Sidecar-Tagen ohne dieses Board ab und Messzahländerungen sind laut Brief freigegeben.
- AY-SCR-001 kann den Benchmark je Vintage/Horizont von SPY auf QQQ/IWM wechseln oder `benchmarkInsufficient` statt eines falschen Ankers setzen; dadurch können alle Alpha-Werte dieses Vintage×Horizont-Fensters betroffen sein.
- F-CGPT-042 verändert heutige nicht-kompaktierte Läufe nicht; beim ersten scharfen Delivery-Paar mit verlorener PIT-Archivkopie wird nun der gesamte falsche Delivery-Messpunkt verhindert statt `n=0` zu produzieren.
- `outputs/quality/_rho-k2.json` ist nach BM-SK-002 fachlich veraltet und wurde auftragsgemäß nicht neu erzeugt; der Orchestrator führt den Neulauf nach dem Merge aus.

## 5. Brief-Feedback

Die präzise Trennung zwischen tolerantem Lade-/Existenzpfad und fail-loud Delivery-Konsum hat den kritischen Schnitt eindeutig testbar gemacht.
