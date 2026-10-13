# GQS-00@1.1.0 — eingefrorene Produktionsbaseline

Status: **READY / versiegelt**. Dieses Verzeichnis friert den am 19. August 2026 produktiv
ausgeführten Growth-Quality-Score ein. Es ändert keine produktive Scoringdatei, kein Gewicht,
keinen Filter, kein Ranking und keinen Export — der Code lief bereits so, hier wird er belegt.

## Autoritätskette

| Glied | Beleg |
|---|---|
| Gerichtsurteil | Einmalertrag-Konsequenz, 16.08.2026 — GO mit Auflagen (F-16-Einzelfreigabe) |
| Formelsperre | F-16 punktuell geöffnet, **nur** dieser Fall |
| Karl-Freigabe | 16.08.2026, wörtlich „Ja, so machen" |
| Pull Request | `Karlryl/screener-data#45` |
| Übergangsprotokoll | `transition.json` in diesem Verzeichnis, `status: completed` |

Inhaltlicher Grund der neuen Version: die Einmalertrag-Lampe wird folgenreich. Bei brennender
Lampe fallen fünf Wachstums-Achsen der Zeile weg (`EINMALERTRAG_BLIND`); Renorm-on-drop und
C4-Shrinkage ziehen den Score zum Kohorten-Median.

## Der belegende Lauf

Die Präregistrierung verlangte den **ersten grünen planmäßigen** Automatik-Lauf mit dem neuen
Code. Das ist Lauf **`32211143015`** vom 19.08.2026 (`event=schedule`, `conclusion=success`).
Nicht der Dienstag 18.08., wie das Feld `aufloesung` in `transition.json` erwartet hatte: der
geplante 18.08.-Lauf (`32094300602`) ist rot gelaufen, der grüne 18.08.-Lauf war ein manueller
`workflow_dispatch`.

| Identität | Wert |
|---|---|
| Formelcheckout (`headSha` des Laufs) | `9e2d183178a93d010e977e6c8e4b7aea42c0fef2` |
| `src/scoring`-Tree an diesem Commit | `c20d5ddade35d9f2204f1bcefe18bda24512ebae` |
| Yahoo-Datencommit desselben Laufs | `1f67c81b226a3fae0eced422b5379889a70dc33c` |
| Boardcommit (Vintage 2026-08-19) | `d24a5a53303d26231d9f362dde92fa0dd54c27e1` |

Formelcheckout, Datencommit und Boardcommit sind drei verschiedene, jeweils belegte Identitäten.
Alle Boarddateien des Vintage tragen `formulaCommit=9e2d18…`.

## Reproduktionsnachweis

`production-equivalence.json` ist **kein Fundstück, sondern eine Rechnung**. Sie wurde mit
`scripts/gqs00-equivalence.js` auf dem entpackten `snapshots`-Artefakt des Laufs neu erzeugt,
nicht aus `1.0.0` abgeleitet. Beide Messungen laufen auf demselben geladenen Universum:

| Messung | Umfang | Abweichungen |
|---|---|---|
| Produktions-Checkout gegen Freeze-Code (ungerundet) | 14.801 Ergebniszeilen | 0 Form, 0 Score, 0 Rang |
| Freeze-Code gegen **veröffentlichtes** Board `board-history/2026-08-19` | 8.908 Zeilen über 13 Branchen × 2 Tracks | 0 Ticker, 0 Anzeige-Score, 0 Rang |

Die zweite Messung ist die harte: sie vergleicht lokal neu gerechnete Kohorten gegen das, was
die CI an diesem Tag tatsächlich veröffentlicht hat. Sie reproduziert es zeilengenau.

### Wie die Eingangszahlen gemessen wurden

Alle vier Werte in `production-equivalence.json → input` stammen aus dem geladenen Artefakt,
keiner ist übernommen:

- `snapshotArtifactDigestSha256` = SHA-256 über die Zip-Bytes des `snapshots`-Artefakts von Lauf
  `32211143015`. Deckungsgleich mit dem von der Actions-API gemeldeten `digest` (unabhängig
  nachgerechnet, nicht abgeschrieben).
- `snapshotManifestSha256` = SHA-256 über die Bytes von `snapshots/_manifest.json` im Artefakt.
- `snapshotFiles` = 14.815 = Zahl der `*.json` im Artefakt **ohne** `_manifest.json`.
- `loadedUniverse` = 14.801 = Zeilen, die `loadUniverse()` daraus tatsächlich lädt (14 Namen sind
  nicht mehr in der `watchlist.json` des Lauf-Checkouts, 0 Parse-Fehler).

## Was hier verbindlich ist

- `formula-registry.json`: maschinenlesbare Semantik, alle 13 Branchenzweige, Tracks, Gewichte,
  Achsen-, Perioden-, Missingness-, Shrinkage- und Faktorregeln.
- `hash-manifest.json`: SHA-256 des kanonischen Registers und aller JSON-Pflichtartefakte.
- `frozen-calibration.json`: die vollständigen Vergleichsverteilungen des Laufs vom 19. August.
- `golden-fixtures.json`: 25 echte, outcome-freie Snapshot-Fälle plus einen synthetischen
  Midrank-Tie.
- `score-traces.json`: vollständige Rechenwege mit Rohinput, Rohachsen, Vergleichsverteilungen,
  Gewichten, EB- und Coverage-Stufe, Endfaktoren, ungerundetem und UI-gerundetem Score.
- `production-equivalence.json`: der oben beschriebene Reproduktionsnachweis.
- `ges-sec-us-pilot-preregistration.json` und `.md`: siehe nächster Abschnitt.
- `transition.json`: das abgeschlossene Übergangsprotokoll aus `GQS-00@1.0.0`.

## Präregistrierung: bewusst UNVERÄNDERT übernommen

`ges-sec-us-pilot-preregistration.json`/`.md` sind **byte-identisch** aus `1.0.0` übernommen.
Sie tragen weiter `identity.version: 1.0.0`, `frozenAt: 2026-08-08` und
`baseline: "GQS-00@1.0.0"`.

Das ist kein Versehen. Das Dokument ist ein **eigenes, eingefrorenes Forschungsprotokoll**
(`GES-SEC-US-PILOT@1.0.0`), nicht ein Identitätsfeld des Siegels. `GQS-00@1.0.0` steht dort an
drei inhaltlichen Stellen — `identity.baseline`, `factors.baseline` („executed unchanged on the
same as-of event snapshots") und `benchmarks[0]` — und beschreibt den **Kontroll-Arm** einer
noch nicht ausgeführten Studie. Es auf `1.1.0` umzuschreiben hieße, diesen Kontroll-Arm
auszutauschen; das eigene `abort`-Kriterium des Protokolls verlangt dafür eine neue
Protokollversion mit `changeLog`-Eintrag und ein frisches, ungeöffnetes Testfenster.

**Offene Entscheidung (nicht Sealing-Mechanik):** ob der Pilot seinen Kontroll-Arm auf
`GQS-00@1.1.0` umstellen soll. Diese Frage gehört vor den Court, nicht in diesen Übergang.
Bis dahin gilt: das Pilotprotokoll ist unverändert gültig und referenziert weiterhin die in
`protocol/gqs-00/1.0.0/` byte-identisch erhaltene Baseline.

## Verhältnis zu 1.0.0

`protocol/gqs-00/1.0.0/` bleibt **unangetastet** — der Nachweis des 07.08.-Laufs ist
byte-identisch erhalten. Nach diesem Übergang gilt für `src/scoring/{lamps,score,calibrate}.js`
ausschließlich der 1.1.0-Siegelhash; ein zweiter erlaubter Stand existiert nicht mehr
(`transition.json` liegt nicht mehr unter einem `*-pending`-Verzeichnis **und** trägt nicht mehr
`status: pending`).

## Verifikation

```powershell
node scripts/gqs00-freeze.js --verify
node --test tests/scoring/gqs00-freeze.test.js
```

Der Verify-Lauf bricht bei jeder Register-, Source-, Kalibrierungs-, Fixture-, Trace- oder
Preregistrierungsabweichung ab. Ein Negativtest verändert testweise ein Gewicht in einer
Speicherkopie und beweist, dass sowohl der Registerhash als auch der ALNY-Golden-Score kippen.

Die Source-Dateien werden im Checkout mit LF gehalten. Der Prüfer normalisiert Source-Text vor
dem Hashen auf LF und akzeptiert beim Vergleich ausschließlich den für dieselben Bytes
versiegelten LF- oder historischen CRLF-Hash.

`calibration/v4` bleibt bewusst ein separates Metadatum: es bezeichnet das Kalibrierungsschema,
nicht die semantische Formelidentität. Die ist `GQS-00@1.1.0`.
