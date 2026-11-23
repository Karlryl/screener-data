# Etikett „neuerer Bericht laut Termin-Kalender“: Vorher/Nachher am Datentag 21.11.2026

Auf einen Blick: 247 Board-Zeilen von 164 Firmen und 328 Zeilen des Filter-Feeds bekommen ein Etikett: Laut Termin-Kalender war schon ein Bericht über einen neueren Zeitraum fällig als den gezeigten. Keine Zahl, kein Score, kein Rang und keine Zugehörigkeit ändert sich.

## Regel
Findet die bestehende Regel (Tag 1573) für eine Zeile kein Feld, prüft `lib/stale-period.js` den Termin aus `earnings-calendar.json`. Liegt er am oder vor dem Datentag und mehr als 105 Tage (`CALENDAR_LATER_DAYS`) nach dem Ende eines gezeigten Zeitraums, gilt er als Bericht eines späteren Zeitraums. Das Feld bekommt dann das Etikett mit dem Beleg `kalender`, dem Termin als `end` und dem Code der Quartalsreihe an diesem Tag. Text: „Neuerer Bericht laut Termin-Kalender am TT.MM.JJJJ erwartet, hier noch nicht verwendet: …“. Im Filter-Feed lautet die Kurzform `<Termin>k:<Code>:<Code>`.

## Messung
- Gleiche Eingaben auf beiden Seiten: 15.772 Snapshots des Tageslaufs vom 21.11.2026 (Lauf 44891236922), derselbe `earnings-calendar.json`, `RUN_DATE_UTC=2026-11-21`; Schreiber `write-findash-export`, `write-excluded-list`, `write-rule40-export`, `write-filter-universe`.
- Vorher `lib/stale-period.js` aus main 0c54460ab6, nachher der Stand dieses PR, sonst gleicher Code.
- Vergleich aller JSON-Dateien von `outputs/findash-export/v1` ohne `newerPeriod`, `np`, die Zeitstempel und die bei jedem Lauf neuen Provenienz-Kennungen (`provenance`, `provenanceRunId`, `provenanceManifestSha256`; auch zwischen zwei Läufen mit gleichem Code verschieden): **0 Dateien mit einem anderen Unterschied**.

| Bereich | Etikett vorher (Beleg Quartal / Yahoo) | Kalender-Etikett neu |
|---|---|---|
| HyperGrowth voll (`full/`) | 3.505 / 1.177 | 163 |
| HyperGrowth übrige Dateien (Top, Übersicht, Qualität) | 1.240 / 467 | 67 |
| Rule of 40 | 99 / 32 | 17 |
| Filter-Feed | 3.757 / 2.132 | 328 |

- Kein bestehendes Etikett ändert sich; neu sind nur Zeilen, die vorher keins hatten.
- Codes der neuen Etiketten in `full/`: Umsatzwachstum 135 `anbieter-verzug`, 13 `nur-jahreswerte`, 3 `quartale-zu-alt`; Bruttogewinn-Wachstum 134, 9, 3.
- Abstand Termin zu gezeigtem Umsatz-Zeitraum (151 Zeilen mit Umsatz-Etikett): 108 bis 243 Tage, Median 132. Zwölf Zeilen etikettieren nur das Bruttogewinn-Wachstum, weil der Umsatz schon den neueren Zeitraum zeigt (Beispiel HP: Umsatz bis 30.09.2026, Bruttogewinn bis 30.06.2026, Termin 18.11.2026).
- Warum 105 und nicht 95 Tage: In der ersten Fassung (95 Tage) lagen 1 Board-Zeile und 4 Filter-Zeilen bei 96 bis 105 Tagen, und die geprüften waren der Bericht des gezeigten Zeitraums selbst (GDS.PA: Jahresergebnis am 06.10.2026 für das Jahr bis 30.06.2026, 98 Tage; EXA.PA: verschobener Halbjahresbericht, 101 Tage). Ab 106 Tagen war jeder geprüfte Fall ein späterer Zeitraum (NVDA, ROST, WMT, ENI.MI, DELTA.BK).

## Grenzen
- Ein Termin ist nicht an der Primärquelle geprüft; ein verschobener Bericht bekommt trotzdem das Etikett, daher „erwartet“. Ein Jahres- oder Halbjahresbericht später als 105 Tage würde falsch etikettiert (auf den Boards vom 21.11. keiner).
- findash liest den Beleg `kalender` erst nach einer Ergänzung in `data-layer/neuerer-zeitraum.js`: Ohne sie verwirft findash die Board-Etiketten still, im Filter-Reiter aber mit dem Hinweis „Ungültige oder unbekannte Filterwerte wurden verworfen (np: …)“. Dieser PR wird deshalb erst nach dem findash-Deploy zusammengeführt.
