# K2: Fixloop am Parser-Tor gestoppt

> **Auf einen Blick**
> Der neue Füllweg wurde nicht gebaut oder aktiviert, weil der unabhängige Durchgang mit dem aktuellen Parser nur **175 von 300 Berichten (58,33 %)** erkannte und das vorgeschriebene 90-%-Tor damit verfehlte.
>
> - Der Store wächst append-only von **600 auf 900 Ticker**, davon **523 auf 698 parsed**; die alten 600 Firmen und alle alten Abrufquellen bleiben inhaltlich unverändert.
> - Von den **998 sichtbaren Q2/FY-Zielzeilen** sind jetzt **460 statt 168** erfasst, **330 statt 157** parsed; **538** wurden wegen des Stopps noch nicht abgerufen.
> - **0 neue K2-Füllungen**. Alle **2.490** durch denselben Produktionsleser vorbereiteten A-share-Snapshots bleiben bytegleich; ein neuer Board-Rang-Replay wurde nicht durchgeführt.

## Auftrag und Abbruchentscheidung

Der Brief verlangt bei weniger als 90 % Erkennung ausdrücklich einen Stopp nach dem Bericht. Der vollständige feste Durchgang wurde beendet; anschließend wurden nur die vorhandenen Leser und Tests geprüft und dieser Bericht geschrieben. Es gibt keinen neuen Lesepfad, keinen neuen Schalter und keine Aktivierung. Auch der Shadow-Wächter und seine Ausnahmen wurden nicht geändert. Die gewünschte Break-once-Probe eines neuen Agreement-Checks entfällt deshalb und gilt nicht als bestanden.

Der Lauf verwendet den vorhandenen `scripts/fetch-cn-printed.js` mit `cap: 300`, `year: 2026`, `asOf: 2026-11-21`, `onlyNew: true` und dem aktuellen Parser **cn-q3-layout-v3**. Die 300 Ticker waren sämtlich vor diesem Lauf noch nicht im Store und stammen ausschließlich aus dem gemessenen no-baseline/otherwiseFillable-Satz. Es gab 900 Requests und einen Extraktionsfehler mit leerem Text; dieser zählt als benannte Lücke im Nenner. Alte v1/v2-Erfolge zählen nicht zur Quote dieses Durchgangs.

Abrufquelle im Store: `cn-printed-20261122T103035442Z-f5c4f2fb`; Beginn 2026-11-22T10:30:35.442Z. Ergebnis des Abrufskripts und des vorhandenen Schattenberichts: `gate300: false`, Exit-Code **1**.

| Börse | Neue Berichte | parsed | unparsed | Quote |
|---|---:|---:|---:|---:|
| SZ | 150 | 89 | 61 | 59,33 % |
| SS | 150 | 86 | 64 | 57,33 % |
| Gesamt | 300 | 175 | 125 | 58,33 % |

## Benannte Lücken

Die Gründe sind die unveränderten Parser- und Extraktionscodes. Eine nicht erkannte Zeile bleibt eine Lücke. Eine chinesische Beschriftung wurde weder erfunden noch übersetzt.

| Grund | Anzahl | Ein Bericht als Beleg |
|---|---:|---|
| growth-row-unbound | 118 | [001283.SZ](https://static.cninfo.com.cn/finalpage/2026-10-22/1225613475.PDF), Bekanntmachung 2026-10-22; Titel: 2026年三季度报告 |
| revenue-or-ytd-anchor-mismatch | 3 | [002051.SZ](https://static.cninfo.com.cn/finalpage/2026-10-23/1225617226.PDF), Bekanntmachung 2026-10-23; Titel: 2026年三季度报告 |
| extracted-text-empty | 1 | [002083.SZ](https://static.cninfo.com.cn/finalpage/2026-10-21/1225611839.PDF), Bekanntmachung 2026-10-21; Titel: 2026年三季度报告 |
| unknown-growth-offset | 1 | [600828.SS](https://static.cninfo.com.cn/finalpage/2026-10-23/1225616068.PDF), Bekanntmachung 2026-10-23; Titel: 茂业商业2026年第三季度报告 |
| not-first-revenue-row | 1 | [600864.SS](https://static.cninfo.com.cn/finalpage/2026-10-24/1225619766.PDF), Bekanntmachung 2026-10-24; Titel: 哈投股份2026年第三季度报告 |
| unknown-prior-column-layout | 1 | [601908.SS](https://static.cninfo.com.cn/finalpage/2026-10-29/1225636361.PDF), Bekanntmachung 2026-10-29; Titel: 2026年第三季度报告 |

`growth-row-unbound` ist die gemeldete fehlende Bindung der Wachstumszelle an die Umsatzzeile. Dieser Auftrag hat die 118 Fälle nicht durch eine Parseränderung oder zusätzliche Layoutannahmen freigegeben. Eine Behebung liegt außerhalb der erlaubten Zieldateien dieses Briefs.

## Zählebenen und ursprünglicher Stand

Zählebene ist der Ticker. Das Snapshot-Artefakt von Run **44891236922** enthält **2.490 A-share-Snapshots**. Die unveränderte Schattenauswertung mit `applyExchangeCheck(..., {mode: "shadow", context: defaultContext()})` findet **1.011** Zeilen mit `fill.blocked = no-baseline` und `otherwiseFillable = true`. Der Baseline-Tag ist **29.07.2026**.

Der lokale, auf den 21.11. datierte gh-pages-Voll-Export enthält **2.414** A-share-Zeilen. Von den 1.011 Rohkandidaten sind zwölf nicht im Voll-Export; **601026.SS** zeigt Q1 2026. Damit bleiben genau **998** im Brief gemeinte Q2/FY-Zielzeilen: **997 mit Q2 2026 und eine mit FY2025**. Keine davon ist nach dem bestehenden Filter Bank oder Versicherung. Für den Abruf wurde die ausdrücklich benannte Obermenge von 1.011 benutzt; acht der 300 neuen Berichte liegen außerhalb der 998 sichtbaren Zielzeilen.

| Umfang | Erfasst vorher | Erfasst nachher | parsed vorher | parsed nachher | Noch nie abgerufen |
|---|---:|---:|---:|---:|---:|
| Gesamter CNINFO-Store | 600 | 900 | 523 | 698 | nicht als Gesamtmarkt gemessen |
| 1.011 no-baseline-Rohkandidaten | 171 | 471 | 159 | 334 | 540 |
| 998 sichtbare Q2/FY-Zielzeilen | 168 | 460 | 157 | 330 | 538 |

Bei den 998 Zielzeilen ergibt der vorhandene Schattenvergleich nachher **327 agree, 3 mixed-basis und 668 unparsed**. Die letzte Zahl enthält die 538 noch nicht abgerufenen Ticker sowie 130 erfasste, nicht erkannte Fälle. Vorher waren es 156 agree, 1 mixed-basis und 841 unparsed. Auch ein agree ist hier weiterhin nur ein Schattenbefund und keine Füllfreigabe.

Von den fünf im Brief genannten Beispielen bleiben 301218.SZ, 300252.SZ, 002803.SZ und 301607.SZ wegen des Stopps nicht abgerufen. [000536.SZ](https://static.cninfo.com.cn/finalpage/2026-10-20/1225610811.PDF) war bereits parsed und bleibt unverändert.

## Gleicher Datentag vor und nach dem Store-Anhang

Der vorhandene Produktionsweg `prepareSnapshot` mit `revGrowthLeg` wurde vor und nach dem Store-Anhang separat über dieselben 2.490 heruntergeladenen Snapshots ausgeführt. Verglichen wurden je Ticker die gesamte vorbereitete Snapshot-Serialisierung per SHA-256 und alle Wachstumsfelder. Ergebnis: **2.490 von 2.490 identisch**. Auf denselben 2.414 Export-Mitgliedern reproduzieren beide Läufe außerdem die Periodenzahlen des lokalen gh-pages-Exports.

| Sichtbare Wachstumsperiode | Vorher | Nachher |
|---|---:|---:|
| Q3 2026 | 1.154 | 1.154 |
| Q2 2026 | 1.086 | 1.086 |
| FY2025 | 168 | 168 |
| Q1 2026 | 3 | 3 |
| Kein Wachstum | 3 | 3 |

FY2025 umfasst hier ausdrücklich **166 `year`-Zeilen und zwei `yearNewerRecord`-Zeilen** mit `periodEnd = 2025-12-31`. Die im Brief genannten 1.173 / 1.068 / 142 wurden auf dem lokal vorhandenen, nachfolgend festgehaltenen Exportstand nicht reproduziert; ihre Abweichungsursache wurde nicht geklärt. Es wurden keine fremden Vorher-Zahlen in den gemessenen Vergleich übernommen.

Dies ist ein gemessener Vorher/Nachher-Vergleich des **reinen Store-Anhangs**, kein Nachweis der gewünschten neuen Füllfunktion. Es gab **0 neue K2-Füllungen**; die bisherigen Füllungen bleiben unverändert. Der vollständige Scoring-Replay für HyperGrowth und Rule of 40 wurde wegen des Parser-Stopps nicht ausgeführt. Daher werden weder Top-50-Eintritte/Austritte noch größte Rangbewegungen als gemessen ausgegeben.

## Zehn Quellenvergleiche ohne Füllung

Alle folgenden Fälle wurden in diesem neuen Durchgang erkannt und stimmen im bestehenden Schattenbericht mit Eastmoney überein. Ihr angezeigtes Wachstum bleibt unverändert. Die Spalte zum Vorjahr nennt bei `inverted-printed-growth` das aus dem gedruckten Wachstum abgeleitete Rundungsintervall; dieses Intervall ist kein exakt gedruckter Vorjahresbetrag. Eastmoney ist unverändert 9M minus H1, jeweils CNY.

| Ticker / Bericht | Wachstum vorher | Wachstum nachher | Im Bericht: Q3 2026 / Wachstum | Vergleichbares Q3 2025, CNY | Eastmoney Q3 2025, CNY |
|---|---:|---:|---|---|---:|
| [001258.SZ](https://static.cninfo.com.cn/finalpage/2026-10-23/1225616755.PDF), S. 1 | 35,61 % | 35,61 % | 393.993.044,49 CNY; 14.61% | aus Wachstum: 343.753.474,23 bis 343.783.468,87 | 343.756.671,22 |
| [001285.SZ](https://static.cninfo.com.cn/finalpage/2026-10-26/1225618992.PDF), S. 2 | 33,00 % | 33,00 % | 811.846.308,63 CNY; 38.21% | aus Wachstum: 587.379.306,61 bis 587.421.807,20 | 587.407.297,75 |
| [001298.SZ](https://static.cninfo.com.cn/finalpage/2026-10-30/1225639443.PDF), S. 2 | 100,41 % | 100,41 % | 4.658.600.203,31 CNY; 107.58% | aus Wachstum: 2.244.189.225,28 bis 2.244.297.339,91 | 2.244.243.766,35 |
| [001309.SZ](https://static.cninfo.com.cn/finalpage/2026-10-26/1225620615.PDF), S. 2 | 228,04 % | 228,04 % | 11.644.701.189,40 CNY; 356.64% | aus Wachstum: 2.550.055.555,06 bis 2.550.111.399,57 | 2.550.073.103,46 |
| [001323.SZ](https://static.cninfo.com.cn/finalpage/2026-10-29/1225637117.PDF), S. 2 | -3,83 % | -3,83 % | 1.221.524.262,23 CNY; -4.83% | aus Wachstum: 1.283.450.761,47 bis 1.283.585.627,32 | 1.283.513.922,80 |
| [001328.SZ](https://static.cninfo.com.cn/finalpage/2026-10-23/1225616178.PDF), S. 3 | 13,19 % | 13,19 % | 464.368.361,24 CNY; 20.16% | aus Wachstum: 386.442.276,23 bis 386.474.438,22 | 386.465.652,09 |
| [001382.SZ](https://static.cninfo.com.cn/finalpage/2026-10-27/1225622267.PDF), S. 2 | -10,76 % | -10,76 % | 916.633.468,46 CNY; 23.93% | aus Wachstum: 739.608.236,94 bis 739.667.918,87 | 739.624.746,82 |
| [002004.SZ](https://static.cninfo.com.cn/finalpage/2026-10-26/1225618901.PDF), S. 2 | -1,05 % | -1,05 % | 2.806.479.355,92 CNY; -10.65% | aus Wachstum: 3.140.819.602,61 bis 3.141.171.141,00 | 3.140.956.336,25 |
| [002011.SZ](https://static.cninfo.com.cn/finalpage/2026-10-27/1225626236.PDF), S. 2 | 12,56 % | 12,56 % | 3.535.790.171,03 CNY; 18.12% | aus Wachstum: 2.993.261.520,44 bis 2.993.514.939,71 | 2.993.399.552,04 |
| [002023.SZ](https://static.cninfo.com.cn/finalpage/2026-10-30/1225644467.PDF), S. 2 | -1,65 % | -1,65 % | 363.558.251,32 CNY; -6.71% | aus Wachstum: 389.686.747,75 bis 389.728.521,55 | 389.710.292,12 |

Wörtliche Zahlen zum Wiederfinden im jeweiligen Bericht:

- [001258.SZ](https://static.cninfo.com.cn/finalpage/2026-10-23/1225616755.PDF), Seite 1: `393,993,044.49` und `14.61%`; gedruckte Einheit entspricht 1 CNY.
- [001285.SZ](https://static.cninfo.com.cn/finalpage/2026-10-26/1225618992.PDF), Seite 2: `811,846,308.63` und `38.21%`; gedruckte Einheit entspricht 1 CNY.
- [001298.SZ](https://static.cninfo.com.cn/finalpage/2026-10-30/1225639443.PDF), Seite 2: `4,658,600,203.31` und `107.58%`; gedruckte Einheit entspricht 1 CNY.
- [001309.SZ](https://static.cninfo.com.cn/finalpage/2026-10-26/1225620615.PDF), Seite 2: `11,644,701,189.40` und `356.64%`; gedruckte Einheit entspricht 1 CNY.
- [001323.SZ](https://static.cninfo.com.cn/finalpage/2026-10-29/1225637117.PDF), Seite 2: `1,221,524,262.23` und `-4.83%`; gedruckte Einheit entspricht 1 CNY.
- [001328.SZ](https://static.cninfo.com.cn/finalpage/2026-10-23/1225616178.PDF), Seite 3: `464,368,361.24` und `20.16%`; gedruckte Einheit entspricht 1 CNY.
- [001382.SZ](https://static.cninfo.com.cn/finalpage/2026-10-27/1225622267.PDF), Seite 2: `916,633,468.46` und `23.93%`; gedruckte Einheit entspricht 1 CNY.
- [002004.SZ](https://static.cninfo.com.cn/finalpage/2026-10-26/1225618901.PDF), Seite 2: `2,806,479,355.92` und `-10.65%`; gedruckte Einheit entspricht 1 CNY.
- [002011.SZ](https://static.cninfo.com.cn/finalpage/2026-10-27/1225626236.PDF), Seite 2: `3,535,790,171.03` und `18.12%`; gedruckte Einheit entspricht 1 CNY.
- [002023.SZ](https://static.cninfo.com.cn/finalpage/2026-10-30/1225644467.PDF), Seite 2: `363,558,251.32` und `-6.71%`; gedruckte Einheit entspricht 1 CNY.

## Verifikation und unveränderte Grenzen

`assertAppendOnly` besteht. Alle alten 600 Firmenobjekte und sämtliche alten Quellenobjekte sind unverändert. `about` und `shadow: true` bleiben unverändert. Der CN-Store, die zehn übrigen festgehaltenen Quell-/Konfigurations-/Testdateien und alle 16 Dateien des gelesenen Baseline-Tags sind per SHA-256 unverändert. Keine Historie wurde geschrieben; es gab keinen Commit, Push, Konfigurationsbefehl, Lösch- oder Verschiebeauftrag und keine neue Dependency.

Die Suche `rg -l "exchange-quarter-check|cn-printed" tests lib scripts -g "*test.js"` fand 19 Testdateien. Alle wurden nach dem Store-Anhang jeweils mit `node <Datei>` ausgeführt und endeten mit Exit-Code 0. Darunter Parser 77, B11b 130, B11c 330, Fetch 20, Exchange-Check 42 und Absent-Row 12 bestandene Prüfungen; der unveränderte Shadow-Wächter erkennt seine acht absichtlichen unerlaubten Leser. Die bestehende Exchange-Check-Suite meldet 27 absichtlich rote Break-once-Proben, aber keine davon ist ein Test des nicht gebauten K2-Füllwegs.

Vorgeschriebener Gesamtbefehl:

```text
node --test tests/exchange-quarter-check.test.js tests/cn-printed-shadow-guard.test.js tests/cn-printed-shadow-report.test.js tests/yahoo-q4-known-cases.test.js
pass 3
fail 1
cancelled 0
skipped 0
todo 0
Exit-Code 1
```

Die einzige rote Testdatei ist vor und nach der Änderung `tests/yahoo-q4-known-cases.test.js`: `Every quarterly reader/import must be classified`, ausschließlich wegen der bekannten lokalen `.probe-unrouted.js`. Die Datei wurde weder geändert noch klassifiziert. Eine zusätzliche reine Speicher-Diagnose ließ nach fehlgeschlagenen Testfällen weiterlaufen, hielt den Fehler und Exit-Code 1 fest und bestätigte **91 andere bestandene Testfälle**; die Original-Testdatei blieb per Hash unverändert. Das ist keine grüne Freigabe des vorgeschriebenen Befehls.

## Reproduktionsstand und Arbeitsdateien

- Ausgangs-HEAD: `a310349f3f460925ffe17e6ec22abb34397fc39f`.
- Lokaler gh-pages-Stand: `0e24d23b42c3e68177c57dffca9df72e862b14b1`; Voll-Export-Deployment `77a04c4fd4`, Erzeugungszeiten 21.11.2026 11:22:31 bis 11:22:40 UTC.
- GitHub-Artefakt: `snapshots`, ID `14704717273`, 68.625.298 Bytes; ZIP-SHA-256 `de40845ed42ea0488b3a9f0f41b8bc6c5c6bfb83ad0e9ad106ceea86bf31df0f`, stimmt mit GitHub überein.
- CN-Store-SHA-256 vorher und nachher: `80eebf9a7e8d3438603b1dd6681e1934725afa1ae8d20a504cdfce3a7962697d`.
- Printed-Store vorher: `41d2f3053b040f29a5536fdaf6b2c9b6b2bb290b58e5e236368b437255c78585`.
- Printed-Store nachher: `2d08326c9eceea0cda89fe8e1ef4458dc246bb30b5e57de025ecebd3a54f4978`.
- Digest aller vorbereiteten Snapshot-Hashes und Wachstumsfelder, vorher und nachher: `82a02d75e59fcb493ea17fc971746b94bbe45070687eae8704ae1b93324e2f22`.

Der vorgegebene Cachepfad unter `.codex/t/k2-cn-printed-cache` ließ sich wegen fehlenden Schreibzugriffs nicht anlegen. Auch `gh` konnte seine lokale Konfiguration nicht lesen. Der autorisierte Artefaktabruf erfolgte deshalb über den GitHub-Connector; Cache und Downloads liegen stattdessen vollständig außerhalb des Repos unter `C:\Users\Anwender\AppData\Local\Temp\k2-cn-printed-cache-20261122`. Es wurden keine Zugangsdaten umgangen oder ausgegeben.

Dort liegen ZIP und unveränderte Snapshots, `cn-printed-before.json`, `fetch-pass-1.json`, `no-baseline.json`, `target-998-before.json`, `shadow-before.json/.md`, `shadow-after.json/.md`, `current-replay-BEFORE.json`, `current-replay-AFTER.json`, `hashes-before.json`, `verification.json`, der PDF-/Textcache und die Testausgaben unter `tests-final/`. Die alten Arbeitsdateien wurden nicht gelöscht.

## Offene Abnahmepunkte und Brief-Feedback

Offen bleiben die vollständige Abdeckung der 998 Zielzeilen, Füllpfad und Schalter, dessen positive/negative Tests und Agreement-Break-once sowie der vollständige Board-Rang-Replay. Die zehn Belege oben sind Quellenvergleiche ohne Füllung und erfüllen keine Abnahme einer aktivierten Funktion. Der nächste Formelschritt benötigt den im Brief geforderten bestandenen unabhängigen Durchgang mit dem aktuellen Parser; in diesem Auftrag wurde kein Ersatzkriterium erfunden.

Der Brief grenzt die Änderung präzise ab, und das 90-%-Parser-Tor verhindert hier korrekt eine Aktivierung. Die Forderung nach Exit-Code 0 widerspricht jedoch der gleichzeitig ausdrücklich zu erhaltenden lokalen roten Reader-Klassifikation.
