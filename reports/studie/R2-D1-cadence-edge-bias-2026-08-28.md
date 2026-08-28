**Ergebnis: Von den 6.919 veroeffentlichten terminalen D1-Ausstiegen entfallen 17 allein auf die eingefrorene Form-Kadenz; der Median liegt in der firmengelernten Lesart bei 27 statt 27 Quartalen.**

# R2-D1 - Kadenzregel an der Panelkante

## Wie gemessen

Die Gegenmessung wurde vor dem Panelzugriff in `protocol/early-detection/2.0.0/r2-d1-cadence-edge-bias-preregistration.json` eingefroren. Die veroeffentlichte D1-Lesart blieb unveraendert: 91 Tage fuer jede Firma mit 10-K oder 10-Q, sonst 365 Tage. Daneben steht eine firmengelernte Lesart: aufgerundeter Median der positiven Abstaende zwischen aufeinanderfolgenden, periodenbereinigten `accepted`-Daten.

Firmen mit weniger als zwei verschiedenen Berichtsdaten behalten sichtbar die alte Imputation; das betrifft 700 Firmen. Gelesen wurden nur die beiden vor dem Endtest liegenden D1-Panels bis 31.12.2020. Signale, Preise, Outcomes und das versiegelte Endtest-Fenster wurden nicht geoeffnet.

## Beide Lesarten

| Kennzahl | Eingefrorene Form-Kadenz | Firmengelernte Kadenz |
|---|---:|---:|
| Terminale Ausstiege | 6919 | 6930 |
| Rechtszensiert | 6398 | 6387 |
| Median der Verweildauer (Quartale) | 27 | 27 |
| Ausstiege 2020Q4 | 224 | 248 |

## Nur durch die Form-Kadenz erzeugte Ausstiege

### Nach Meldertyp

| Meldertyp | Firmen |
|---|---:|
| domestic-quarterly | 15 |
| domestic-annual-only | 2 |
| foreign-annual-only | 0 |

### Nach Abstand zur Panelkante

| Tage vom letzten Bericht bis 31.12.2020 | Firmen |
|---|---:|
| 0-90 | 0 |
| 91-120 | 4 |
| 121-180 | 2 |
| 181-270 | 5 |
| 271-365 | 3 |
| 366+ | 3 |

## Ueberlebenskurven nebeneinander

| Quartale seit Einstieg | Form-Kadenz Ueberleben | Firmengelernt Ueberleben |
|---:|---:|---:|
| 0 | 1.000000000000 | 0.997747240369 |
| 1 | 0.971241132047 | 0.968693304373 |
| 2 | 0.942691059945 | 0.942398113477 |
| 3 | 0.923649151323 | 0.924539370287 |
| 4 | 0.896319943193 | 0.895913204009 |
| 5 | 0.875014557297 | 0.873923749492 |
| 6 | 0.847135744465 | 0.846870715248 |
| 7 | 0.829133808523 | 0.828088822786 |
| 8 | 0.808373151003 | 0.808328253819 |
| 9 | 0.789188371111 | 0.788686480360 |
| 10 | 0.766876239153 | 0.766244517534 |
| 11 | 0.747955754035 | 0.748375406075 |
| 12 | 0.729914872995 | 0.729494175623 |
| 13 | 0.710218338656 | 0.709130483078 |
| 14 | 0.686650714144 | 0.685516384926 |
| 15 | 0.671409739944 | 0.671197504823 |
| 16 | 0.654480417102 | 0.653671592472 |
| 17 | 0.636408875128 | 0.635725533776 |
| 18 | 0.610311532767 | 0.609313130202 |
| 19 | 0.598096047956 | 0.597121325869 |
| 20 | 0.583610256389 | 0.582663631187 |
| 21 | 0.567596560330 | 0.566587573349 |
| 22 | 0.551674666502 | 0.550793861990 |
| 23 | 0.540008704488 | 0.539729880483 |
| 24 | 0.528461348543 | 0.527916632292 |
| 25 | 0.516787522577 | 0.516167745816 |
| 26 | 0.500650364008 | 0.500056151438 |
| 27 | 0.489811120016 | 0.489234193077 |
| 28 | 0.480875584801 | 0.480415467316 |
| 29 | 0.472320193619 | 0.471767780527 |
| 30 | 0.459129839687 | 0.458490420610 |
| 31 | 0.451497383911 | 0.451081559012 |
| 32 | 0.441430431932 | 0.441028698963 |
| 33 | 0.432481780407 | 0.431983632984 |
| 34 | 0.417929755168 | 0.417562161037 |
| 35 | 0.410437909033 | 0.410541408054 |
| 36 | 0.402996876438 | 0.403227164577 |
| 37 | 0.392368105944 | 0.392484671134 |
| 38 | 0.385325601478 | 0.385104617489 |
| 39 | 0.381697300146 | 0.381478396986 |
| 40 | 0.377219912461 | 0.377749380397 |
| 41 | 0.373265825328 | 0.373789743286 |
| 42 | 0.368623215560 | 0.369140617126 |
| 43 | 0.365618134999 | 0.366131318617 |
| 44 | 0.362502071348 | 0.363010881242 |
| 45 | 0.357913437534 | 0.358415806796 |
| 46 | 0.335543847688 | 0.336014818871 |

## Was ausdruecklich nicht gezeigt ist

- Die firmengelernte Lesart ersetzt weder D1 noch ein Studienverdikt.
- Ein Berichtsabstand beweist weder Insolvenz noch Delisting oder wirtschaftliches Scheitern.
- Firmen mit nur einem Bericht liefern keine gelernte Kadenz; ihr Fallback bleibt ausgewiesen.
- Das Endtest-Fenster 2021-2023 wurde weder geoeffnet noch gezaehlt oder dargestellt.
- Die Messung verwendet keine Signale, Preise oder Outcomes.

Alle Zahlen stehen in `reports/studie/R2-D1-cadence-edge-bias-2026-08-28.json`. Die eingefrorene Lesart reproduziert D1 vollstaendig und byteunabhaengig nach Zahlenstruktur.
