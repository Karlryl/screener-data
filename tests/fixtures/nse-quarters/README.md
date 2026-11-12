# NSE-Originalausschnitte für B10

Die bereitgestellten Live-Dateien wurden am 12.11.2026 abgerufen. `manifest.json` nennt die Originaladressen, SHA-256 der Originale und SHA-256 der XML-Ausschnitte. Der Generator hat vorhandene Elemente unverändert übernommen, keine Werte nachgebaut.

- Zwei Firmen, jeweils Konzern-, Einzelabschluss- und Governance-Datei für September 2026.
- Die vollständigen Listen behalten sämtliche Einträge; entfernt wurden nur für diese Prüfung nicht benötigte Felder wie PDF-Größe und HTML-Adresse.
- Die XML-Ausschnitte behalten Umsatz, Gesamtincome, Kapital, Währung, Rundungsstufe, Konzernkennzeichen, Symbol und die zugehörigen Perioden und Einheiten. Die große Lupin-Einzelabschlussdatei wurde von 1.712.984 auf 3.863 Byte gekürzt.
- `yahoo-2026-11-11.json` enthält unveränderte Quartalswerte, Perioden und Umrechnungsfaktoren aus den gesicherten Snapshots des Datenstands 11.11.2026 sowie den SHA-256 jedes Originals.
- `cohort-2026-11-11.json` enthält die 84 eindeutigen Ticker aus den Gruppen `IN_jun_snapHasSep` (68) und `IN_jun_mrqSep` (16) des ursprünglichen Befunds. Es ist eine feste Vergleichsauswahl, keine laufende Beobachtungsliste.

`fetch-nse-quarters.js --offline=tests/fixtures/nse-quarters` importiert ausschließlich mitgelieferte Dateien, ohne Netzersatz. Die älteren Quartalsdateien stehen in den Listen, sind aber nicht Bestandteil dieses Pakets. Deshalb bleiben zwölf ältere Konzernquartale offen. Der erste Live-Lauf prüft die aus Ausschnitten gespeicherten Meldungen erneut am vollständigen Original.

Die Dateinamen der Kontexte entscheiden nichts. Beide Septembermeldungen weisen für den Quartalsumsatz ausdrücklich den Zeitraum 01.07.2026 bis 30.09.2026 aus. Der Halbjahreskontext beginnt am 01.04.2026 und wird nicht verwendet. `RevenueFromOperations` ist die Umsatzzeile; `Income` wird nicht als Ersatz gelesen. `LevelOfRounding` ist nur die Darstellungsstufe, der Umrechnungsfaktor der Rohwerte bleibt 1.
