# K2: Parser-Tor bestanden, Füllweg gebaut und gemessen

> **Auf einen Blick**
> Der Parser `cn-q3-layout-v5` erkannte im neuen, unabhängigen Live-Durchgang **294 von 300 Berichten (98,00 %)**; das 90-%-Tor ist bestanden, alle übrigen Ticker sind abgerufen, und der neue Füllweg füllt am Datentag 21.11. **844 Quartale Q3 2025** zusätzlich.
>
> - Von den **998 sichtbaren Q2/FY-Zielzeilen** sind jetzt alle abgerufen, **850 erkannt, 844 agree**. Sichtbares Wachstum der 2.490 A-Aktien: Q3 2026 **1.164 → 2.008**, Q2 2026 **1.100 → 257**, FY2025 213 → 212.
> - Alle **698 bisher erkannten Ergebnisse** bleiben bei der Nachrechnung bytegleich. Mit Schalter aus sind alle 2.490 A-Aktien-Snapshots und alle Boards bytegleich mit dem heutigen Code.
> - Boards: In den 26 HyperGrowth-Listen wechseln **51** Top-50-Plätze, in Rule of 40 **4**. Die größten Sprünge kommen von Firmen, deren Q3 deutlich anders wuchs als Q2 (etwa 003043.SZ von Rang 29 auf 1.342, Wachstum 45,73 % → -14,75 %).

Stand 22.11.2026, gemessen auf dem Datentag 21.11.2026, Zählebene Ticker. Der Schalter `printedQ3Check` steht im Arbeitsstand auf `true`; live geht er erst nach der Prüfung durch die andere KI. Der frühere, am Tor gestoppte Lauf steht unverändert im Anhang.

## 1. Ursache der 118 Lücken und Reparatur

Die 118 Fälle `growth-row-unbound` haben eine gemeinsame Ursache: `pdftotext -layout` verteilt eine Tabellenzeile auf mehrere Textzeilen, weil Prozent- und Betragszellen in der PDF leicht unterschiedlich hoch stehen. Die Umsatz-Wachstumszelle steht dann je nach Bericht bis zu vier Zeilen unter, über oder neben dem Umsatzbetrag, oft sogar unter dem Gewinnbetrag der nächsten Zeile. v3 bindet sie nur über eine feste Liste bekannter Strukturen; neue Berichte bringen neue Strukturen. Gelesen wurden 001283.SZ, 001308.SZ, 002014.SZ, 000008.SZ, 000042.SZ, 000599.SZ und 600640.SS.

Derselbe Bericht im Modus `pdftotext -table` hält jede Tabellenzeile auf einer Textzeile, etwa 001283.SZ: `2,069,643,151.66  27.08%  5,253,639,627.73  19.63%`. Der neue Parser `cn-q3-layout-v5` arbeitet so:

- Zuerst läuft der unveränderte Layout-Weg (v1 bis v3). Was er erkennt, bleibt exakt so.
- Nur wenn er an der Platzierung der Wachstumszelle scheitert (`growth-row-unbound`, `unknown-growth-offset`, `unknown-prior-column-layout`, `ambiguous-growth-column`, `growth-column-missing`, `unknown-restatement-ytd-layout`), liest er die zweite Extraktion. Dort muss **eine** Textzeile beide Eastmoney-Anker (Q3 und 9M, eindeutig, gleiche Einheit) enthalten, dazwischen null oder zwei Vorjahresbeträge und genau eine Wachstumszelle. Gesucht wird nie auf einer anderen Zeile.
- Alle bisherigen Sperren gelten auch dort: Wertpapierkennung und Jahr im Kopf, erste Tabellenzeile, kein 营业总收入, sichtbare Beschriftung nur 营业收入, fremde Minuszeichen und Klammern, `--`/不适用, Prozentzeichen bei SZ, Rundungsprüfung gegen den gedruckten berichtigten Vorjahresbetrag, Nenner positiv. Neu: kein anderer Text zwischen den Ankern, und eine Zahl mit Tausenderkomma ohne `%` gilt nie als Wachstum.
- Identitäts-, Anker-, Vorzeichen-, Markierungs- und Rechenablehnungen des Layout-Wegs werden nie überstimmt.

Die B11c-Sicherheit bleibt erhalten: Die Wachstumszelle gehört zu ihrer eigenen Tabellenzeile, eine leere Umsatz-Wachstumszelle ergibt eine benannte Lücke. Leerzellenprobe auf allen 1.360 Cachetexten des jetzigen Stores: **0 von 1.030** Layout-Treffern und **0 von 309** Tabellen-Treffern übernehmen nach dem Leeren eine fremde Zahl.

**Der ungeprüfte Codex-Stand ba54c54710 (v4) wurde verworfen.** Seine lokale Strukturregel erkannte 61 weitere Berichte, einen davon falsch: Bei [002093.SZ](https://static.cninfo.com.cn/finalpage/2026-10-29/1225633020.PDF) band sie das Gewinnwachstum `4.59%` statt des Umsatzwachstums `-0.57%` (Eastmoney-Abgleich mixed-basis). Der Tabellenweg erkennt dieselben 61 Berichte und liest dort `-0.57%` (agree). v4 wurde nie gespeichert; die neue Version heißt deshalb v5.

## 2. Offline-Nachrechnung

| Prüfung | Ergebnis |
|---|---:|
| Bisher erkannte Ergebnisse im Store | 698 |
| davon mit Cachetext nachgerechnet (225 PDFs nachgeladen, PDF- und Text-Hash bestätigt) | 698 |
| Werte, Status, Einheit und Belegzeilen identisch, ohne und mit Tabellentext | **698 von 698** |
| v3 und v5 auf reinem Layouttext verschieden | 0 von 597 |
| Gecachter Durchgang f5c4f2fb (300 Berichte) mit v3 | 175 (58,33 %) |
| Derselbe Durchgang mit v5 | **294 (98,00 %)** |

Diese 300 Berichte dienten zum Entwurf und sind keine unabhängige Messung. Ihre 125 gespeicherten Lücken bleiben append-only unverändert; v5 würde 119 davon erkennen.

## 2a. Tor: neuer Live-Durchgang

Abrufquelle `cn-printed-20261122T113623578Z-bdbdd359`, Beginn 22.11.2026 11:36 UTC, `--only-new=true`, `--as-of=2026-11-21`, 300 nie abgerufene Ticker aus den 538 offenen Zielzeilen (150 SZ, 150 SS), 899 Anfragen.

| Börse | Berichte | erkannt | Quote |
|---|---:|---:|---:|
| SZ | 150 | 146 | 97,33 % |
| SS | 150 | 148 | 98,67 % |
| Gesamt | 300 | **294** | **98,00 %** |

108 der 294 kamen über den Tabellenweg. Schattenvergleich: 293 agree, 1 mixed-basis (002891.SZ, siehe 2e), 0 printed-only. Lücken: 002645.SZ, 300093.SZ und 300143.SZ (`growth-row-unbound`, Tabellenzeile nicht gefunden), 603995.SS (`revenue-or-ytd-anchor-mismatch`), 300045.SZ (`ambiguous-revenue-anchors`), 603757.SS (CNINFO-Fehler 599). Wegen dieses einen Abruffehlers endet das Skript mit Exit-Code 1; das Tor (`gate300: true`) ist bestanden. Alle 299 Texte des Durchgangs ergeben mit dem endgültigen Parser bytegleiche Ergebnisse.

Danach wurden die restlichen **240** no-baseline-Ticker abgerufen (`cn-printed-20261122T120916139Z-26c51677`): **228 erkannt (95,00 %)**, 225 agree, 3 mixed-basis. Der Store wächst append-only von 900 auf **1.440 Ticker, 1.220 erkannt**; alle 900 alten Firmen und alle alten Quellen sind unverändert (`assertAppendOnly` bestanden).

| Umfang | erfasst | erkannt | agree | mixed-basis | unparsed |
|---|---:|---:|---:|---:|---:|
| 998 sichtbare Zielzeilen, vorher | 460 | 330 | 327 | 3 | 668 |
| 998 sichtbare Zielzeilen, nachher | **998** | **850** | **844** | 6 | 148 |
| 1.011 no-baseline-Kandidaten, nachher | 1.011 | 856 | 849 | 7 | 155 |

Von den 148 offenen Zielzeilen sind 120 alte v3-Lücken (`growth-row-unbound`).

## 2b. Füllweg

In `lib/exchange-quarter-check.js` wird eine 2025-09-30-Füllung, die alle bisherigen Sperren passiert und nur an `no-baseline` scheitert, zulässig, wenn der CNINFO-Bericht zum Q3 2026 ein vergleichbares Vorjahresquartal druckt, das den einzufüllenden Eastmoney-Wert enthält. Geprüft wird genau der Vergleich des Schattenberichts (`printedEvidence`, jetzt gemeinsam genutzt): neueste Beobachtung, Anker gegen das heutige Eastmoney-9M und -H1, berichtigte Spalte oder Intervall aus dem gedruckten Wachstum, agree mit Eastmoney 9M − H1. Zusätzlich muss der gefüllte Wert selbst im Band liegen, und die Bekanntmachung muss vor dem Snapshot-Tag liegen. Gefüllt wird der Eastmoney-Wert, nie die gedruckte Zahl; Ableitung `printed-check`. Beispiel des Grundes:

> Umsatz 3. Quartal 2025 fehlte beim Datenanbieter und stammt aus der Börsenmeldung (Eastmoney, veröffentlicht 27.10.2025). Dass der Wert gleich abgegrenzt ist wie das aktuelle Quartal, belegt das im CNINFO-Bericht zum 3. Quartal 2026 (veröffentlicht 31.10.2026) gedruckte Vorjahresquartal.

printed-only, mixed-basis, unparsed, fehlende oder zu späte Berichte bleiben `no-baseline`; alle anderen Sperren bleiben unverändert. Ein Schalter: `printedQ3Check` in `configs/exchange-quarter-policy.json`; `false` stellt das heutige Verhalten exakt her. Den Store liest nur `lib/exchange-quarter-check.js` und nur bei eingeschaltetem Schalter (`defaultContext().printed`); `loadStores` liefert weiter nur cn und tw.

**Bewusste Teständerung:** `tests/cn-printed-shadow-guard.test.js` erlaubt genau diese eine Produktionsdatei als Leser. Jede andere Datei bleibt ein Verstoß, die acht absichtlichen Lecks werden weiter erkannt.

## 2c. Vorher/Nachher am 21.11.

Gleiche Eingaben in allen Armen: 15.769 Snapshots des Laufs 44891236922, Juli-Vintage board-history/2026-07-29, Stores cn und tw unverändert (cn.json SHA-256 `80eebf9a…`), derselbe Produktionsweg `prepareSnapshot`, Uhr 21.11.2026 11:22:31 UTC, jeder Arm mit eigener Kalibrierung wie im Tageslauf. Vorher = Schalter aus; dieser Arm ist mit dem heutigen Code bytegleich (Digest der 2.490 vorbereiteten A-Aktien-Snapshots `fba6ffc4…`, Digest aller Boards `cf052c28…`).

| Sichtbare Wachstumsperiode der 2.490 A-Aktien | Vorher | Nachher |
|---|---:|---:|
| Q3 2026 | 1.164 | **2.008** |
| Q2 2026 | 1.100 | **257** |
| FY2025 (Jahr 2025-12-31) | 213 | 212 |
| FY2025 (`yearNewerRecord`) | 2 | 2 |
| Q1 2026 | 3 | 3 |
| ältere Jahre oder kein Wachstum | 8 | 8 |

Füllungen: Juli-Weg unverändert **1.086**, neu **844** `printed-check` (839 davon in den 998 Zielzeilen). Genau diese 844 Firmen ändern ihr Wachstum, keine andere. Herkunft der 844 Belege: 655 Layout-Weg (v1 73, v2 83, v3 170, v5 329), 189 Tabellenweg.

| Board | Top-50 rein / raus | Rangänderungen |
|---|---:|---:|
| HyperGrowth, 26 Listen | 51 / 51 | 7.241 |
| Rule of 40 | 4 / 4 | 476 |

Größte Bewegungen mit neuer Füllung: 003043.SZ HyperGrowth Industrie profitabel 29 → 1.342, 688678.SS 40 → 1.439, 002039.SZ Versorger 2 → 284, 688198.SS Gesundheit 483 → 25, 301150.SZ Industrie 305 → 38. Rule of 40: rein TINS.JK, 300975.SZ, 300497.SZ (253 → 45), 688485.SS (neu gelistet, Rang 42); raus 300153.SZ (42 → 68), 688535.SS (48 → 51), 301099.SZ (49 → 126), 000155.SZ (50 → nicht mehr gelistet). Ein Teil der Wechsel um Rang 50 betrifft nicht gefüllte Firmen; das folgt aus der neuen Kalibrierung.

## 2d. Zehn Belege

Eastmoney ist 9M − H1 in CNY. Das Vorjahr aus dem Bericht ist hier überall das aus dem gedruckten Wachstum berechnete Rundungsintervall (`inverted-printed-growth`), keine gedruckte Zahl. Zum Wiederfinden mit Strg+F dienen Quartalsumsatz und Wachstum in der gedruckten Schreibweise.

| Ticker / Bericht | Wachstum vorher (Q2 2026) | Wachstum nachher (Q3 2026) | Im Bericht: Q3 2026 / Wachstum | Vorjahr aus Bericht, CNY | Eastmoney Q3 2025, CNY |
|---|---:|---:|---|---|---:|
| [301150.SZ](https://static.cninfo.com.cn/finalpage/2026-10-28/1225630026.PDF), S. 2 | 49,96 % | 64,38 % | `2,503,012,468.25` / `64.38%` | 1.522.652.594,97 bis 1.522.745.227,84 | 1.522.700.840,62 |
| [003043.SZ](https://static.cninfo.com.cn/finalpage/2026-10-28/1225627545.PDF), S. 1 | 45,73 % | -14,75 % | `289,419,802.73` / `-14.75%` | 339.475.459,18 bis 339.515.282,70 | 339.489.688,70 |
| [688125.SS](https://static.cninfo.com.cn/finalpage/2026-10-29/1225636812.PDF), S. 1 | 46,50 % | 155,62 % | `405,274,685.78` / `155.62` | 158.542.664,36 bis 158.548.866,77 | 158.545.462,11 |
| [002039.SZ](https://static.cninfo.com.cn/finalpage/2026-10-23/1225615240.PDF), S. 2 | 33,58 % | -41,53 % | `751,846,735.03` / `-41.53%` | 1.285.757.563,10 bis 1.285.977.482,31 | 1.285.849.028,49 |
| [301218.SZ](https://static.cninfo.com.cn/finalpage/2026-10-23/1225616342.PDF), S. 2 | 201,14 % | 107,66 % | `331,793,495.40` / `107.66%` | 159.773.430,96 bis 159.781.125,14 | 159.776.208,50 |
| [300497.SZ](https://static.cninfo.com.cn/finalpage/2026-10-24/1225618658.PDF), S. 2 | 88,80 % | 159,89 % | `661,889,395.99` / `159.89%` | 254.675.694,41 bis 254.685.493,97 | 254.677.075,45 |
| [600509.SS](https://static.cninfo.com.cn/finalpage/2026-10-20/1225610945.PDF), S. 1 | 8,86 % | 37,81 % | `2,567,564,399.70` / `37.81` | 1.863.051.481,84 bis 1.863.186.676,61 | 1.863.098.390,89 |
| [688198.SS](https://static.cninfo.com.cn/finalpage/2026-10-29/1225635591.PDF), S. 1 | -25,42 % | 20,16 % | `160,648,702.96` / `20.16` | 133.690.095,25 bis 133.701.221,73 | 133.694.698,14 |
| [601595.SS](https://static.cninfo.com.cn/finalpage/2026-10-31/1225649247.PDF), S. 1 | 24,01 % | -49,63 % | `181,642,152.39` / `-49.63` | 360.579.955,11 bis 360.651.548,49 | 360.640.942,32 |
| [000536.SZ](https://static.cninfo.com.cn/finalpage/2026-10-20/1225610811.PDF), S. 2 | -18,16 % | 3,47 % | `329,235,788.88` / `3.47%` | 318.179.066,32 bis 318.209.818,67 | 318.181.162,84 |

301218.SZ, eines der früher genannten Beispiele, zeigt jetzt Q3 2026 (Rule of 40: 54 → 302, HyperGrowth IT-Dienste profitabel: 6 → 51).

## 2e. Tests, Grenzen und offene Punkte

- `node --test` mit den sieben Dateien des Briefs: 6 grün; rot nur `tests/yahoo-q4-known-cases.test.js` wegen der bekannten lokalen `.probe-unrouted.js`. Wird nur diese Datei im Speicher aus der Leserliste genommen, laufen alle 92 Prüfungen der Datei grün.
- Einzeln: Parser 113 Prüfungen (5 neue Tabellen-Fixtures je mit Leerzelle, Markierung, fremdem Minus, fremdem Bericht und Identität; Break-once: ein Parser, der die nächste Zeile mit Wachstum nimmt, wird rot), B11c 330, B11b 130, Fetch 20, Schattenbericht 16, Schatten-Wächter grün, Exchange-Check 46 grün mit 29 Break-once (neu: Agreement- und Bandprüfung).
- Alle 242 Testdateien, die einen geänderten Baustein laden, liefen mit `node <Datei>`: 239 grün. Außer der bekannten Datei sind `tests/rev-growth-basis.test.js` (D1) und `tests/export-w8-profit-split.test.js` (S5) rot; beide lesen den lokalen, veralteten Export und sind mit Schalter aus genauso rot, hängen also nicht an dieser Änderung (Sicherheit 90 %).
- Der Layout-Weg kann weiter falsch binden: Bei 002891.SZ nahm eine alte v3-Struktur das Gewinnwachstum `-58.69%` statt `10.49%`; der Tabellenweg liest richtig. Gefüllt wird so ein Fall nie, weil der Eastmoney-Abgleich mixed-basis ergibt. Den Tabellenweg vorzuziehen würde vier gespeicherte, nachweislich falsche Ergebnisse ändern und ist ein eigener Schritt.
- Die 125 alten Lücken des Durchgangs f5c4f2fb bleiben Lücken, weil nur neue Ticker abgerufen werden sollten; ein append-only Nachlesen mit v5 würde etwa 119 davon erkennen.
- `scripts/exchange-check-report.js` und andere Messskripte bauen ihren Kontext über `loadStores` und sehen den neuen Weg nicht; das betrifft nur Berichte, nicht die Boards.
- Die zweite Extraktion braucht denselben lokalen `pdftotext`; scheitert sie, wird `tableTextError` gespeichert und nur der Layout-Weg benutzt.

## 2f. Nachbesserung nach Prüfung (22.11.)

Die blinde Prüfung fand keinen Zahlenfehler; nachgebessert wurden Text, Berichtskontexte und Herkunftsangabe.

- Begründungstext je Methode: 842 der 844 Füllungen stützen sich auf die gedruckte Veränderungsrate, nicht auf ein gedrucktes Vorjahresquartal. Der Satz lautet jetzt etwa „Der Wert passt zu der Veränderung gegenüber dem Vorjahresquartal (-44,44 %), die die Firma im CNINFO-Bericht zum 3. Quartal 2026 (veröffentlicht 31.10.2026) selbst angibt.“ (Rate mit Vorzeichen, Komma und der gedruckten Stellenzahl, dafür neu `printedCheck.growth`). Die 2 Füllungen mit gedrucktem Vorjahreswert behalten „… entspricht dem im CNINFO-Bericht … gedruckten Vorjahresquartal.“
- `scripts/exchange-check-report.js` (Schatten- und Fill-only-Bericht) und `scripts/g31-replay.js` laden bei eingeschaltetem Schalter den Printed-Store über `loadPrinted`; der Punkt aus 2e ist damit erledigt. Fehlt der Store in einem Kontext, warnt `printedCheck` einmal je Prozess, statt still nicht zu füllen.
- `about` im Printed-Store (über `serialiseStore`, nur Zeile 4 geändert, keine Beobachtung angefasst) und in der Vorlage des Abrufskripts sagt jetzt, dass der Store nur Beleg für die printed-check-Füllung ist. `shadow: true` bleibt als Formkennzeichen, weil Abrufskript, Schattenbericht und Prüfweg es lesen; ein eigenes Feld hätte keine Wirkung auf Zahlen.
- Herkunft (`lib/export-provenance.js`): printed-check-Füllungen tragen den CNINFO-Link als Dokument statt „source link missing“; Anbieter bleibt Eastmoney.
- Neue Tests: Satz je Methode (auch negatives Vorzeichen und Tausenderpunkt), `asOf` vor `fetchedAt` bei der Datumsprüfung, Warnung bei fehlendem Store (einmal, nicht bei Schalter aus), CNINFO-Link in der Herkunft.
- Gleicher Datenstand vorher und nachher (2.490 A-Aktien-Snapshots, Schalter an, Bibliothek von `edba4aa724` gegen die nachgebesserte): wieder 844 Füllungen (842 Veränderungsrate, 2 gedruckter angepasster Vorjahreswert); nach Herausnehmen von Begründungstext und `printedCheck.growth` sind alle Snapshots und Ergebnisse byte-gleich.

Arbeitsdateien außerhalb des Repos: PDF- und Textcache unter `C:\Users\Anwender\AppData\Local\Temp\k2-cn-printed-cache-20261122` (`pdf-cache`, `replay-pdf-cache`, neu `table-cache`).

---

# Anhang: vorheriger Lauf am 22.11. (v3, am Tor gestoppt)

> Der Füllweg wurde damals nicht gebaut, weil der Durchgang mit v3 nur 175 von 300 Berichten (58,33 %) erkannte. Der Store wuchs append-only von 600 auf 900 Ticker (523 auf 698 parsed); von den 998 Zielzeilen waren 460 erfasst und 330 parsed, 538 noch nicht abgerufen.

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
