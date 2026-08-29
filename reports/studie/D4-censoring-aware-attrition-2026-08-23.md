**Ergebnis: Nach zwölf Quartalen liegt die zensierungsbewusste Auswertbarkeit der kleineren SEC-Filerstatus-Gruppe bei 67,382415 % gegenüber 85,851786 % bei der größeren — 18,469370499300 Prozentpunkte niedriger; die Sektorspannweite von 9,740293323500 Punkten bleibt dagegen unter ihrer vorregistrierten 10-Punkte-Marke.**

# D4 — Zensierungs-Gegenprobe für Größe und Sektor

## Wie gemessen

Die Messregel wurde vor dem erneuten Panelzugriff in
`protocol/early-detection/2.0.0/d4-censoring-aware-attrition-preregistration.json`
eingefroren. D4 bindet die D1- und D2-Skripte sowie beide Ergebnisartefakte
bytegenau. Der Lauf musste D1 mit 13.317 Firmen, 6.919 terminalen Ausstiegen und
6.398 Rechtszensuren sowie jede D2-Größen- und Sektorgruppe exakt reproduzieren.
Beide Ankerprüfungen waren grün.

Für jede unveränderte D2-Gruppe wurde eine eigene diskrete Kaplan-Meier-Kurve
mit D1-Ereignis und D1-Zensierung gerechnet. Gemeinsamer Horizont sind zwölf
Quartale seit Eintritt; Ereignisse werden bei gleicher Dauer vor Zensuren
verrechnet. Primäre Statistik ist die Survival-Differenz `smaller minus larger`.
Nullmodell ist Gleichheit, die aus D2 fortgeführte praktische Marke beträgt
absolut 5 Prozentpunkte. Für Sektoren ist die Statistik die größte Differenz
der Zwölf-Quartals-Survivalwerte unter Gruppen mit mindestens 200 Firmen; ihre
vorab gesetzte deskriptive Marke beträgt 10 Prozentpunkte. Beides sind weder
Signifikanztests noch Studien- oder Produktgates.

Effektives N ist die Firma innerhalb ihrer genau einen Größen- und genau einen
Sektorgruppe. Firmen werden nicht mehrfach als unabhängige Beobachtungen
gezählt; Berichte und Tage erzeugen kein zusätzliches N.

## Größe — Zwölf-Quartals-Gegenprobe

| Gruppe | Firmen | Ausstiege | rechtszensiert | im Risiko bei Q12 | Survival Q12 | Median Quartale |
|---|---:|---:|---:|---:|---:|---:|
| larger | 3734 | 1429 | 2305 | 2982 | 85.851786 % | nicht erreicht |
| smaller | 9463 | 5471 | 3992 | 5574 | 67.382415 % | 21 |
| fehlend/unbekannt | 120 | 19 | 101 | 26 | 88.358860 % | nicht erreicht |

| Gegenprobe | Wert |
|---|---:|
| D2 rohe Schwunddifferenz smaller minus larger | 19.544694723695 Prozentpunkte |
| D4 Survivaldifferenz smaller minus larger | -18.469370499300 Prozentpunkte |
| Vorregistrierte absolute Marke | 5 Prozentpunkte |
| Marke überschritten | ja |
| Richtung konsistent mit D2 | ja |

Das Vorzeichen wechselt erwartungsgemäß, weil D2 Schwund und D4 Survival
misst: mehr Schwund der kleineren Gruppe entspricht niedrigerer Survival.

## Sektor — vollständige aggregierte Gegenprobe

| SIC-Division | Firmen | Ausstiege | rechtszensiert | im Risiko bei Q12 | Survival Q12 | Median Quartale |
|---|---:|---:|---:|---:|---:|---:|
| Agriculture, Forestry and Fishing | 74 | 43 | 31 | 48 | 71.623549 % | 27 |
| Construction | 119 | 61 | 58 | 82 | 72.984454 % | 30 |
| Finance, Insurance and Real Estate | 3344 | 1656 | 1688 | 1996 | 70.265389 % | 26 |
| Manufacturing | 4113 | 1902 | 2211 | 2781 | 77.446092 % | 33 |
| Mining | 1146 | 741 | 405 | 698 | 67.893086 % | 20 |
| Nonclassifiable Establishments | 37 | 31 | 6 | 22 | 56.756757 % | 14 |
| Retail Trade | 630 | 352 | 278 | 439 | 73.522396 % | 26 |
| Services | 2533 | 1446 | 1087 | 1625 | 70.690475 % | 23 |
| Transportation, Communications and Utilities | 971 | 478 | 493 | 660 | 77.633379 % | 32 |
| Wholesale Trade | 332 | 194 | 138 | 229 | 70.010194 % | 24 |
| unclassified | 18 | 15 | 3 | 2 | 20.000000 % | 2 |

Sieben Sektoren erfüllen die vorregistrierte Mindestgröße von 200 Firmen. In
diesem Vergleich beträgt die Spannweite 9,740293323500 Prozentpunkte bei einer
Marke von 10 Prozentpunkten; die Marke wird nicht überschritten. Die kleineren
Gruppen bleiben vollständig sichtbar, bestimmen diese Spannweite aber nicht.

## Was ausdrücklich nicht gezeigt ist

- Kaplan-Meier berücksichtigt die beobachtete Rechtszensierung, beweist aber
  nicht, dass Zensierung innerhalb jeder Gruppe nicht-informativ ist.
- `afs` bleibt ein regulatorischer Größenproxy. Die Messung zeigt keine
  Marktkapitalisierung, Bilanzsumme oder Umsatzzahl.
- Die Zusammenhänge sind nicht kausal und erklären nicht, warum Firmen aus den
  Daten verschwinden.
- Es werden keine Firmen-Identitäten, Namen, Einzelfälle, Signale oder
  Tagesbeobachtungen ausgegeben.
- Es wird kein späteres Endtest-Fenster geöffnet, gezählt oder dargestellt.
- D4 ersetzt D2 nicht und trifft kein Methoden-, Studien- oder Produkturteil.
  Dieses Urteil bleibt ausdrücklich beim Review durch Claude.

Alle Zahlen dieses Berichts stehen maschinenlesbar in
`reports/studie/D4-censoring-aware-attrition-2026-08-23.json`; der zugehörige
Test rekonstruiert Anker, Kurven, Kontraste und jede Tabellenzeile daraus.
