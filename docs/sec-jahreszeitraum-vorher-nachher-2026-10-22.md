> **Auf einen Blick**
>
> SEC-Jahreswerte kommen nur noch aus ganzen Geschäftsjahren und eine Lücke in der Gewinnserie gilt nicht mehr als Verlustjahr; auf dem Datenstand vom 31.10.2026 ändern sich 588 von 9.269 Board-Zeilen (47 Scores, 562 Ränge) und kein einziger Wachstumswert.
> - Kodak 2017 bekommt seinen Jahresumsatz von 1.531 Mio. USD zurück (bisher verdrängt durch ein Quartal von 414 Mio. USD); DBD 2023 und EXE 2021 bleiben leer, statt Vorjahreszahlen zu zeigen.
> - Am stärksten bewegt sich VISN (Score 56,1 auf 22,6, Rang 201 auf 530), danach Teva (Score 38,1 auf 10,9, Rang 496 auf 654). Der falsche Satz „Davor steht ein Verlustjahr“ verschwindet bei allen 110 Board-Tickern, die ihn heute tragen.
> - Die Korrektur der Gewinnserie wirkt mit dem ersten Tageslauf nach dem Merge, die Jahresregel erst mit dem nächsten SEC-Monatslauf nach dem Merge oder einem Handstart (Nachtrag 01.11.2026).

# SEC-Jahreswerte nur aus ganzen Geschäftsjahren (F-02): vorher und nachher

## Was sich ändert

Bisher galt jeder Wert aus einem Jahresbericht (10-K, 20-F, 40-F) mit dem Kennzeichen „Geschäftsjahr“ als Jahreswert, gleich welchen Zeitraum er abdeckt. Im Jahresbericht stehen aber auch vierte Quartale, einzelne Monate, verkürzte Übergangsjahre und seit Firmengründung aufsummierte Werte. Neu gilt: Ein Wert aus Umsatz, Betriebsergebnis, Nettoergebnis, Cashflow, Investitionen oder Bruttogewinn zählt nur, wenn er ein ganzes Jahr umfasst (330 bis 380 Tage, dieselbe Grenze wie im übrigen Projekt) und am bisher gewählten Periodenende liegt oder höchstens 7 Tage davor. Sonst bleibt das Feld leer. Ein älteres Vergleichsjahr rückt nie in die Lücke. Bilanzwerte (Stichtagswerte) behalten ihre Auswahl; sie entfallen nur unter einem Schlüssel, der kein Geschäftsjahr benennt (PRTH unter 43465 und 43830, STX unter 2027).

## Messung

Beide Seiten rechnen auf identischen Eingangsdaten; der einzige Unterschied ist die Auswahlregel.

1. **Zellen (Nachstellung DL26):** die 129 örtlich gespeicherten SEC-Firmendateien, dieselben wie in DL26 (Stand 10.07.2026), alte gegen neue Regel.
2. **SEC-Speicher:** jeder Eintrag der drei gespeicherten SEC-Datenschichten (Hauptspeicher, Small-Cap-Speicher, Langhistorie), neu ausgelesen aus dem SEC-Gesamtarchiv vom 19.07.2026, alte gegen neue Regel. Eine Zelle wird im Nachher-Speicher nur ersetzt, wenn der gespeicherte Wert nachweislich aus derselben SEC-Angabe stammt (gleicher Wert an derselben Stelle der Jahresachse).
3. **Boards:** Tageslauf vom 21.10.2026 nachgerechnet (Snapshot-Artefakt des Laufs 39563364953, 16.123 Dateien, Uhr fest auf 21.10.2026 08:58 UTC), Code und übrige Daten in beiden Armen origin/main `8fe1bee`. Die Arme unterscheiden sich nur in den drei SEC-Speichern.

## Ergebnis 1: Zellen auf den 129 Firmen

| Messung | vorher → nachher |
|---|---:|
| Veränderte historische Zellen | 71 bei 16 Firmen |
| davon Umsatz / Betriebsergebnis / Nettoergebnis / operativer Cashflow / freier Cashflow / Bruttogewinn | 17 / 9 / 7 / 6 / 8 / 24 |
| Umsatz zurückgeholt (falscher Konflikt Quartal gegen Jahr) / Umsatz zurückgehalten | 13 bei 6 Firmen / 4 |
| Abweichung von DL26 (Zelle für Zelle) | 0 |
| Geänderte Jahresachsen / gewählte Bilanzierungsstandards | 0 / 0 |
| Geändertes Wachstum aus den beiden neuesten SEC-Umsatzjahren | 0 |

Beispiele (in `tests/sec-annual-period.test.js` festgehalten):

| Firma | Jahr | vorher | nachher |
|---|---|---:|---:|
| Kodak (KODK) | 2017 / 2016 Umsatz | leer / leer | 1.531 / 1.543 Mio. USD |
| STAAR Surgical (STAA) | 2012 bis 2017 Umsatz | leer | 63,8 bis 90,6 Mio. USD |
| Lumentum (LITE) | 2019 Umsatz | leer | 1.565,3 Mio. USD |
| Diebold Nixdorf (DBD) | 2023 Umsatz, Betriebsergebnis, Nettoergebnis, Cashflow, Bruttogewinn | 140-Tage-Zeitraum (Umsatz 1.628,6 Mio. USD) | leer, Aktienzahl unverändert 37.566.668 |
| Expand Energy (EXE) | 2021 Umsatz, Betriebsergebnis, Nettoergebnis, Cashflow | 324-Tage-Zeitraum (Umsatz 5.549 Mio. USD) | leer, Aktienzahl unverändert 117.105.845 |

Ein bloßer Tagesfilter hätte bei DBD 2023 den Umsatz von 2022 (3.460,7 Mio. USD) und bei EXE 2021 das Betriebsergebnis von 2020 (−8.703 Mio. USD) eingesetzt; ein Prüffall wird mit dieser Variante rot (einmal absichtlich gebrochen und geprüft).

## Ergebnis 2: die drei SEC-Speicher (SEC-Stand 19.07.2026)

| Speicher | Einträge | davon im SEC-Archiv | von der Regel betroffen | nachgestellte Zellen |
|---|---:|---:|---:|---:|
| Hauptspeicher (`sec-secannual.json`, fließt in den Score) | 241 | 225 | 29 | 73 bei 23 Firmen |
| Small-Cap-Speicher | 343 | 342 | 62 | 1 (Small-Cap-Boards nicht nachstellbar) |
| Langhistorie (`sec-annual-bulk.jsonl`, nur Anzeige Gewinnserie und Bericht) | 2.297 | 2.111 | 346 | 1.605 |

Im Hauptspeicher tragen 2 der 29 betroffenen Einträge den richtigen Wert schon (AORT, PTGX), 4 haben am 21.10. keinen Snapshot im Hauptbestand und wirken nicht auf die Boards (CODI, GRPN, HNRG, METC). Über alle 2.606 Firmen der drei Speicher wechselt kein Bilanzierungsstandard; bei 2 Firmen schrumpft die Jahresachse, weil dort nur Quartale als Jahreswerte standen (Regency Centers 2011 bis 2018, NESR 2018).

## Ergebnis 3: Boards am 21.10.2026

| Messung | Ergebnis |
|---|---:|
| Listen / Zeilen verglichen | 64 / 66.450 |
| Zeilen mit Rang- oder Scoreänderung | 807 in 14 Listen (421 ohne den Spiegel im Filter-Universum), 395 Kürzel |
| Zeilen mit Scoreänderung | 237 bei 111 Kürzeln |
| Zu- oder Abgänge in einer Liste | 0 |
| Profitabilitätsgruppe (profitabel/unprofitabel) geändert | 0 |
| Gewinnstufe (profitTier) geändert | 0 |
| Umsatzwachstum geändert | 0 |
| Kurzlisten (Board-Dateien ohne vollständige Liste) | 35 Zeilen in 7 Listen, Score höchstens ±0,1, Rang höchstens ±2, gleiche Mitglieder |
| Übrige Firmen (Nachbarwirkung der Kohorten-Perzentile) | Score höchstens ±0,1, Rang höchstens ±3 |

Direkt betroffene Firmen mit Rang- oder Scoreänderung (vollständige Listen):

| Firma | Liste | Rang vorher → nachher | Score vorher → nachher | Grund |
|---|---|---:|---:|---|
| Teva (TEVA) | Gesundheit, profitabel | 503 → 667 | 37,8 → 10,8 | Umsatz 2025 (17.258 Mio. USD) war wegen eines Quartalswerts von 1.500 Mio. USD verworfen; mit dem neuesten Jahr greift die lange SEC-Reihe im Zyklus-Dämpfer (Faktor 1 → 0,286); die Lampe zur bereinigten Yahoo-Betriebszahl (`opIncYahooAdjusted`) entfällt |
| Repligen (RGEN) | Gesundheit, profitabel | 569 → 428 | 32,8 → 43,7 | Werte 2011 (kein ganzes Jahr) entfallen; Zyklus-Dämpfer 0,5 → 0,667 |
| GPGI | Industrie, unprofitabel | 172 → 171 | 5,7 → 8,7 | Werte 2020 (kein ganzes Jahr) entfallen; Zyklus-Dämpfer 0,667 → 1 |
| LyondellBasell (LYB) | Grundstoffe, profitabel | 508 → 499 | 49,0 → 49,5 | Umsatz und Betriebsergebnis 2012 (kein ganzes Jahr) entfallen; Kapitaleffizienz 80,0 → 81,6 |
| Crescent Energy (CRK) | Energie, profitabel | 309 → 309 | 28,0 → 28,2 | Werte 2018 (kein ganzes Jahr) entfallen |
| Sarepta (SRPT) | Gesundheit, unprofitabel | 246 → 246 | 20,4 → 20,7 | 2011 bis 2013 Jahreswerte statt seit 1980 aufsummierter Werte (Betriebsergebnis 2013 −451,0 → −90,3 Mio. USD) |
| Expand Energy (EXE) | Energie, profitabel | 337 → 337 | 11,4 → 11,3 | Werte 2021 aus dem 324-Tage-Zeitraum entfallen |

Weitere sichtbare Felder ohne Scorewirkung: Die Gewinnserie (Anzeige, aus der Langhistorie) ändert sich bei 17 Firmen: 14 Serien werden kürzer, weil ein bisher als Jahr gezählter Teilzeitraum jetzt eine Lücke ist, 3 wechseln bei unverändert 0 Jahren die Grundlage vom Betriebs- zum Nettoergebnis; zum Beispiel Johnson & Johnson 16 → 14 Jahre (2011 stand ein Quartalsgewinn von 218 Mio. USD als Jahresgewinn) und Diebold Nixdorf 3 → 2 Jahre. Seit dem Nachtrag vom 01.11.2026 stehen dort „mind. 14 Jahre“ und „mind. 2 Jahre“, weil die Lücke kein Verlustjahr ist. Beim Schattenfeld des freien Cashflows von TH entfällt der Behördenwert 21,3 % (die Investitionen 2025 umfassten nur einen Monat).

## Zusammenstoß mit dem SEC-Monatslauf am 01.11.2026

Stand 01.11.2026, 13:24 Uhr MEZ: Der geplante Lauf ist noch nicht gestartet, GitHub führt für diesen Workflow in diesem Repository noch keinen einzigen Lauf. Was ein Handstart nach dem Merge ändert, steht im Nachtrag vom 01.11.2026.

Der Monatslauf startet am Sonntag, 01.11.2026, um 08:00 UTC (09:00 Uhr MEZ). Er holt frische SEC-Daten und baut daraus den Hauptspeicher (nur für die aktuellen Kandidaten), den Small-Cap-Speicher und die Langhistorie neu, mit der Regel, die zu diesem Zeitpunkt auf main liegt.

- **Dateikonflikt:** keiner. Der Lauf schreibt nur Datendateien; dieser Zweig ändert Code, Tests und dieses Dokument, keine Speicherdatei.
- **Läuft der Monatslauf vor dem Merge:** Die Speicher werden noch mit der alten Regel gebaut, auf den Boards ändert sich gegenüber heute nichts. Nach dem Merge greift die Regel erst beim nächsten Monatslauf am 01.12.2026 oder bei einem Handstart des Monatslaufs auf main.
- **Wird vorher gemergt:** Der Lauf am 01.11. baut die Speicher nach der neuen Regel; sichtbar wird das mit dem Tageslauf am Dienstag, 03.11.2026. Alle 23 nachgestellten Hauptspeicher-Firmen waren am 21.10. Kandidaten und werden damit neu gebaut, wenn sie es am 31.10. noch sind (Sicherheit 85 %). Die Zahlen können wegen der neueren SEC-Daten leicht von dieser Messung abweichen.

## Grenzen

- SEC-Stand der Speicher-Messung ist das Archiv vom 19.07.2026; der Monatslauf rechnet mit aktuellen Daten.
- Die Small-Cap-Boards sind nicht nachgestellt, weil ihr Datenbestand lokal fehlt.
- Der Vorher-Arm ist nicht gegen den veröffentlichten Export vom 21.10. geprüft: Er enthält den Code- und Datenstand vom 22.10. (unter anderem die Handtabelle P276). Für den Vergleich zählt nur, dass beide Arme bis auf die Speicher gleich sind.
- QMMM bleibt ein bekannter offener Fall: Der freie Cashflow 2024 verrechnet den Cashflow bis 30.09.2024 mit den Investitionen bis 30.09.2023. Die neue Regel prüft jede Kennzahl nur an ihrem eigenen Periodenende (im Test als offener Punkt vermerkt).
- Bis zum geprüften Stand vom 31.10.2026 nannte die Gewinnserie eine Lücke als „letzten Verlust“ (zum Beispiel Johnson & Johnson 2011). Das ist seit dem Nachtrag vom 01.11.2026 behoben.

Messwerkzeuge und Rohausgaben liegen außerhalb des Repos unter `C:/Users/Anwender/.codex/t/daylauf5/sd-sec-annual-work/` (`measure.js`, `measure.json`, `arm.sh`, `compare-arms.js`, `cmp-8fe-before-after.json`).

## Nachtrag 31.10.2026: Korrektur nach der Codex-Prüfung und Messung eines Monatslaufs

Korrigiert wurden drei Punkte. Die Umsatzkonzepte teilen sich je Geschäftsjahr ein Periodenende, ein Ersatzwert muss also auf demselben Ende liegen. Die Plausibilitätsprüfung vergleicht nur noch Werte desselben Jahres; eine bereinigte Lücke im neuesten Jahr wird durchgelassen und blockiert die Erneuerung nicht mehr. Ein Geschäftsjahres-Schlüssel, der mehr als ein Jahr hinter dem Periodenende liegt, zählt nicht als Jahr (bei PRTH stehen dort die Excel-Zahlen 43465 und 43830). Kodak 2017 (1.531 Mio. USD) und Lumentum 2019 (1.565,3 Mio. USD) bleiben unverändert.

Gemessen wurde der Datenstand des Tageslaufs vom 31.10.2026 mit den SEC-Rohdaten vom 29.10.2026. Die Nachrechnung ohne Änderung trifft den veröffentlichten Stand in allen 9.269 Board-Zeilen, 1.300 Qualitätszeilen, 474 Rule-of-40-Zeilen und 446 Small-Cap-Zeilen. Der reine Codetausch ändert nichts, weil die Tagesrechnung die gespeicherten SEC-Reihen liest.

| Vergleich auf demselben Datentag | Geänderte Board-Zeilen von 9.269 | Scores | Ränge | Small-Cap-Zeilen von 446 |
|---|---:|---:|---:|---:|
| Monatslauf alte Regel gegen veröffentlichten Stand | 232 | 83 | 182 | 0 |
| Monatslauf neue Regel gegen Monatslauf alte Regel | 588 | 47 | 562 | 149 |

Von den 47 Scores ändern sich vier um mindestens einen Punkt: VISN 56,1 auf 22,6, TEVA 38,1 auf 10,9, RGEN 32,8 auf 43,7, GPGI 5,5 auf 8,4. Von den 562 Rängen bewegen sich 550 um einen Platz, fünf um mindestens fünf Plätze. Umsatzwachstum, Wachstumsbasis, Perioden und Übersichtswerte bleiben in allen Zeilen gleich.

Offen für die Prüfung: VISN fällt, weil die wie eingereicht gemeldete Reihe den Verkauf von Geschäftsteilen als Umsatzrückgang zeigt und damit den Zyklus-Dämpfer auf 0,4 setzt. Das ist eine Methodenfrage und hier nicht entschieden. (Berichtigt 01.11.: Die Erklärung greift zu kurz, siehe Nachtrag 01.11.2026.) Außerdem erneuert ein Monatslauf nur ausgewählte Firmen; 212 von 253 und 292 von 351 Einträgen bleiben gleich wie vorher. (Berichtigt 01.11.: Die Angabe „34 Firmen mit 92 Zellen“ stimmt nicht. Bei den nicht erneuerten Einträgen wären nach der neuen Regel 19 Speichereinträge bei 18 Tickern mit 59 Zellen leer, gezählt ohne Bruttogewinn und Bilanz.)

## Nachtrag 01.11.2026: Korrektur nach der Blindprüfung vom 31.10.2026

Dieselben Eingaben wie am 31.10.2026: Snapshots des Tageslaufs 41184535364, Small-Cap-Bestand des Laufs 41054766868, Übergabe des Tageslaufs, SEC-Archiv mit Einträgen bis 29.10.2026, Datenstand `b0fdec8f8f`. Neu ist, dass auch die Langhistorie je Regel neu gebaut wurde; sie liefert die Gewinnserie. Die späteren Commits auf main (Tag 1511 bis 1513) sind nicht Teil dieser Nachrechnung.

### Was geändert ist

1. **Eine Lücke ist kein Verlustjahr.** Endet die Serie ab dem zweiten Jahr an einer Lücke, steht dort „mind. N Jahre“ und der Hinweis, dass die Serie bis zum Anfang der verfügbaren Daten reicht. Fehlt das neueste Jahr, gibt es keine Serie. Ein echtes Verlustjahr bleibt, wie es war. findash muss dafür nicht geändert werden, die Export-Prüfung und die Rule-of-40-Prüfung sind auf dem neuen Stand grün.
2. **Fast dasselbe Periodenende.** Ein ganzes Jahr, das höchstens 7 Tage vor dem Periodenende endet, zählt als dasselbe Ende. Das betrifft Penguin 2020 (28.08. gegen 31.08.) und Kohl's 2019 (01.02. gegen 02.02.2020). Die übrigen zehn Treffer liegen 18 Tage oder mehr entfernt und bleiben leer.
3. **Prüfung ohne Vergleich wird sichtbar.** Beide Builder schreiben eine Zeile `sanityNothingCompared`. Heute trifft das 8 von 448 angenommenen Namen: ASTL, CSHR, FDUS, GLAD, ILPT, SLRC, VEL, XRN.

### Gewinnserie, Ebene Ticker

| Messung | Alte Regel | Geprüfter Stand `b588f529cd` | Dieser Stand |
|---|---:|---:|---:|
| Lücke wird als Verlustjahr gemeldet, Langhistorie (2.297 Zeilen) | 114 | 138 | 0 |
| davon auf den Boards (9.269 Ticker) | 110 | 132 | 0 |
| Verlustjahre mit echtem negativem Wert | 1.168 von 1.282 | 1.155 von 1.293 | 1.155 von 1.155 |
| Serie endet offen an einer Lücke, Langhistorie / Boards | 0 / 0 | 0 / 0 | 107 / 104 |
| keine Serie, weil das neueste Jahr fehlt, Langhistorie / Boards | 0 / 0 | 0 / 0 | 30 / 27 |

Die Zahl echter Verlustsätze auf den Boards bleibt zwischen geprüftem Stand und diesem Stand gleich (1.070 Ticker).

| Firma | Geprüfter Stand | Dieser Stand |
|---|---|---|
| Stifel (SF) | 14 Jahre, Verlustjahr 2011 | mind. 14 Jahre |
| CrossAmerica (CAPL) | 12 Jahre, Verlustjahr 2012 | mind. 12 Jahre |
| Empire State Realty (ESRT) | 12 Jahre, Verlustjahr 2013 | mind. 12 Jahre |
| Empire State Realty OP (ESBA) | 12 Jahre, Verlustjahr 2013 | mind. 12 Jahre |
| Element Solutions (ESI) | 10 Jahre, Verlustjahr 2015 | mind. 10 Jahre |
| Paycom (PAYC) | 11 Jahre, Verlustjahr 2014 | mind. 11 Jahre |
| Penguin Solutions (PENG) | 6 Jahre, Verlustjahr 2020 | mind. 10 Jahre (Jahreswerte 2020 zurück) |
| Surgery Partners (SGRY) | 8 Jahre, Verlustjahr 2017 | mind. 8 Jahre |
| Brookfield Asset Management (BAM) | 3 Jahre, Verlustjahr 2022 | mind. 3 Jahre |

### Board-Zeilen

| Vergleich auf demselben Datentag | Board-Zeilen von 9.269 | Scores | Ränge | Gewinnserie | Qualität von 1.300 | Rule40 von 474 | Small-Cap von 446 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Nachrechnung ohne Änderung gegen veröffentlichten Stand | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Nur Codetausch, kein Neubau | 0 | 0 | 0 | 110 | 0 | 0 | 0 |
| Monatslauf alte Regel gegen veröffentlichten Stand | 232 | 83 | 182 | 19 | 28 | 20 | 0 |
| Geprüfter Stand gegen alte Regel | 588 | 47 | 562 | 20 | 6 | 2 | 149 |
| Nur neue Serienlogik gegen geprüften Stand | 0 | 0 | 0 | 132 | 0 | 0 | 0 |
| 7-Tage-Regel zusätzlich | 0 | 0 | 0 | 1 | 0 | 0 | 0 |
| **Dieser Stand gegen alte Regel** | **588** | **47** | **562** | **133** | 6 | 2 | 149 |
| Dieser Stand gegen veröffentlichten Stand | 820 | 130 | 744 | 152 | 34 | 22 | 149 |

Board-Zeilen, Qualität, Rule40 und Small-Cap zählen Zeilen mit geänderter Rangzahl oder geändertem Score; die Spalte Gewinnserie zählt Board-Zeilen, deren Serie sich ändert. Bei Small-Cap sind es 143 geänderte Zeilen plus je 3 Zu- und Abgänge. Bei der Nachrechnung ohne Änderung weicht außerdem das Feld `valueFlags` in 13 Zeilen vom veröffentlichten Stand ab; es ist in allen Vergleichsarmen gleich und ändert keinen Score und keinen Rang.

Die neue Serienlogik verschiebt keinen Score: `score.js` hängt die Gewinnserie nur an die Zeile an, `write-rule40-export.js` reicht sie durch, `qc-rho-k2.js` erwähnt sie nur in einem Kommentar. Gemessen ändert sich zwischen geprüftem Stand und der neuen Serienlogik neben der Serie selbst kein anderes Zeilenfeld.

**Was die 7-Tage-Regel bewegt:** über 2.555 Filer genau fünf Zellen der Langhistorie, nämlich Penguin 2020 (Umsatz 1.122,4 Mio. USD, Betriebsergebnis 41,3 Mio. USD, Nettoergebnis minus 1,1 Mio. USD) und Kohl's 2019 (Umsatz 19.974 Mio. USD, Nettoergebnis 691 Mio. USD). Beide Score-Speicher bleiben bytegleich. Sichtbar wird das nur an Penguin; Kohl's zeigt weiter 5 Jahre mit dem echten Verlustjahr 2020.

### Was ein Handstart des Monatslaufs nach dem Merge ändert

Ohne Handstart wirkt nach dem Merge nur die Serienlogik: Der nächste Tageslauf ändert bei 110 Board-Tickern den Text, 87 zeigen dann „mind. N Jahre“ und 23 keine Serie, kein Score und kein Rang bewegt sich. Die Jahresregel wirkt erst, wenn die Speicher neu gebaut werden.

Ein Handstart auf main baut die drei Speicher mit der neuen Regel neu. Auf den eingefrorenen Daten vom 31.10.2026 heißt das:

| Fall | Board-Zeilen von 9.269 | Scores | Ränge | Gewinnserie | Qualität | Rule40 | Small-Cap |
|---|---:|---:|---:|---:|---:|---:|---:|
| Es lief vorher kein Monatslauf nach alter Regel | 820 | 130 | 744 | 152 | 34 | 22 | 149 |
| Es lief vorher ein Monatslauf nach alter Regel | 588 | 47 | 562 | 133 | 6 | 2 | 149 |

- **Langhistorie:** Im ersten Fall ändern sich von 2.297 Zeilen 390 mit 1.830 Zellen (384 gefüllt, 1.280 geleert, 166 mit anderem Wert), im zweiten Fall 372 Zeilen mit 1.662 Zellen. Gezählt sind Umsatz, Betriebsergebnis, Nettoergebnis, Cashflow, freier Cashflow, Bruttogewinn, Bilanz und Aktienzahl. Der echte Lauf baut die Zeilen für die dann aktuellen US-Namen.
- **Grenze der Zahlen:** Sie gelten für das SEC-Archiv bis 29.10.2026. Ein Handstart liest neuere Einreichungen und kann davon abweichen.
- **Veröffentlicht wird:** Der Lauf committet auf main `external-data/sec-xbrl/_manifest.json`, `external-data/sec-secannual.json`, `external-data/sec-secannual-smallcap.json` und `external-data/sec-annual-bulk.jsonl`. Außerhalb von `external-data/` kommen genau zwei Berichtsdateien dazu: `reports/roic-reliability-JJJJ-MM.txt` und `reports/fingerprint-zensus-JJJJ-MM.txt`. Eine Board-Datei schreibt er nicht. Die Boards ändern sich erst mit dem nächsten Tageslauf. Der Push auf main löst wie jeder Push den Neubau von GitHub Pages aus, Quelle ist main. Von einem anderen Zweig aus veröffentlicht der Lauf nichts.

### Offen für Codex, hier bewusst nicht gebaut

- **Vergleichsjahre unter dem nächsten Schlüssel (alte Regel):** 29 Zellen bei 23 Tickern unter den angenommenen Namen, Bruttogewinn nicht mitgezählt, sechs davon im neuesten Jahr. Beim Umsatz 2025 von ATVK, MAZE und IMSR steht der Wert von 2024, bei MAZE 167,5 Mio. USD mit Periodenende 31.12.2024; bei MTC, PHOE und XMAX steckt die Investition des Vorjahres im freien Cashflow. Ein Anker über den ganzen Abschluss träfe in der Langhistorie alle 47 solcher Zellen, aber auch 39 weitere (auf diesem Stand 40), meist richtige, etwa APD 2018 und FUL 2022.
- **Späteres Jahr unter älterem Schlüssel (alte Regel):** Bei Federal Realty und Wolverine trägt der 10-K für 2025 den Schlüssel 2024; unter 2024 steht der Wert von 2025 (1.279,0 und 1.874,3 Mio. USD). In der Langhistorie sind es 218 Zellen bei Umsatz, Betriebs- und Nettoergebnis. Der Test zu WWW begründet das mit 52/53-Wochen-Jahren, Federal Realty hat aber ein Kalenderjahr.
- **Füllbare Zellen:** 184 der 1.220 geleerten Zellen (auf diesem Stand 184 von 1.215) ließen sich aus derselben SEC-Datei füllen, weil dort unter dem nächsten Schlüssel eine ganze Jahreszeile mit demselben Periodenende steht (J&J 2011, Stifel 2011, Paycom 2014). Damit kämen laut Blindprüfung 9 der 22 geänderten Gewinnserien auf ihren alten Stand. `annualFiled` müsste dann das spätere Einreichungsdatum tragen.
- **MBUU:** Score 50,5 auf 25,2, Rang 7 auf 16, ohne jede Datenänderung bei MBUU. Die Small-Cap-Stichprobe steigt von 252 auf 253, die gelernte Schwelle sinkt von 0,41937 auf 0,41834, und das ist genau der Rückgang von MBUU. Das kann jeder Monatslauf bei jedem Namen auslösen.
- **VISN, Formelfrage:** Score 56,1 auf 22,6. Die gelernte Schwelle liegt bei 14,7 %, auch die vergleichbare Reihe aus dem 10-K 2025 fällt von 1.863,8 auf 1.382,6 Mio. USD (25,8 %). Der Faktor 0,4 entsteht also in beiden Fällen und kommt aus den Vorzeichenwechseln im Betriebsergebnis (Zählwert 3). Die Erklärung über den Verkauf von Geschäftsteilen allein trägt nicht. Ob die Formel so bleibt, gehört auf den Formel-Weg.
- **Monatslauf erneuert nur ausgewählte Firmen:** Im Hauptspeicher bleiben 57 Einträge nicht erneuert; bei nicht erneuerten Einträgen wären 19 Speichereinträge bei 18 Tickern mit 59 Zellen nach der neuen Regel leer.
- **Neu gemessen, nicht Teil des Auftrags:** Bei 102 Tickern der Langhistorie läuft die gezählte Serie über ein Geschäftsjahr, das auf der Jahresachse ganz fehlt. Das ist keine Lücke im Sinn dieser Korrektur und erzeugt keinen Verlustsatz, „ununterbrochen“ ist dort aber nicht belegt. Außerdem liest findash bei den 27 Board-Tickern ohne Serie „liegt keine solche Historie vor“, obwohl nur das neueste Jahr fehlt.

Messwerkzeuge und Rohausgaben dieses Nachtrags: `C:/Users/Anwender/.codex/t/daylauf10/sd-f02-work/bau01/`.
