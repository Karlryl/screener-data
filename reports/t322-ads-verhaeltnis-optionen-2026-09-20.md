# T322 — ADS-Verhältnis: Offline-Messung vom 20.09.2026

**Messung, keine Empfehlung und kein Fix.** Die Zahlen unten gelten für die expliziten Operationalisierungen A/B und die wertelosen Abdeckungsszenarien C. Sie beweisen keine tatsächlichen ADS-Verhältnisse. Konfidenz der Übertragbarkeit auf eine spätere Implementierung: offen; mechanische Zählungen sind reproduzierbar.

## Population und Abweichung vom Brief

**225 = Obergrenze der Population, 7 = Brett-Zeilen, 2 = belegt falsche Brett-Zeilen** ist der vorgegebene Vorbefund; 225 ist keinesfalls die Anzahl betroffener Brett-Zeilen.
Im zugelassenen Ordner werden tatsächlich 17392 Snapshot-Dateien gelesen, 31 delistete und 146 ohne positive Stückzahl/Größe ausgeschlossen: 17215 verwendbare Snapshots.
Mit der unten festgelegten Auswahl entstehen 5102 ganzzahlige US/Nicht-US-Paare, 264 Paare mit Abstand >1,5, 220 Emittenten und 222 US-Ticker-Kandidaten. Ein Paar ist kein Emittent; mehrere US-Aktiengattungen bleiben getrennte CSV-Zeilen.
Die behauptete Auswahl von exakt 225 Kandidaten ist damit **nicht reproduziert**. Keine Zeilen wurden auf 225 aufgefüllt oder abgeschnitten. Eine verbindliche Kandidatenliste und die ursprüngliche Ganzzahligkeits-Toleranz fehlen. Die CSV enthält 222 × 5 = 1110 Zeilen.
Im jüngsten lokalen Vintage **2026-09-19** stehen 7 dieser US-Ticker: HSAI, INTC, JBS, LU, MGNI, UEC, WSC. Die sieben Kontrollnamen werden zusätzlich separat geprüft; fremde Kontrolllabels wurden nicht in die Entscheidungsfunktionen eingespeist.

## Festgelegte Messregeln und Grenzen

- Gruppierung und Abstandsfunktion werden direkt aus den zwei reinen Funktionen des bestehenden Währungswächters ausgeführt; sein Live-Teil und seine Produktionsimporte laufen nicht. Seine Einschränkung auf Gruppen mit mindestens zwei ursprünglichen Handelswährungen bleibt erhalten. Keine OTC-, A/H- oder Vorzugsfilter zusätzlich: das ist eine Kandidaten-Obermenge, kein ADR-Nachweis.
- US-Linie = Ticker ohne Punkt. meta.region wird weder gelesen noch als US-Kriterium benutzt. Namensgleichheit stammt unverändert aus dem Wächter; sie beweist keine identische Aktiengattung.
- Ganzzahligkeit: größerer/kleinerer Stückzahlwert liegt höchstens 3 % relativ neben der nächsten ganzen Zahl (eins eingeschlossen). Diese deklarierte Messannahme übernimmt die 3-%-Toleranz des Bausteins; die Toleranz des Vorbefunds ist unbekannt. Kandidat: mindestens ein solches Paar mit mcap-Abstand strikt >1,5. Alle Gegenlinien bleiben anschließend für Mehrdeutigkeitsprüfungen erhalten.
- A: bei ungleichen Stückzahlen wird das gerichtete, auf eine ganze Zahl bzw. deren Kehrwert gerundete Stückzahlverhältnis als Korrekturfaktor angenommen. Bei annähernd gleichen Stückzahlen wird das ganzzahlige Kursverhältnis in derselben ausdrücklich belegten Währung verwendet. Alle Gegenlinien müssen denselben Faktor liefern; sonst keine Anwendung. Das ist eine **bedingte Konsistenz-Heuristik**, kein Beweis, welche Stückzahldefinition der Lieferant verwendet. Insbesondere kann reine Konsistenz einen ADS-Effekt nicht von anderen Gattungen oder veralteten Kursen unterscheiden.
- B: mangels Primär-/Heimatkennzeichnung wird die **einzige** Nicht-US-Gegenlinie bedingt als Heimat-Linie eingesetzt. Mehrere Gegenlinien sind nicht entscheidbar; es wird keine willkürlich ausgewählt. Dies misst ausdrücklich die Fremdlinien-als-Heimat-Annahme, nicht eine bereits validierte Heimat-Zuordnung. Der Brief belegt, dass diese Annahme bei den fünf US-Primärlinien falsch ist; jede numerische Änderung dort zählt dennoch und gerade deshalb als Kollateralschaden. Eine echte Heimat-Auswahl benötigt weitere Stammdaten.
- C: eine Abdeckung allein liefert **keinen Verhältniswert und keine Stückzahl-Semantik**. Es werden keine Werte erfunden und weder A noch B als angebliche externe Tabelle ausgegeben. 100 % deckt alle 222 Ticker hypothetisch; 50 % die ersten 111 ASCII-sortierten Ticker (abgerundet; keine Zufallsstichprobe); nur-die-7 die sieben Kontrollnamen. Alle numerischen Wirkungen bleiben unentscheidbar, auch innerhalb der angenommenen Abdeckung. Für nominell 225 wären 50 % zwischen 112 und 113 Einträgen; eine exakte halbe Zeile existiert nicht.
- Keine neue Währungsumrechnung: price.currencyUnit / meta.priceCurrency kennzeichnen bereits normalisierte Preise (haben Vorrang vor price.currency, das z.B. HKD als Originalwährung trägt). Widersprechende Stempel sperren den Kursvergleich. Für marketCap gilt eine explizite Währung oder der vorhandene tradingFxRateApplied-Stempel als USD-Nachweis. Der Kursstempel wird nie selbst zum Umrechnen genutzt. Fehlt eine gemeinsame Einheit: **nicht entscheidbar ohne Kurs**. Es wird nie ein FX-Kurs aus mcap/Kurs/Stückzahl rückgerechnet.
- Richtung beschreibt die bedingte Diagnose gegenüber heute: Faktor <1 = heute zu groß, >1 = heute zu klein. Das ist außerhalb der Kontrollen keine verifizierte Wahrheit. Unentscheidbare Werte sind leer, keinesfalls Faktor 1 oder null Kapitalisierung. Rang ist der vorhandene kohortenspezifische Rang; es werden keine neuen Scores oder Ränge gerechnet.
- Trefferprüfung: Faktor innerhalb 3 % relativ um HSAI 1/7,87 bzw. LU 2. Jede numerische Veränderung der fünf korrekten Namen zählt ohne Bagatellschwelle als Schaden. Nichtanwendung wird separat als unentscheidbar gezählt, nicht als belegte Unversehrtheit der hypothetischen Option.

## Pflichtkennzahlen

**Kollateralschaden ist die wichtigste Kennzahl.** Die zweite Schadensspalte darf nicht mit null Schaden verwechselt werden.

| Option | Anwendbar / 222 | Ohne Kurs | C-Abdeckung angenommen | HSAI | LU | Schäden / 5 | Unentscheidbar / 5 |
|---|---:|---:|---:|---|---|---:|---:|
| A | 33 | 13 | 0 | Treffer | Treffer | 0 | 4 |
| B | 155 | 2 | 0 | Treffer | KEIN Treffer | 3 | 2 |
| C-100 | 0 | 0 | 222 | KEIN Treffer | KEIN Treffer | 0 | 5 |
| C-50 | 0 | 0 | 111 | KEIN Treffer | KEIN Treffer | 0 | 5 |
| C-nur-die-7 | 0 | 0 | 7 | KEIN Treffer | KEIN Treffer | 0 | 5 |

- A: Positiv-Kontrolle bestanden.
- B: widerlegt nach Positiv-Kontroll-Kriterium dieses Briefs.
- C-100: widerlegt nach Positiv-Kontroll-Kriterium dieses Briefs.
- C-50: widerlegt nach Positiv-Kontroll-Kriterium dieses Briefs.
- C-nur-die-7: widerlegt nach Positiv-Kontroll-Kriterium dieses Briefs.

„Widerlegt“ bedeutet hier das vom Brief geforderte Nichtbestehen beider Positiv-Kontrollen für diese messbare Ausgestaltung. Bei C fehlen Werte; damit ist keine Aussage über die Güte einer zukünftig tatsächlich befüllten Tabelle möglich. Bei A ist das Bestehen der zwei Kontrollen keine Validierung für die restliche Population.

## Die sieben Brett-Kontrollen

| Ticker | Option | Rang heute | Gegenlinie(n) | mcap heute | mcap unter Option | Faktor | Einordnung |
|---|---|---:|---|---:|---:|---:|---|
| HSAI | A | 142 | 2525.HK | 20767913984.00 | 2595989248.00 | 0.125000 | korrigiert |
| HSAI | B | 142 | 2525.HK | 20767913984.00 | 2636264876.93 | 0.126939 | korrigiert |
| HSAI | C-100 | 142 | 2525.HK | 20767913984.00 | offen | offen | nicht entscheidbar |
| HSAI | C-50 | 142 | 2525.HK | 20767913984.00 | offen | offen | nicht entscheidbar |
| HSAI | C-nur-die-7 | 142 | 2525.HK | 20767913984.00 | offen | offen | nicht entscheidbar |
| INTC | A | 35 | 1INTC.MI, 4335.HK, INL.DE, INTC.SW, INTC.VI, INTL.WA | 574070980608.00 | offen | offen | nicht entscheidbar |
| INTC | B | 35 | 1INTC.MI, 4335.HK, INL.DE, INTC.SW, INTC.VI, INTL.WA | 574070980608.00 | offen | offen | nicht entscheidbar |
| INTC | C-100 | 35 | 1INTC.MI, 4335.HK, INL.DE, INTC.SW, INTC.VI, INTL.WA | 574070980608.00 | offen | offen | nicht entscheidbar |
| INTC | C-50 | 35 | 1INTC.MI, 4335.HK, INL.DE, INTC.SW, INTC.VI, INTL.WA | 574070980608.00 | offen | offen | nicht entscheidbar |
| INTC | C-nur-die-7 | 35 | 1INTC.MI, 4335.HK, INL.DE, INTC.SW, INTC.VI, INTL.WA | 574070980608.00 | offen | offen | nicht entscheidbar |
| JBS | A | 147 | Z98.DE | 12808093696.00 | 12808093696.00 | 1.000000 | unberührt |
| JBS | B | 147 | Z98.DE | 12808093696.00 | 39801579138.63 | 3.107533 | verdirbt |
| JBS | C-100 | 147 | Z98.DE | 12808093696.00 | offen | offen | nicht entscheidbar |
| JBS | C-50 | 147 | Z98.DE | 12808093696.00 | offen | offen | nicht entscheidbar |
| JBS | C-nur-die-7 | 147 | Z98.DE | 12808093696.00 | offen | offen | nicht entscheidbar |
| LU | A | 7 | 6623.HK | 1022692864.00 | 2045385728.00 | 2.000000 | korrigiert |
| LU | B | 7 | 6623.HK | 1022692864.00 | 2408574075.50 | 2.355129 | verdirbt |
| LU | C-100 | 7 | 6623.HK | 1022692864.00 | offen | offen | nicht entscheidbar |
| LU | C-50 | 7 | 6623.HK | 1022692864.00 | offen | offen | nicht entscheidbar |
| LU | C-nur-die-7 | 7 | 6623.HK | 1022692864.00 | offen | offen | nicht entscheidbar |
| MGNI | A | 233 | 1MGNI.MI | 3607117568.00 | offen | offen | nicht entscheidbar |
| MGNI | B | 233 | 1MGNI.MI | 3607117568.00 | 2094348569.24 | 0.580616 | verdirbt |
| MGNI | C-100 | 233 | 1MGNI.MI | 3607117568.00 | offen | offen | nicht entscheidbar |
| MGNI | C-50 | 233 | 1MGNI.MI | 3607117568.00 | offen | offen | nicht entscheidbar |
| MGNI | C-nur-die-7 | 233 | 1MGNI.MI | 3607117568.00 | offen | offen | nicht entscheidbar |
| UEC | A | 7 | 1UEC.MI, U6Z.DE, UEC.SW, UEC.VI | 4854697984.00 | offen | offen | nicht entscheidbar |
| UEC | B | 7 | 1UEC.MI, U6Z.DE, UEC.SW, UEC.VI | 4854697984.00 | offen | offen | nicht entscheidbar |
| UEC | C-100 | 7 | 1UEC.MI, U6Z.DE, UEC.SW, UEC.VI | 4854697984.00 | offen | offen | nicht entscheidbar |
| UEC | C-50 | 7 | 1UEC.MI, U6Z.DE, UEC.SW, UEC.VI | 4854697984.00 | offen | offen | nicht entscheidbar |
| UEC | C-nur-die-7 | 7 | 1UEC.MI, U6Z.DE, UEC.SW, UEC.VI | 4854697984.00 | offen | offen | nicht entscheidbar |
| WSC | A | 1728 | 1WSC.MI | 3292239872.00 | offen | offen | nicht entscheidbar |
| WSC | B | 1728 | 1WSC.MI | 3292239872.00 | 5703850884.43 | 1.732514 | verdirbt |
| WSC | C-100 | 1728 | 1WSC.MI | 3292239872.00 | offen | offen | nicht entscheidbar |
| WSC | C-50 | 1728 | 1WSC.MI | 3292239872.00 | offen | offen | nicht entscheidbar |
| WSC | C-nur-die-7 | 1728 | 1WSC.MI | 3292239872.00 | offen | offen | nicht entscheidbar |

Die LU-Heimat-Ersetzung B ergibt mit diesen Dateien Faktor 2.355129; das ist nicht der Faktor 2 der Positiv-Kontrolle. Verschiedene Fundamentaldaten-/Kursstichtage und unbekannte Gattungsdefinitionen bleiben offen. Die fünf laut Brief heute korrekten US-Primärlinien sind UEC, INTC, JBS, MGNI und WSC. HSAI und LU sind die zwei belegt falschen Zeilen; alle anderen Populationsnamen erhalten kein erfundenes Wahrheitslabel.

## Reproduktion und Provenienz

`node scripts/t322-ads-verhaeltnis-optionen.js` (optional `--population <17-shard-directory>`), danach `node tests/t322-ads-verhaeltnis-optionen.test.js`.
Schreibziele sind ausschließlich die zwei fest benannten Reports. Das lokale snapshots/ wird ausdrücklich abgelehnt. Keine Netzaufrufe, keine neuen Dependencies, keine Änderungen an Daten, Brettern oder Scoring.

- Eingabepfad: C:\Users\Anwender\AppData\Local\Temp\claude\C--Users-Anwender-Market-Structure-research\754a849d-444e-4e77-98cd-1d62ad581fad\scratchpad\ci-pop-35438100627
- SHA-256 Snapshot-Pfad-/Bytefolge: bbb690de49c0cbcf7a96de2be1befa8ad98170dc0bdf8b9e0e793fc449698c5d
- SHA-256 verwendete Board-Dateien: ab8b1a3f26fd2b7a6161c766fe0082c92013d7eebd163ea68c8ddf85647ebdc0
- SHA-256 unverändert wiederverwendete Wächter-Funktionen: 1403359ad9280bd31df210c67227eff469b1e6a549dcdf45900cddd9821fb897
- Technische Bruchprobe: Test kopiert den Messcode nur im Speicher, setzt die Kollateralzählung auf 0 und verlangt denselben roten Testausgang; der normale Messcode bleibt unverändert. Ergebnis wird im Testprotokoll ausgewiesen.
