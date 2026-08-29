**Ergebnis: Die mechanischen Identity-Bridge-Blocker 2 und 3 sind geschlossen; T159 ist schliessbereit, ohne ein historisches Studienartefakt oder ein bestaetigendes Verdikt zu aendern.**

# R2-A1 - Abschluss der mechanischen Blocker 2 und 3

## Blocker 2: mutationssensitiver Determinismusbeleg

Die feste Eingabefixture `tests/fixtures/studie-identity-bridge-determinism-input.json` ist mit SHA-256 `190b723e4f063e6c57106b899098df39339fda8ac1376837fa219d5e09d43547` gebunden. Ihre abgeleitete logische Nutzlast trifft den vorab gepinnten SHA-256 `6485e5775f2f45d4cb1a241a6ae21fd49d84fad410659b9b913d9a0cf2c26ce9`.

Die absichtliche Aenderung des dritten Komponenten-Datums von `20180930` auf `20180929` erzeugt einen anderen Nutzlast-Hash und laesst den Waechter rot aussteigen. Der maschinenlesbare Nachweis steht in `reports/studie/R2-A1-determinism-fixture-sabotage-2026-08-28.json`.

## Blocker 3: produktiver Nahtwaechter

`write_sharded_artifact` ruft `validate_bridge_write_bundle` vor dem ersten Schreibvorgang auf. Der Waechter prueft das Manifest und jeden Shard; quer ueber eine bekannte Naht abgeleitete Zeilen werden aus den Identifier-Provenienzen erkannt und benoetigen die vollstaendige explizite Markierung.

Eine absichtlich unmarkierte Quernaht-Zeile in einem Shard wurde vor jedem Dateischreibvorgang rot abgewiesen. Der maschinenlesbare Nachweis steht in `reports/studie/R2-A1-bridge-write-sabotage-2026-08-28.json`.

## Bindung und Umfang

Der Abschlussvertrag steht in `protocol/early-detection/2.0.0/r2-a1-blocker2-3-closure-record.json`. Das historische Ergebnisartefakt `reports/studie/R2-A1-identity-bridge-artifact-2026-08-25.json` blieb bytegleich. Es wurden keine Panels, E-Stadien, Outcomes, Preise oder Endtest-Dateien geoeffnet und kein bestaetigendes Verdikt geaendert.

Die im historischen Bericht getrennt benannten Methodik-Korrekturen zu `accepted`-Zeit, Mehrfachnaehten und vollstaendigen Ausschlusszaehlern sind nicht Teil dieses mechanischen Blocker-Abschlusses und bleiben unveraendert offen.
