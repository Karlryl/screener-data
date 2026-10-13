# Findash-Firmenname: Umsetzungsplan

1. In den bestehenden Scoring-/Exporttests zuerst einen fehlschlagenden Roundtrip-Test für `meta.name` ergänzen.
2. In `src/scoring/score.js` den Namen vor dem Entfernen des Snapshots normalisieren und über `produceRankings` erhalten.
3. In `scripts/write-findash-export.js` und den v1-Vertragsfixtures `name` additiv durchreichen.
4. Export-Selftest, Vertragsgate und Vollsuite ausführen.
5. Beweisen, dass bei Entfernung des Namensfelds außerhalb des Vergleichs alle bestehenden Exportdaten unverändert bleiben.

