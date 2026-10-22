> **Auf einen Blick**
>
> SEC-Jahreswerte kommen nur noch aus ganzen Geschäftsjahren; auf denselben Eingangsdaten ändern sich genau die 71 historischen Zellen, die DL26 erwartet hat, und kein einziger Wachstumswert auf den Boards.
> - Kodak 2017 bekommt seinen Jahresumsatz von 1.531 Mio. USD zurück (bisher verdrängt durch ein Quartal von 414 Mio. USD); DBD 2023 und EXE 2021 bleiben leer, statt Vorjahreszahlen zu zeigen.
> - Board-Nachrechnung 21.10.2026: Profitabilitätsgruppe, Gewinnstufe und Umsatzwachstum unverändert, keine Zu- oder Abgänge in einer Liste. Sichtbar bewegt sich vor allem Teva in der vollständigen Liste Gesundheit, profitabel: Rang 503 → 667, Score 37,8 → 10,8.
> - Wirksam wird die Regel erst mit dem nächsten SEC-Monatslauf nach dem Merge (planmäßig 01.11.2026, 09:00 Uhr MEZ).

# SEC-Jahreswerte nur aus ganzen Geschäftsjahren (F-02): vorher und nachher

## Was sich ändert

Bisher galt jeder Wert aus einem Jahresbericht (10-K, 20-F, 40-F) mit dem Kennzeichen „Geschäftsjahr“ als Jahreswert, gleich welchen Zeitraum er abdeckt. Im Jahresbericht stehen aber auch vierte Quartale, einzelne Monate, verkürzte Übergangsjahre und seit Firmengründung aufsummierte Werte. Neu gilt: Ein Wert aus Umsatz, Betriebsergebnis, Nettoergebnis, Cashflow, Investitionen oder Bruttogewinn zählt nur, wenn er ein ganzes Jahr umfasst (330 bis 380 Tage, dieselbe Grenze wie im übrigen Projekt) und am bisher gewählten Periodenende liegt. Sonst bleibt das Feld leer. Ein älteres Vergleichsjahr rückt nie in die Lücke. Bilanzwerte (Stichtagswerte) bleiben unverändert.

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

Weitere sichtbare Felder ohne Scorewirkung: Die Gewinnserie (Anzeige, aus der Langhistorie) ändert sich bei 17 Firmen: 14 Serien werden kürzer, weil ein bisher als Jahr gezählter Teilzeitraum jetzt eine Lücke ist, 3 wechseln bei unverändert 0 Jahren die Grundlage vom Betriebs- zum Nettoergebnis; zum Beispiel Johnson & Johnson 16 → 14 Jahre (2011 stand ein Quartalsgewinn von 218 Mio. USD als Jahresgewinn) und Diebold Nixdorf 3 → 2 Jahre. Beim Schattenfeld des freien Cashflows von TH entfällt der Behördenwert 21,3 % (die Investitionen 2025 umfassten nur einen Monat).

## Zusammenstoß mit dem SEC-Monatslauf am 01.11.2026

Der Monatslauf startet am Sonntag, 01.11.2026, um 08:00 UTC (09:00 Uhr MEZ). Er holt frische SEC-Daten und baut daraus den Hauptspeicher (nur für die aktuellen Kandidaten), den Small-Cap-Speicher und die Langhistorie neu, mit der Regel, die zu diesem Zeitpunkt auf main liegt.

- **Dateikonflikt:** keiner. Der Lauf schreibt nur Datendateien; dieser Zweig ändert Code, Tests und dieses Dokument, keine Speicherdatei.
- **Läuft der Monatslauf vor dem Merge:** Die Speicher werden noch mit der alten Regel gebaut, auf den Boards ändert sich gegenüber heute nichts. Nach dem Merge greift die Regel erst beim nächsten Monatslauf am 01.12.2026 oder bei einem Handstart des Monatslaufs auf main.
- **Wird vorher gemergt:** Der Lauf am 01.11. baut die Speicher nach der neuen Regel; sichtbar wird das mit dem Tageslauf am Dienstag, 03.11.2026. Alle 23 nachgestellten Hauptspeicher-Firmen waren am 21.10. Kandidaten und werden damit neu gebaut, wenn sie es am 31.10. noch sind (Sicherheit 85 %). Die Zahlen können wegen der neueren SEC-Daten leicht von dieser Messung abweichen.

## Grenzen

- SEC-Stand der Speicher-Messung ist das Archiv vom 19.07.2026; der Monatslauf rechnet mit aktuellen Daten.
- Die Small-Cap-Boards sind nicht nachgestellt, weil ihr Datenbestand lokal fehlt.
- Der Vorher-Arm ist nicht gegen den veröffentlichten Export vom 21.10. geprüft: Er enthält den Code- und Datenstand vom 22.10. (unter anderem die Handtabelle P276). Für den Vergleich zählt nur, dass beide Arme bis auf die Speicher gleich sind.
- QMMM bleibt ein bekannter offener Fall: Der freie Cashflow 2024 verrechnet den Cashflow bis 30.09.2024 mit den Investitionen bis 30.09.2023. Die neue Regel prüft jede Kennzahl nur an ihrem eigenen Periodenende (im Test als offener Punkt vermerkt).
- Die Gewinnserie nennt eine Lücke als „letzten Verlust“ (zum Beispiel Johnson & Johnson 2011); das ist bestehendes Verhalten der Anzeige und nicht Teil dieser Änderung.

Messwerkzeuge und Rohausgaben liegen außerhalb des Repos unter `C:/Users/Anwender/.codex/t/daylauf5/sd-sec-annual-work/` (`measure.js`, `measure.json`, `arm.sh`, `compare-arms.js`, `cmp-8fe-before-after.json`).
