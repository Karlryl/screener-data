# P1-Welle 6 — Meldung

## 1. Geaenderte Dateien

- `pull-earnings-dates.js`
- `pull-yahoo.js`
- `tests/pull-diet.test.js`
- `tests/p1-welle6-vollabruf-wahrheit.test.js`
- `audit-reports/2026-08-10-p1-welle6-meldung.md`

## 2. Befunde: was und warum

1. **NRD-SK-001:** `loadPreviousCalendar` unterscheidet ENOENT vom unlesbaren oder strukturell ungueltigen Bestand; Korruption erzeugt `::error::`, setzt Exit 1 und beendet vor dem atomaren Schreiben. Damit kann der Coverage-Floor nicht mehr durch ein stilles `{}` entwaffnet werden.
2. **F-CGPT-010:** Der weiter erlaubte Kalender-Fallback meldet jetzt ueber den vorhandenen Warnkanal die genaue Ursache und die Folge `earnings-forced fulls deaktiviert fuer diesen Lauf`. Zusammen mit Befund 1 verhindert dies primaer korrupte Kalender; fehlt der Kalender trotzdem beim Leser, bleibt die Degradierung sichtbar statt still.
3. **F-CGPT-009:** Zeitanker werden in der Reihenfolge `fundamentalsAsOf`, `fetchedAt` bis zum ersten parsbaren Wert geprueft; sind beide nicht parsbar, gilt der Snapshot als faellig. Die Laufwarnung nennt betroffene und davon faellig markierte Snapshots; dieselbe fail-safe Semantik gilt fuer einen bereits eingetretenen Earnings-Trigger.
4. **AW-SK-002:** Gewaehlt wurde das bestehende Feld `pulledAt`: Carry-forward frischt es nicht auf, und Eintraege ueber 30 Tage bleiben zur Datenerhaltung im Ergebnis, zaehlen aber nicht mehr zur frischen Coverage; eine Sammelwarnung nennt sie. Dadurch bleibt `tests/scoring/bh-w2-earnings.test.js` unveraendert und gruen.
5. **S4-EARN-001:** Eine erfolgreiche Yahoo-Antwort ohne Datum nutzt nun explizit denselben `resolveEntry`-Carry-Pfad wie ein Request-Fehler und wird gesammelt gewarnt. Bekannte Daten verschwinden auf diesem Zweig nicht mehr lautlos.
6. **F-CGPT-011:** Jeder der vier FTS-Catches zaehlt seine ausgefallene Serie; am Laufende erscheint `FTS-Teilausfaelle: N Ticker / M Serien`. Als engster Frische-Marker wird `meta.fundamentalsAsOf` bei vier leeren frischen FTS-Serien nicht gesetzt, sodass der betroffene Snapshot nicht als voll-frisch gilt.

### Anpassungen in `tests/pull-diet.test.js`

- `meta-null` erwartet nun `full` statt `price-only`, weil kein Zeitanker Frische beweist.
- `meta-undefined` erwartet nun `full` statt `price-only`, aus demselben fail-safe Grund.
- `meta-no-fundamentalsAsOf` erwartet nun `full` statt `price-only`, wenn auch kein `fetchedAt` existiert.
- `meta-garbage-asOf` erwartet nun `full` statt `price-only`, weil ein alleiniger unparsbarer Anker nicht mehr dauerhaft sperren darf.
- Neu prueft `meta-garbage-primary-uses-fetchedAt`, dass ein parsbares `fetchedAt` nach einem kaputten Primaeranker tatsaechlich als Fallback entscheidet; dies verschaerft statt lockert die Erwartung.

## 3. Rot-zuerst und gruener Gesamtlauf

Rot-zuerst wurde aus `git archive HEAD` (Referenzstand vor dem Diff; Brief-Referenz `f23a72fd`) in einem Temp-Verzeichnis mit verlinktem `node_modules` ausgefuehrt:

```text
EXIT=1
FAIL   Befund 1 ... TypeError: earnings.loadPreviousCalendar is not a function
FAIL   Befund 3 ... TypeError: yahoo.fundamentalsStaleness is not a function
FAIL   Befund 4 ... TypeError: earnings.isFreshEntry is not a function
FAIL   Befund 5 ... TypeError: earnings.carryEntryWithoutDate is not a function
FAIL   Befund 6 ... TypeError: yahoo.ftsFailureSummary is not a function
P1-Welle 6: 0 bestanden, 5 fehlgeschlagen
```

Befund 2 nutzt den laut Brief erlaubten Ausgabe-Beweis: Der Catch emittiert jetzt exakt `::warning::earnings-calendar.json nicht geladen (<Ursache>) — earnings-forced fulls deaktiviert fuer diesen Lauf`; ein isolierter `pullAll`-Integrationstest wuerde den produktiven Grosslauf unverhaeltnismaessig nachbauen.

Der gefixte Waechter endet gruen:

```text
ok   Befund 6: FTS-Teilausfall und komplett leere Serien sind messbar
P1-Welle 6: 5 bestanden, 0 fehlgeschlagen
```

Letzte Zeilen des Gesamtlaufs:

```text
# tests 1
# pass 1
# fail 0
# duration_ms 20.950747
```

Der Gesamtbefehl endete insgesamt mit Exit 1 ausschliesslich an der angekuendigten Sandbox-Ausnahme: `pip install numpy==2.3.5` fand im gesperrten Index keine Distribution, daher scheiterte `tests/early-detection-confirmatory.test.js` mit `ModuleNotFoundError: No module named 'numpy'`. Alle danach ausgefuehrten Gates liefen weiter; kein weiterer `FAIL:`-Eintrag entstand.
Ein zweiter Gesamtlauf mit genau diesem bekannten Test ausgelassen endete mit `EXIT=0`.

## 4. Offene Punkte / Workflow-Wirkungen

- Ein korrupter bestehender Earnings-Kalender macht den Kalender-Pull jetzt rot (statt gruener Ersetzung); Groessenordnung: genau ein Workflow-Fehler pro betroffenem Lauf.
- Ein fehlender oder korrupter Kalender im Yahoo-Pull sowie unparsbare Snapshot-Anker und FTS-Teilausfaelle erzeugen neue Sammelwarnungen; maximal je eine Warnzeile pro Kategorie und Lauf, plus vorhandene Detail-Warns der FTS-Requests.
- Alte Carries koennen den Coverage-Floor jetzt ausloesen, obwohl die Datumswerte erhalten bleiben; die Anzahl entspricht der im Lauf gemeldeten Gruppe `>30 Tage`.
- Offen bleibt nur die bekannte, umgebungsbedingte NumPy-Ausnahme; an verbotenen Zonen und Datendateien gibt es null Aenderungen.

## 5. Brief-Feedback

Die sechs Befunde, die entschiedene Ankerreihenfolge und die erlaubte B2-Ausgabealternative waren ausreichend konkret fuer einen kleinen, kausal pruefbaren Diff.
