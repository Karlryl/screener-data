**Ergebnis: Die beschreibende Kaplan-Meier-Medianverweildauer beträgt 27 Quartale; 6.919 von 13.317 Firmen scheiden terminal aus, 6.398 werden am Panelrand rechtszensiert.**

# D1 — Überlebenskurve der Panel-Firmen

## Wie gemessen

Die Messregel wurde vor dem ersten Panelzugriff in
`protocol/early-detection/2.0.0/d1-panel-survival-preregistration.json`
eingefroren. Gelesen wurden ausschließlich `panel-entdeckung.sqlite` und
`panel-validierung.sqlite`; beide Firmenbestände wurden über die interne CIK
zusammengeführt, die CIK danach verworfen. Kein Signal ging in Auswahl,
Zeitachse oder Ergebnis ein.

Eine Firma zählt, wenn sie mindestens einen periodischen SEC-Bericht der Form
10-K, 10-Q, 20-F oder 40-F trägt. Einstieg ist das Quartal des ersten
`accepted`-Zeitstempels. 10-K/10-Q-Firmen haben die vorregistrierte Kadenz von
91 Tagen, reine 20-F/40-F-Firmen 365 Tage. Liegt der nächste erwartete
Berichtstermin nach dem 31.12.2020, wird die Firma dort rechtszensiert;
andernfalls ist der erwartete Termin das Ausscheidequartal. Korrekturfassungen
derselben Berichtsperiode verlängern die Reihe nicht.

Die Teststatistik ist die diskrete Kaplan-Meier-Kurve je Quartal seit Einstieg.
Das technische Nullmodell lautet „kein terminaler Schwund“; es ist
beschreibend verworfen, weil mindestens ein terminales Ereignis vorliegt. Das
ist kein Signifikanztest und kein Gate. Effektives N ist 13.317 Firmen;
325.414 Berichtszeilen oder einzelne Tage werden ausdrücklich nicht als
unabhängige Beobachtungen behandelt. Von den gelesenen Berichtszeilen waren
270.429 periodisch; 54.985 nichtperiodische Zeilen wurden ausgeschlossen.

## Kerngrößen

| Größe | Wert |
|---|---:|
| Firmen (effektives N) | 13.317 |
| Terminale Ausstiege | 6.919 |
| Rechtszensiert | 6.398 |
| Firmen mit Quartalskadenz | 12.215 |
| Firmen mit Jahreskadenz | 1.102 |
| Median der Verweildauer | 27 Quartale |

## Überlebenskurve als Zahlenreihe

`at risk` ist der Risikosatz unmittelbar vor Ereignissen und Zensuren des
jeweiligen Quartals. Ereignisse werden vor Zensuren desselben Zeitpunkts
verarbeitet.

| Quartale seit Einstieg | at risk | Ausstiege | zensiert | Überleben | kumulierte Ausstiege |
|---:|---:|---:|---:|---:|---:|
| 0 | 13317 | 0 | 208 | 1.000000000000 | 0 |
| 1 | 13109 | 377 | 111 | 0.971241132047 | 377 |
| 2 | 12621 | 371 | 121 | 0.942691059945 | 748 |
| 3 | 12129 | 245 | 55 | 0.923649151323 | 993 |
| 4 | 11829 | 350 | 78 | 0.896319943193 | 1343 |
| 5 | 11401 | 271 | 82 | 0.875014557297 | 1614 |
| 6 | 11048 | 352 | 155 | 0.847135744465 | 1966 |
| 7 | 10541 | 224 | 53 | 0.829133808523 | 2190 |
| 8 | 10264 | 257 | 105 | 0.808373151003 | 2447 |
| 9 | 9902 | 235 | 117 | 0.789188371111 | 2682 |
| 10 | 9550 | 270 | 282 | 0.766876239153 | 2952 |
| 11 | 8998 | 222 | 194 | 0.747955754035 | 3174 |
| 12 | 8582 | 207 | 74 | 0.729914872995 | 3381 |
| 13 | 8301 | 224 | 61 | 0.710218338656 | 3605 |
| 14 | 8016 | 266 | 91 | 0.686650714144 | 3871 |
| 15 | 7659 | 170 | 33 | 0.671409739944 | 4041 |
| 16 | 7456 | 188 | 61 | 0.654480417102 | 4229 |
| 17 | 7207 | 199 | 58 | 0.636408875128 | 4428 |
| 18 | 6950 | 285 | 70 | 0.610311532767 | 4713 |
| 19 | 6595 | 132 | 22 | 0.598096047956 | 4845 |
| 20 | 6441 | 156 | 53 | 0.583610256389 | 5001 |
| 21 | 6232 | 171 | 72 | 0.567596560330 | 5172 |
| 22 | 5989 | 168 | 99 | 0.551674666502 | 5340 |
| 23 | 5722 | 121 | 36 | 0.540008704488 | 5461 |
| 24 | 5565 | 119 | 59 | 0.528461348543 | 5580 |
| 25 | 5387 | 119 | 80 | 0.516787522577 | 5699 |
| 26 | 5188 | 162 | 130 | 0.500650364008 | 5861 |
| 27 | 4896 | 106 | 21 | 0.489811120016 | 5967 |
| 28 | 4769 | 87 | 73 | 0.480875584801 | 6054 |
| 29 | 4609 | 82 | 51 | 0.472320193619 | 6136 |
| 30 | 4476 | 125 | 80 | 0.459129839687 | 6261 |
| 31 | 4271 | 71 | 29 | 0.451497383911 | 6332 |
| 32 | 4171 | 93 | 33 | 0.441430431932 | 6425 |
| 33 | 4045 | 82 | 40 | 0.432481780407 | 6507 |
| 34 | 3923 | 132 | 165 | 0.417929755168 | 6639 |
| 35 | 3626 | 65 | 86 | 0.410437909033 | 6704 |
| 36 | 3475 | 63 | 265 | 0.402996876438 | 6767 |
| 37 | 3147 | 83 | 1894 | 0.392368105944 | 6850 |
| 38 | 1170 | 21 | 87 | 0.385325601478 | 6871 |
| 39 | 1062 | 10 | 29 | 0.381697300146 | 6881 |
| 40 | 1023 | 12 | 57 | 0.377219912461 | 6893 |
| 41 | 954 | 10 | 542 | 0.373265825328 | 6903 |
| 42 | 402 | 5 | 29 | 0.368623215560 | 6908 |
| 43 | 368 | 3 | 13 | 0.365618134999 | 6911 |
| 44 | 352 | 3 | 33 | 0.362502071348 | 6914 |
| 45 | 316 | 4 | 296 | 0.357913437534 | 6918 |
| 46 | 16 | 1 | 15 | 0.335543847688 | 6919 |

## Anzahl Firmen je Ausscheidequartal

| Ausscheidequartal | Firmen |
|---|---:|
| 2009Q4 | 2 |
| 2010Q1 | 1 |
| 2010Q2 | 4 |
| 2010Q3 | 2 |
| 2010Q4 | 9 |
| 2011Q1 | 17 |
| 2011Q2 | 7 |
| 2011Q3 | 24 |
| 2011Q4 | 151 |
| 2012Q1 | 315 |
| 2012Q2 | 109 |
| 2012Q3 | 253 |
| 2012Q4 | 189 |
| 2013Q1 | 286 |
| 2013Q2 | 169 |
| 2013Q3 | 177 |
| 2013Q4 | 173 |
| 2014Q1 | 266 |
| 2014Q2 | 161 |
| 2014Q3 | 164 |
| 2014Q4 | 146 |
| 2015Q1 | 279 |
| 2015Q2 | 145 |
| 2015Q3 | 203 |
| 2015Q4 | 206 |
| 2016Q1 | 325 |
| 2016Q2 | 142 |
| 2016Q3 | 180 |
| 2016Q4 | 186 |
| 2017Q1 | 231 |
| 2017Q2 | 137 |
| 2017Q3 | 166 |
| 2017Q4 | 139 |
| 2018Q1 | 212 |
| 2018Q2 | 113 |
| 2018Q3 | 142 |
| 2018Q4 | 106 |
| 2019Q1 | 219 |
| 2019Q2 | 132 |
| 2019Q3 | 139 |
| 2019Q4 | 117 |
| 2020Q1 | 259 |
| 2020Q2 | 143 |
| 2020Q3 | 149 |
| 2020Q4 | 224 |

## Was ausdrücklich nicht gezeigt ist

- Die Kurve ist keine Firmen-Lebensdauer: Unternehmenshistorie vor 2009 ist in
  diesen beiden Panels nicht beobachtet.
- Ein terminales Verschwinden aus periodischen SEC-Berichten beweist weder
  Insolvenz noch Delisting oder wirtschaftliches Scheitern.
- Vorübergehende Lücken vor dem letzten Bericht werden nicht als eigene
  Ereignisse modelliert; gemessen wird terminaler Schwund.
- Die Größe und der Sektor der Firmen werden hier noch nicht ausgewertet. Das
  ist der getrennt vorregistrierte Folgeauftrag, nicht Teil dieser Kurve.
- Firmen-Identitäten, Namen, einzelne Messwerte, Signale, Tagespunkte sowie
  Daten nach dem vorregistrierten Stichtag werden weder berichtet noch als
  unabhängige Beobachtungen behandelt.

Alle Zahlen dieses Berichts stehen maschinenlesbar in
`reports/studie/D1-panel-survival-2026-08-23.json`; der zugehörige Test gleicht
jede Zeile der Kurven- und Ausscheidequartalstabellen gegen dieses Artefakt ab.
