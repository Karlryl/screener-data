# E1d — Abdeckungs-Report des Datenpanels

Stand 2026-08-19. Gelesen wurden **nur** das Entdeckungs- und das Prüffenster.
Das Endtest-Fenster wurde nicht geöffnet, nicht entschlüsselt und nicht gezählt —
es bleibt bis zum Ende der Studie verschlossen.

*Fachwörter werden bei der ersten Verwendung in einem Halbsatz übersetzt.*

## Kurz gefasst

- **Entdeckung** (2009-01-01 bis 2016-12-31, **32 Quartale breit**): 11.156 Firmen, 176.502 Berichte, 64.487.278 Kennzahl-Zeilen. Die typische Firma trägt **16 Berichtsquartale**.
- **Validierung** (2017-01-01 bis 2020-12-31, **16 Quartale breit**): 8.781 Firmen, 148.912 Berichte, 39.858.607 Kennzahl-Zeilen. Die typische Firma trägt **15 Berichtsquartale**.

Die beiden Fenster sind **unterschiedlich breit** — das Entdeckungsfenster deckt
acht Jahre ab, das Prüffenster vier. Tiefen- und Fallzahlen sind zwischen den
beiden deshalb nicht direkt vergleichbar: im schmaleren Fenster kann keine Firma
mehr Quartale am Stück haben, als das Fenster breit ist.

**Plausibilitätsanker** (Abgleich gegen den Bau-Report des Panel-Laufs): **alle Anker stimmen**.

- entdeckung / berichte: gezählt 176.502, laut Bau-Report 176.502 → stimmt
- entdeckung / fakten: gezählt 64.487.278, laut Bau-Report 64.487.278 → stimmt
- validierung / berichte: gezählt 148.912, laut Bau-Report 148.912 → stimmt
- validierung / fakten: gezählt 39.858.607, laut Bau-Report 39.858.607 → stimmt

## 1. Firmen je Jahr

Gezählt wird über die **SEC-Firmennummer** (`cik`) — die dauerhafte Kennung einer
Firma bei der US-Börsenaufsicht, unabhängig von Namensänderungen. Das Jahr ist das
Jahr der **Veröffentlichung** (`accepted`), also der Moment, ab dem die Zahlen
öffentlich waren — nicht der Bilanzstichtag. Genau an dieser Grenze sind die drei
Fenster geschnitten.

| Jahr | Fenster | Firmen | Berichte |
|---|---|---:|---:|
| 2009 | entdeckung | 477 | 951 |
| 2010 | entdeckung | 1.504 | 3.904 |
| 2011 | entdeckung | 7.964 | 18.325 |
| 2012 | entdeckung | 8.490 | 32.731 |
| 2013 | entdeckung | 8.164 | 31.795 |
| 2014 | entdeckung | 7.992 | 31.219 |
| 2015 | entdeckung | 7.761 | 29.899 |
| 2016 | entdeckung | 7.229 | 27.678 |
| 2017 | validierung | 6.890 | 26.557 |
| 2018 | validierung | 7.133 | 26.393 |
| 2019 | validierung | 7.013 | 35.041 |
| 2020 | validierung | 6.993 | 60.921 |

## 2. Firmen je Sektor

Die SEC führt die Branche als **SIC-Kennung** — eine vierstellige Zahl aus einem
amtlichen US-Branchenverzeichnis. Vierstellig ist sie zu fein (über 400 verschiedene
allein im Prüffenster), deshalb wird auf die **amtlichen SIC-Bereiche** gruppiert.
Die Gruppierung ist nicht erfunden, sie steht so im Verzeichnis:

- `0100`–`0999` → Land- und Forstwirtschaft, Fischerei
- `1000`–`1499` → Bergbau und Rohstoffgewinnung
- `1500`–`1799` → Bau
- `2000`–`3999` → Verarbeitendes Gewerbe
- `4000`–`4999` → Transport, Kommunikation, Versorger
- `5000`–`5199` → Grosshandel
- `5200`–`5999` → Einzelhandel
- `6000`–`6799` → Finanzen, Versicherung, Immobilien
- `7000`–`8999` → Dienstleistungen
- `9100`–`9729` → Oeffentliche Verwaltung
- `9900`–`9999` → Nicht klassifiziert (SEC-Sammelcode)

Eine Firma zählt in jedem Bereich, in dem sie einen Bericht abgegeben hat.

| Sektor | Entdeckung | Validierung |
|---|---:|---:|
| Verarbeitendes Gewerbe | 3.696 | 3.097 |
| Finanzen, Versicherung, Immobilien | 2.779 | 2.239 |
| Dienstleistungen | 2.334 | 1.703 |
| Bergbau und Rohstoffgewinnung | 1.062 | 665 |
| Transport, Kommunikation, Versorger | 879 | 736 |
| Einzelhandel | 609 | 423 |
| Grosshandel | 353 | 222 |
| Bau | 119 | 84 |
| Land- und Forstwirtschaft, Fischerei | 79 | 54 |
| Nicht klassifiziert (SEC-Sammelcode) | 38 | 7 |

## 3. Wie tief ist die Abdeckung je Firma?

Gezählt werden **Berichtsquartale**: verschiedene Kalenderquartale, für die eine
Firma einen periodischen Bericht abgegeben hat (Jahresbericht `10-K`, Quartalsbericht
`10-Q`, Auslandsberichte `20-F`/`40-F`). Ad-hoc-Meldungen (`8-K`) und Emissions-
prospekte (`S-1`) zählen hier **nicht** mit — sie tragen keine Berichtsperiode.

Ein **Perzentil** teilt die Firmen der Größe nach: beim 25. Perzentil haben 25 % der
Firmen weniger Quartale, 75 % mehr. Der Median ist die Mitte.

| Größe | Entdeckung | Validierung |
|---|---:|---:|
| Firmen mit mindestens einem periodischen Bericht | 11.156 | 8.781 |
| Schlechteste Firma (Quartale) | 1 | 1 |
| 10. Perzentil | 3 | 2 |
| 25. Perzentil | 7 | 5 |
| Median (typische Firma) | 16 | 15 |
| 75. Perzentil | 22 | 16 |
| 90. Perzentil | 25 | 16 |
| Beste Firma (Quartale) | 31 | 37 |
| Summe aller Firmenquartale | 165.925 | 97.777 |

Verteilung in Klassen (wie viele Firmen tragen wie viele Quartale):

| Quartale | Entdeckung | Validierung |
|---|---:|---:|
| 1 | 446 | 527 |
| 2-3 | 901 | 1.104 |
| 4-7 | 1.747 | 1.167 |
| 8-11 | 1.261 | 872 |
| 12-19 | 2.081 | 5.066 |
| 20-31 | 4.720 | 42 |
| 32+ | 0 | 3 |

## 4. Welche Kennzahlen sind wie gut belegt?

Jede Zahl in einem SEC-Bericht trägt eine **Kennzahl-Kennung** (`tag`), zum Beispiel
`Assets` für die Bilanzsumme. Es gibt zwei Sorten: Kennungen aus der **amtlichen
Taxonomie** (dem gemeinsamen Vokabular, `us-gaap/2016` und Verwandte) sind zwischen
Firmen vergleichbar — **firmeneigene Erweiterungen** sind es nicht, denn dort
erfindet jede Firma ihre eigenen Namen.

| Größe | Entdeckung | Validierung |
|---|---:|---:|
| Kennzahl-Zeilen gesamt | 64.487.278 | 39.858.607 |
| davon amtliche Taxonomie | 55.277.463 | 34.459.835 |
| davon firmeneigene Erweiterung | 9.209.815 | 5.398.772 |
| verschiedene amtliche Kennungen | 9.175 | 10.474 |
| verschiedene firmeneigene Kennungen | 1.115.270 | 586.969 |
| Nenner: periodische Berichte | 170.610 | 99.819 |

Wie sich die 150 häufigsten amtlichen Kennungen auf die periodischen Berichte
verteilen — „Belegung“ heißt: die Kennung kommt im Bericht überhaupt vor:

| Belegung | Entdeckung | Validierung |
|---|---:|---:|
| Kennungen in ≥ 90 % der Berichte | 3 | 5 |
| Kennungen in ≥ 50 % der Berichte | 34 | 34 |
| Kennungen in < 10 % der Berichte | 1 | 0 |
| Median der Belegungsquote (%) | 29.0 | 32.36 |

Die Kennzahlen, an denen diese Studie hängt — Anteil der **periodischen** Berichte,
in denen die Kennung überhaupt vorkommt:

| Kennzahl | Kennung | Entdeckung % | Validierung % |
|---|---|---:|---:|
| Umsatz (alt, bis ASC 606) | `SalesRevenueNet` | 27.8 | 11.4 |
| Umsatz (alt, Waren) | `SalesRevenueGoodsNet` | 15.0 | 6.3 |
| Umsatz (alt, Dienstleistung) | `SalesRevenueServicesNet` | 9.1 | 4.0 |
| Umsatz (Sammelkennung) | `Revenues` | 46.0 | 46.0 |
| Umsatz (neu, ab ASC 606) | `RevenueFromContractWithCustomerExcludingAssessedTax` | 0.0 | 23.5 |
| Umsatz (neu, inkl. Umlagen) | `RevenueFromContractWithCustomerIncludingAssessedTax` | 0.0 | 8.1 |
| Ergebnis nach Steuern | `NetIncomeLoss` | 88.3 | 90.8 |
| Betriebsergebnis | `OperatingIncomeLoss` | 71.9 | 75.4 |
| Rohertrag | `GrossProfit` | 38.5 | 39.3 |
| Forschung und Entwicklung | `ResearchAndDevelopmentExpense` | 25.3 | 30.2 |
| Bilanzsumme | `Assets` | 97.7 | 98.6 |
| Verbindlichkeiten | `Liabilities` | 73.0 | 80.5 |
| Eigenkapital | `StockholdersEquity` | 87.9 | 89.6 |
| Zahlungsmittel | `CashAndCashEquivalentsAtCarryingValue` | 89.4 | 87.2 |
| Operativer Cashflow | `NetCashProvidedByUsedInOperatingActivities` | 74.3 | 82.9 |
| Ergebnis je Aktie (verwaessert) | `EarningsPerShareDiluted` | 52.1 | 52.2 |
| Aktien im Umlauf | `CommonStockSharesOutstanding` | 70.0 | 73.0 |
| Vertrieb und Verwaltung | `SellingGeneralAndAdministrativeExpense` | 31.6 | 32.1 |

## 5. Wo sind die Löcher?

Das ist der wichtigste Abschnitt: eine Auswertung, die auf einem dieser Löcher
aufbaut, misst nicht Verhalten, sondern eine Lücke in den Daten.

### Jahr duenn besetzt (2)

- Im Entdeckungsfenster tragen die Berichte aus 2009 nur 477 Firmen gegen 7761 im Mittel des Fensters (6 %).
- Im Entdeckungsfenster tragen die Berichte aus 2010 nur 1504 Firmen gegen 7761 im Mittel des Fensters (19 %).

### Kennzahl kippt zwischen den Fenstern (1)

- Umsatz (neu, ab ASC 606) (RevenueFromContractWithCustomerExcludingAssessedTax) steht in 0.0 % der periodischen Berichte im Entdeckungsfenster, aber in 23.5 % im Prüffenster — Unterschied 23.5 Punkte.

### Formularmix bricht in einem Jahr (2)

- Im Prüffenster springt 8-K im Jahr 2019 auf 9581 Berichte gegen 115 im Mittel der uebrigen Jahre des Fensters (Faktor 83). Die Zahl der Berichte je Jahr ist damit ueber die Jahre nicht vergleichbar.
- Im Prüffenster springt 8-K im Jahr 2020 auf 35751 Berichte gegen 115 im Mittel der uebrigen Jahre des Fensters (Faktor 311). Die Zahl der Berichte je Jahr ist damit ueber die Jahre nicht vergleichbar.

### Fenster zu schmal fuer die geforderte Tiefe (1)

- Das Prüffenster ist nur 16 Quartale breit. Die Mindesttiefen 16 und 20 liegen an oder ueber dieser Grenze — die kleinen Fallzahlen dort sind Arithmetik, kein Datenmangel.

### Sektor zu duenn fuer eine eigene Auswertung (5)

- Land- und Forstwirtschaft, Fischerei hat im Entdeckungsfenster nur 79 Firmen — unter 100 traegt kein eigener Sektor-Schnitt.
- Nicht klassifiziert (SEC-Sammelcode) hat im Entdeckungsfenster nur 38 Firmen — unter 100 traegt kein eigener Sektor-Schnitt.
- Bau hat im Prüffenster nur 84 Firmen — unter 100 traegt kein eigener Sektor-Schnitt.
- Land- und Forstwirtschaft, Fischerei hat im Prüffenster nur 54 Firmen — unter 100 traegt kein eigener Sektor-Schnitt.
- Nicht klassifiziert (SEC-Sammelcode) hat im Prüffenster nur 7 Firmen — unter 100 traegt kein eigener Sektor-Schnitt.

## 6. Fallzahl-Vorschau

Wie viel bleibt übrig, wenn man eine **Mindesttiefe am Stück** verlangt — also
ununterbrochene Quartale ohne Lücke? Eine Lücke von einem Quartal zerreißt die
Kette; die Spalte „Quartale“ zählt nur die Quartale, die wirklich in einer solchen
Kette liegen. Die Studie braucht nach Regel R15a mindestens **200 reife Ereignisse**.

| Mindesttiefe | Entdeckung: Firmen | Entdeckung: Quartale | Validierung: Firmen | Validierung: Quartale |
|---|---:|---:|---:|---:|
| 1 Quartal | 11.156 | 162.438 | 8.781 | 95.298 |
| 4 Quartale | 9.506 | 159.651 | 6.892 | 92.634 |
| 6 Quartale | 8.814 | 156.518 | 6.393 | 90.441 |
| 8 Quartale | 7.973 | 151.109 | 5.948 | 87.527 |
| 12 Quartale | 6.680 | 138.604 | 5.027 | 78.836 |
| 16 Quartale | 5.559 | 123.327 | 4.253 ⚠ | 68.446 |
| 20 Quartale | 4.594 | 106.295 | 42 ⚠ | 933 |

⚠ = die geforderte Tiefe erreicht oder überschreitet die Breite des Fensters.
Die kleine Zahl dort ist Arithmetik, kein Datenmangel: in ein vier Jahre breites
Fenster passen keine zwanzig Quartale am Stück.

## Was nicht berechenbar war (Regel R5)

Fehlt ein Pflichtfeld, wird die Zeile gezählt und benannt — nie geschätzt.

| Fall | Entdeckung | Validierung |
|---|---:|---:|
| Bericht ohne Veröffentlichungszeitpunkt | 0 | 0 |
| Periodischer Bericht ohne lesbaren Bilanzstichtag | 0 | 0 |
| Bericht ohne brauchbare Branchenkennung | 91 | 77 |
| Bericht ohne Firmennummer | 0 | 0 |

## Neue Fragen und Hypothesen (Pflichtblock nach R16)

- 1 Pflicht-Kennzahlen wechseln zwischen Entdeckungs- und Prüffenster stark die Belegung. Zu klären, bevor irgendeine Größe über beide Fenster gerechnet wird: Braucht die Studie eine zusammengesetzte Umsatz-Größe, die die alten und die neuen Kennungen zu einer Reihe verbindet? (Zeitschätzung: 1 Tag)
- Die Abdeckungstiefe misst Berichtsquartale, nicht Zahlen-Vollständigkeit: eine Firma kann 20 Quartale abgeben und in der Hälfte davon keinen Umsatz ausweisen. Offen: eine Tiefen-Zahl auf Kennzahl-Ebene (Quartale mit belegtem Umsatz je Firma) statt auf Berichts-Ebene. (Zeitschätzung: 1 Tag)
- Firmeneigene Kennungen tragen einen messbaren Teil der Zeilen, sind aber zwischen Firmen nicht vergleichbar. Offen: Wie viel Substanz geht verloren, wenn die Studie sie ignoriert — betrifft es Randgrößen oder Kern-Positionen? (Zeitschätzung: 2 Tage)
- Die Fenstergrenzen laufen am Veröffentlichungszeitpunkt, die Berichtsperioden reichen darüber hinaus. Offen: Wie vielen Firmen zerreißt die Fenstergrenze die Kette, und verzerrt das die Fallzahl? (Zeitschätzung: 1 Tag)

