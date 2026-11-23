# Karten-Datenvertrag: Vorher/Nachher am Datentag 2026-11-21

> **Auf einen Blick:** Die neuen Exportfelder für die findash-Firmenkarte (`price12m`, `athReason`, FCF-Marge auf allen Boards) ändern keinen Rang, keinen Score und keine Reihenfolge: 0 Abweichungen bei 22.469 Zeilen in 50 Exportdateien.
> - Gleicher Datentag (`RUN_DATE_UTC=2026-11-21`), gleiche Snapshots (Artefakt `snapshots` des Tageslaufs 44891236922), gleicher Kurs- und ATH-Stand (Commit-Stand von `ab6e9e44`), gleiche Screener-Ausgabe; nur der Export-Code wechselt.
> - Die FCF-Marge auf den Score-Boards ist bei allen Firmen, die auch auf dem Rule-of-40-Board stehen, gleich in Wert, Zeitraum und Quelle (Übersichten: 107 von 107; die Blindprüfung zählte über alle Dateien 1.050 von 1.050).

## Ablauf

1. Frischer lokaler Klon auf `ab6e9e44` (main vor der Änderung), Snapshots aus dem Artefakt eingespielt.
2. `node scripts/fcf-ttm-overlay.js apply` (15.769 Snapshots), `node src/scoring/run-screener.js` (13 Branchen, 11 Quality-Boards, Universum 15.769).
3. Vorher: `write-findash-export.js` und `write-rule40-export.js` mit dem Code von `ab6e9e44`, Ausgabe gesichert.
4. Nachher: dieselben zwei Schritte mit dem Code von `8231831d`, ohne die Screener-Ausgabe neu zu rechnen.
5. Kontrolle: Schritt 3 ein zweites Mal mit dem Code von `ab6e9e44`.

## Ergebnis

| Vergleich | Zeilen | Rang | Score | Reihenfolge | übrige geänderte Felder |
|---|---|---|---|---|---|
| vorher gegen vorher (Kontrolle) | 22.469 | 0 | 0 | 0 | nur Laufkennungen in `provenance` (2.604), Beleg-`id`, `creatorSessionId`, `createdAt` (je 9.671), `derivation` (2.405) |
| vorher gegen nachher | 22.469 | 0 | 0 | 0 | genau dieselben Laufkennungen, sonst nichts |

Die Laufkennungen hängen an `lib/export-provenance.js` (`writerSession = randomUUID()`, `createdAt`) und ändern sich bei jedem Lauf, auch ohne Codeänderung. Alle alten Felder sind sonst byte-gleich; neu sind nur die Felder des Vertrags. `--check` meldet nachher dasselbe wie vorher (nur `smallcap/index: boards`, siehe Lücken), `write-rule40-export.js --check` ist grün (484 Zeilen), und keine Zeile hat ein `price12m.toDate`, das von `ath.lastDate` abweicht.

## Dateigrößen (Lesegrenze von findash: 8.388.608 Byte)

| Datei | vorher | nachher | Anteil an der Grenze |
|---|---|---|---|
| `full/industrials.json` (größte Datei) | 7.013.798 | 7.440.110 | 88,7 % (vorher 83,6 %) |
| `full/health-care.json` | 3.355.439 | 3.559.361 | 42,4 % |
| `overview.json` | 1.348.967 | 1.412.436 | 16,8 % |

Die Gründe sind Codes (den Satz baut findash), Kurse haben 6 signifikante Stellen, und ein Grund-Schlüssel steht nur neben einem leeren Wert. Die erste Fassung mit deutschen Sätzen lag bei 7.860.290 Byte (93,7 %). Mit dem anschließenden ATH-Seed (eigener PR) wächst `full/industrials.json` auf 7.454.809 Byte (88,9 %). Unabhängig von dieser Änderung wächst die Datei mit dem Universum; die Grenze in findash (`data-layer/http-get.js`, `DEFAULT_MAX_BYTES`) bleibt deshalb ein offener Punkt für findash.

## Abdeckung der neuen Felder (Nachher, Übersichten)

| Board | Zeilen | `price12m` | `fcfMarginPct` | `ath` |
|---|---|---|---|---|
| Hypergrowth | 200 | 190 (10 mit Grund leer) | 124 (76 mit Grund leer) | 37 (162 `not-seeded`, 1 `reseed-needed`) |
| Quality Compounder | 200 | 187 | 136 | 29 |
| Survival | 85 | 66 | 0 (vor Umsatz, erwartet) | 33 |
| Rule of 40 | 484 | 454 | 484 (wie bisher) | 106 |

Über alle 50 Dateien: `athReason` 11.200-mal gesetzt, `price12m` 12.205-mal, `price12mReason` 593-mal, neue `fcfMarginPct` 7.008-mal, `fcfMarginReason` 5.306-mal.

## Tageslauf: Kursstand

Der Checkout des scoring-Jobs ist der Trigger-Commit, also der Kursspeicher des vorigen Abrufs, während `ath-state.json` aus dem merge-Job des Tages kommt. Der neue Schritt „Price store of the current pull for the card fields“ holt `prices/history` von der Spitze von main (wie der Preisschritt) und setzt `FINDASH_PRICES_DIR`; misslingt das, rechnet der Export mit dem älteren Speicher, und `--check` warnt mit der Zahl der Zeilen, deren `price12m.toDate` von `ath.lastDate` abweicht. Im lokalen Vorher/Nachher stammen Kursspeicher und ATH-Stand aus demselben Commit, dieser Schritt ist hier also nicht gemessen.

## Lücken dieses Vergleichs

- **Small-Cap-Boards:** Das Artefakt enthält nur die Haupt-Snapshots, die Small-Cap-Snapshots (eigener Speicher) fehlten. Lokal entstanden 0 Small-Cap-Boards, auf beiden Seiten gleich; `--check` meldet deshalb auf beiden Seiten nur `smallcap/index: boards`. Für Small-Cap ist das Vorher/Nachher also nicht gemessen. Die Felder entstehen dort im selben Zeilen-Mapper (`mapBoardRow`, Snapshot-Speicher `smallcap`) nach der Rangvergabe.
- **Allzeithoch:** Diese Änderung füllt kein `ath`. Ein Allzeithoch braucht die volle Kurshistorie aus dem lokalen Batch `scripts/backfill-prices-max.js`; ein 400-Tage-Hoch wäre kein Allzeithoch. Neu ist, dass jede leere Zeile ihren Grund trägt. Den Seed für die Board-Zeilen liefert ein eigener PR.
