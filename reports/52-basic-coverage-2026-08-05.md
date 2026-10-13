# Basic-Average-Shares-Abdeckung in FTS-Caches

Stand: 2026-08-05 (offline, erzeugt mit `node scripts/count-basic-coverage.js`)

## Hauptbefund

`basicAverageShares` ist in den untersuchten Cache-Dateien nicht als Rohfeld vorhanden: **0 / 19870 Firmenjahre (0.00%)**. Das ist keine Aussage, dass Yahoo fuer diese Jahre keinen Basic-Wert geliefert hat. Der Cache-Writer loest je Jahres-Row zuerst `dilutedAverageShares`, dann `basicAverageShares` auf und speichert anschliessend nur die resultierende, quellenlose Reihe `ftsAnnualShares` (`pull-yahoo.js:2806-2810`, Cache-Write `pull-yahoo.js:2838-2843`). Die Herkunft eines gespeicherten Werts ist deshalb nachtraeglich nicht mehr bestimmbar.

## Zaehllauf

| Menge | Cache-Dateien | Parse-Errors | Firmenjahre (FTS annual) | Direkte numerische `basicAverageShares`-Werte | Aufgeloeste `ftsAnnualShares`-Werte |
| --- | ---: | ---: | ---: | ---: | ---: |
| Alle FTS-Caches | 5054 | 0 | 19870 | 0 / 19870 (0.00%) | 12078 / 14030 (86.09%) |
| Small-Cap-Routing-Proxymenge | 101 | 0 | 456 | 0 / 456 (0.00%) | 383 / 451 (84.92%) |

Zusatz zur Proxymenge: `snapshots-smallcap/` enthaelt **103** Dateien; **101** haben eine gleichnamige Cache-Datei. **2** Small-Cap-Snapshots ohne gleichnamigen Cache wurden nicht in die Cache-Zeilen aufgenommen.

## Routing-Definition fuer die eingeschraenkte Auswertung

Die Lampe liefert nur dann eine Aussage, wenn der Small-Cap-Aufrufer einen Kohorten-Kontext `shareGrowthPctlFn` bereitstellt (`src/scoring/lamps.js:549-572`); die Reihe selbst bevorzugt SEC und faellt sonst auf `annualShares` zurueck (`src/scoring/lamps.js:482-489`). Die genaue zur Laufzeit geroutete Menge ist in den laut Brief erlaubten Offline-Dateien nicht vollstaendig rekonstruierbar. Daher ist die zweite Tabellenzeile bewusst als **Proxy** definiert: jeder Dateiname in `snapshots-smallcap/`, der exakt mit einem Dateinamen in `fundamentals-cache/` uebereinstimmt.

Diese Definition misst die vorhandene lokale Small-Cap-Teilmenge, nicht die vollstaendige historische Runner-Menge und auch nicht nur ausgeloeste Lampen. Sie ist deshalb nicht mit einer extern genannten Referenzzahl gerouteter Zeilen gleichzusetzen.

## Methodik und Grenzen

- Es wurden alle `.json`-Dateien in `fundamentals-cache/` offline gelesen. Nicht parsebare Dateien werden als Parse-Error gezaehlt, nicht repariert und tragen keine Werte bei.
- Ein Firmenjahr ist hier ein Positions-Slot der laengsten Jahresreihe in `payload.ftsAnnual` je Cache-Datei. Der Nenner umfasst damit auch alte Cache-Formen ohne `ftsAnnualShares`.
- Der direkte Basic-Zaehler durchsucht jede parsebare Cache-JSON rekursiv nach `basicAverageShares` und `basic_average_shares`; nur numerische Blattwerte zaehlen als vorhandene Basic-Werte.
- Die zusaetzliche Spalte `ftsAnnualShares` zaehlt die gespeicherten aufgeloesten Jahreswerte. Sie zeigt die messbare Reihendeckung, kann aber nicht in diluted versus basic aufgeteilt werden.
- Es werden keine Pipeline-, Lampen- oder Scoring-Dateien geaendert und keine Netzquelle verwendet.
