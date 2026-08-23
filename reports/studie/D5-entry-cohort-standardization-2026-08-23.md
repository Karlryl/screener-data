**Ergebnis: Nach Standardisierung auf dieselbe Eintrittsjahr-Verteilung liegt die Zwölf-Quartals-Auswertbarkeit kleinerer Filer bei 68,432945 % gegenüber 80,401380 % bei größeren — 11,968435603766 Prozentpunkte niedriger; der Abstand ist 6,500934895534 Punkte kleiner als in D4, bleibt aber über der vorregistrierten 5-Punkte-Marke.**

# D5 — Eintrittsjahr-Standardisierung und Meldekadenz

## Wie gemessen

Die Messregel wurde vor dem D5-Panelzugriff in
`protocol/early-detection/2.0.0/d5-entry-cohort-standardization-preregistration.json`
eingefroren. D5 bindet die D1-, D2- und D4-Skripte sowie ihre drei
Ergebnisartefakte bytegenau. Der Lauf musste D1 mit 13.317 Firmen, 6.919
terminalen Ausstiegen und 6.398 Rechtszensuren, die D2-Größengruppen und beide
unstandardisierten D4-Größenkurven exakt reproduzieren. Alle Anker waren grün.

Die Primäranalyse verwendet nur Firmen mit mindestens zwölf möglichen
Kalenderquartalen bis zum administrativen Cutoff und bekanntem D2-Größenproxy.
Innerhalb jedes geeigneten Eintrittsjahrs wird die Zwölf-Quartals-Survival für
`larger` und `smaller` getrennt geschätzt. Beide Gruppen erhalten anschließend
dieselben Gewichte: den Anteil des jeweiligen Jahres an allen 11.526 geeigneten
Firmen beider Größenklassen. Nullmodell ist gleiche standardisierte Survival;
die aus D2/D4 fortgeführte praktische Marke beträgt absolut 5 Prozentpunkte.

Als vorregistrierte Nebenreihen werden die Survival nach D1-Meldekadenz und
nach Eintrittsjahr ausgewiesen. Die Kadenzmarke beträgt 5 Prozentpunkte. Für
die Kohortenreihe gehen nur Jahre mit vollständiger Zwölf-Quartals-Chance und
mindestens 200 Firmen in die Spannweite ein; ihre Marke beträgt 10
Prozentpunkte. Das sind deskriptive Marken, keine Signifikanztests oder Gates.

Effektives N bleibt die Firma. Dieselbe Firma erscheint zur Beschreibung in
einer Größen-, einer Kadenz- und einer Eintrittsjahrgruppe; diese Tabellenwerte
werden weder addiert noch als unabhängige Wiederholungen behandelt.

## Direkte Standardisierung nach Eintrittsjahr

| Eintrittsjahr | gemeinsames N | gemeinsames Gewicht | Larger N | Larger Survival Q12 | Smaller N | Smaller Survival Q12 |
|---:|---:|---:|---:|---:|---:|---:|
| 2009 | 472 | 4.095089 % | 463 | 94.168467 % | 9 | 77.777778 % |
| 2010 | 1031 | 8.944994 % | 1020 | 90.196078 % | 11 | 81.818182 % |
| 2011 | 6484 | 56.255423 % | 1714 | 81.855309 % | 4770 | 65.618449 % |
| 2012 | 1030 | 8.936318 % | 145 | 78.620690 % | 885 | 63.389831 % |
| 2013 | 612 | 5.309735 % | 16 | 75.000000 % | 596 | 69.798658 % |
| 2014 | 615 | 5.335763 % | 27 | 66.666667 % | 588 | 69.387755 % |
| 2015 | 529 | 4.589623 % | 24 | 70.833333 % | 505 | 68.712871 % |
| 2016 | 356 | 3.088669 % | 16 | 75.000000 % | 340 | 76.764706 % |
| 2017 | 397 | 3.444387 % | 18 | 66.666667 % | 379 | 70.184697 % |

| Primärer Kontrast | Wert |
|---|---:|
| standardisierte Larger-Survival Q12 | 80.401380 % |
| standardisierte Smaller-Survival Q12 | 68.432945 % |
| standardisierte Differenz smaller minus larger | -11.968435603766 Prozentpunkte |
| unstandardisierte D4-Differenz | -18.469370499300 Prozentpunkte |
| absolute Verschiebung durch Standardisierung | 6.500934895534 Prozentpunkte |
| Vorregistrierte absolute Marke | 5 Prozentpunkte |
| Marke überschritten | ja |
| Richtung konsistent mit D4 | ja |

## Meldekadenz

| D1-Kadenz | Firmen | Ausstiege | rechtszensiert | im Risiko bei Q12 | Survival Q12 | Median Quartale |
|---|---:|---:|---:|---:|---:|---:|
| quarterly | 12215 | 6633 | 5582 | 8199 | 72.335120 % | 26 |
| annual | 1102 | 286 | 816 | 383 | 79.221546 % | 36 |

Die Differenz `annual minus quarterly` beträgt 6,886425312800
Prozentpunkte und überschreitet die vorregistrierte 5-Punkte-Marke.

## Eintrittskohorten — vollständige Reihe

| Eintrittsjahr | Horizont geeignet | Firmen | Ausstiege | rechtszensiert | im Risiko bei Q12 | Survival Q12 | Median Quartale |
|---:|:---:|---:|---:|---:|---:|---:|---:|
| 2009 | ja | 473 | 129 | 344 | 446 | 93.868922 % | nicht erreicht |
| 2010 | ja | 1033 | 392 | 641 | 943 | 90.125847 % | nicht erreicht |
| 2011 | ja | 6487 | 4212 | 2275 | 4639 | 69.909049 % | 24 |
| 2012 | ja | 1047 | 723 | 324 | 727 | 65.902579 % | 20 |
| 2013 | ja | 614 | 381 | 233 | 446 | 70.032573 % | 22 |
| 2014 | ja | 617 | 327 | 290 | 437 | 69.367909 % | 24 |
| 2015 | ja | 529 | 269 | 260 | 373 | 68.809074 % | 21 |
| 2016 | ja | 356 | 145 | 211 | 280 | 76.685393 % | nicht erreicht |
| 2017 | ja | 399 | 140 | 259 | 291 | 70.175439 % | nicht erreicht |
| 2018 | nein | 820 | 122 | 698 | 0 | nicht geschätzt | nicht erreicht |
| 2019 | nein | 429 | 61 | 368 | 0 | nicht geschätzt | nicht erreicht |
| 2020 | nein | 513 | 18 | 495 | 0 | nicht geschätzt | nicht erreicht |

Die geeigneten Eintrittsjahre 2009 bis 2017 erfüllen jeweils die Mindestgröße.
Ihre Zwölf-Quartals-Spannweite beträgt 27,966342979300 Prozentpunkte und
überschreitet die vorregistrierte 10-Punkte-Marke.

## Was ausdrücklich nicht gezeigt ist

- Die Standardisierung kontrolliert nur das beobachtete Eintrittsjahr. Sie
  beweist weder Austauschbarkeit noch nicht-informative Zensierung.
- Die späteren Eintrittsjahre werden nicht auf zwölf Quartale extrapoliert;
  „nicht geschätzt“ ist kein Nullwert und kein Überlebensurteil.
- Einige spätere Jahreszellen der Larger-Gruppe sind klein. Ihre Firmenzahlen
  stehen deshalb direkt neben jeder Survival-Schätzung.
- Die Kadenzgruppen verwenden unterschiedliche, bereits in D1 eingefrorene
  Erwartungsabstände. Der Unterschied ist kein reiner Emittenten-Effekt.
- Es werden keine Firmen-Identitäten, Namen, Einzelfälle, Signale oder
  Tagesbeobachtungen ausgegeben.
- Es wird kein späteres Endtest-Fenster geöffnet, gezählt oder dargestellt.
- D5 trifft kein Methoden-, Studien- oder Produkturteil. Dieses Urteil bleibt
  ausdrücklich beim Review durch Claude.

Alle Zahlen dieses Berichts stehen maschinenlesbar in
`reports/studie/D5-entry-cohort-standardization-2026-08-23.json`; der
zugehörige Test rekonstruiert Gewichte, Standardisierung, Nebenreihen und jede
Tabellenzeile daraus.
