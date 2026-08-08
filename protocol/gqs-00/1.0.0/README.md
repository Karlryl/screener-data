# GQS-00@1.0.0 — eingefrorene Produktionsbaseline

Status: **READY / versiegelt**. Dieses Verzeichnis friert den am 7. August 2026 produktiv ausgeführten Growth-Quality-Score ein. Es ändert keine produktive Scoringdatei, kein Gewicht, keinen Filter, kein Ranking und keinen Export.

## Was hier verbindlich ist

- `formula-registry.json`: maschinenlesbare Semantik, alle 13 Branchenzweige, Tracks, Gewichte, Achsen-, Perioden-, Missingness-, Shrinkage- und Faktorregeln.
- `hash-manifest.json`: SHA-256 des kanonischen Registers und aller JSON-Pflichtartefakte.
- `frozen-calibration.json`: die vollständigen Vergleichsverteilungen des Produktionslaufs vom 7. August.
- `golden-fixtures.json`: 25 echte, outcome-freie Snapshot-Fälle plus einen synthetischen Midrank-Tie.
- `score-traces.json`: vollständige Rechenwege mit Rohinput, Rohachsen, Vergleichsverteilungen, Gewichten, EB- und Coverage-Stufe, Endfaktoren, ungerundetem und UI-gerundetem Score sowie Provenienz.
- `production-equivalence.json`: maschinenlesbarer Vorher-/Nachher-Nachweis.
- `production-provenance.md`: Commit-, Workflow-, Daten- und Artefaktzuordnung.
- `pit-foundation-spec.md`: umsetzbare Point-in-Time-Datenarchitektur; noch nicht produktiv aktiviert.
- `ges-sec-us-pilot-preregistration.json` und `.md`: versiegeltes Pilotprotokoll; ausdrücklich noch nicht ausgeführt.
- `readiness-and-blockers.md`: Status, Verantwortlichkeit und Exit-Kriterium je Voraussetzung.

## Verifikation

```powershell
node scripts/gqs00-freeze.js --verify
node --test tests/scoring/gqs00-freeze.test.js
```

Der Verify-Lauf bricht bei jeder Register-, Source-, Kalibrierungs-, Fixture-, Trace- oder Preregistrierungsabweichung ab. Ein Negativtest verändert testweise ein Gewicht in einer Speicherkopie und beweist, dass sowohl der Registerhash als auch der ALNY-Golden-Score kippen.

`calibration/v4` bleibt bewusst ein separates Metadatum. Die semantische Formelidentität ist `GQS-00@1.0.0`; der bestehende Legacy-Feldname `formulaId` für Branchenzweige wird in den neuen Artefakten als `branchFormulaId` disambiguiert.
