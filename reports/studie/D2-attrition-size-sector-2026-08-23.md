**Ergebnis: Kleinere SEC-Filerstatus-Gruppen liegen beim terminalen Schwund 19,544694723695 Prozentpunkte über den größeren; für den Einstiegssektor beträgt Cramérs V 0,119840265081 — beide vorregistrierten deskriptiven Effektgrenzen werden überschritten.**

# D2 — Hängt der Schwund an Größe oder Sektor?

## Wie gemessen

Die Messregel wurde vor dem D2-Panelzugriff in
`protocol/early-detection/2.0.0/d2-attrition-size-sector-preregistration.json`
eingefroren. Population und terminales Ereignis sind unverändert aus D1
übernommen; der Lauf bricht ab, wenn Firmen-, Ereignis- oder Zensurzahl vom
committeten D1-Artefakt abweichen. Der Abgleich war exakt: 13.317 Firmen,
6.919 terminale Ausstiege und 6.398 Rechtszensuren.

Als Größenproxy dient `afs` aus dem ersten beobachteten periodischen Bericht.
Die Gruppen folgen der [offiziellen SEC-Codierung](https://www.sec.gov/files/financial-statement-data-sets.pdf):
`1-LAF/2-ACC` bilden „larger“, `3-SRA/4-NON/5-SML` „smaller“. Fehlende oder
unbekannte Werte bleiben sichtbar, gehen aber nicht in den binären Kontrast
ein. Teststatistik ist die Differenz der terminalen Ausstiegsquoten, smaller
minus larger; Nullmodell ist Quotengleichheit, praktische Schwelle sind
5 Prozentpunkte.

Der Sektor ist die SIC-Division desselben Eintrittsberichts. Teststatistik ist
Cramérs V der 2×K-Tabelle aus Ausstieg/Zensur und SIC-Division; Nullmodell ist
Unabhängigkeit, praktische Schwelle `V = 0,10`. Die zusätzliche Spannweite
verwendet nur Sektoren mit mindestens 200 Firmen. Beide Schwellen sind
deskriptive Effektgrenzen, keine Signifikanztests und keine Produktgates.
Effektives N ist jeweils Firma; Berichte und Tage werden nicht als unabhängige
Beobachtungen gerechnet.

## Größenproxy — aggregierter Kontrast

| Gruppe | Firmen | terminale Ausstiege | rechtszensiert | Ausstiegsquote |
|---|---:|---:|---:|---:|
| larger | 3734 | 1429 | 2305 | 38.269952 % |
| smaller | 9463 | 5471 | 3992 | 57.814647 % |
| fehlend/unbekannt | 120 | 19 | 101 | 15.833333 % |

| Effektgröße | Wert |
|---|---:|
| Differenz smaller minus larger | 19.544694723695 Prozentpunkte |
| Risikoverhältnis smaller / larger | 1.510706018882 |
| Vorregistrierte praktische Schwelle | 5 Prozentpunkte |
| Schwelle überschritten | ja |

## Einzelne SEC-Filerstatus-Klassen

| Code | SEC-Klasse | Firmen | Ausstiege | rechtszensiert | Ausstiegsquote |
|---|---|---:|---:|---:|---:|
| 1-LAF | Large Accelerated Filer | 1921 | 628 | 1293 | 32.691307 % |
| 2-ACC | Accelerated Filer | 1813 | 801 | 1012 | 44.180916 % |
| 3-SRA | Smaller Reporting Accelerated Filer | 7 | 6 | 1 | 85.714286 % |
| 4-NON | Non-Accelerated Filer | 3610 | 1356 | 2254 | 37.562327 % |
| 5-SML | Smaller Reporting Filer | 5846 | 4109 | 1737 | 70.287376 % |

## Sektor — vollständige aggregierte Reihe

13.299 Firmen tragen eine klassifizierbare SIC-Division; 18 bleiben
unklassifiziert. Cramérs V beträgt 0,119840265081 bei einer vorregistrierten
Schwelle von 0,10. Die Spannweite der Ausstiegsquoten unter Sektoren mit
mindestens 200 Firmen beträgt 18,416068066646 Prozentpunkte.

| SIC-Division | Firmen | Ausstiege | rechtszensiert | Ausstiegsquote |
|---|---:|---:|---:|---:|
| Agriculture, Forestry and Fishing | 74 | 43 | 31 | 58.108108 % |
| Construction | 119 | 61 | 58 | 51.260504 % |
| Finance, Insurance and Real Estate | 3344 | 1656 | 1688 | 49.521531 % |
| Manufacturing | 4113 | 1902 | 2211 | 46.243618 % |
| Mining | 1146 | 741 | 405 | 64.659686 % |
| Nonclassifiable Establishments | 37 | 31 | 6 | 83.783784 % |
| Retail Trade | 630 | 352 | 278 | 55.873016 % |
| Services | 2533 | 1446 | 1087 | 57.086459 % |
| Transportation, Communications and Utilities | 971 | 478 | 493 | 49.227600 % |
| Wholesale Trade | 332 | 194 | 138 | 58.433735 % |
| unclassified | 18 | 15 | 3 | 83.333333 % |

## Was ausdrücklich nicht gezeigt ist

- `afs` ist ein regulatorischer SEC-Filerstatus und nur ein Größenproxy. Die
  Messung zeigt keine Marktkapitalisierung, Bilanzsumme oder Umsatzzahl.
- Der Zusammenhang ist nicht kausal. Er beweist weder, dass Größe oder Sektor
  den Schwund verursachen, noch warum einzelne Firmen verschwinden.
- Kleine Klassen bleiben klein: `3-SRA` umfasst 7 Firmen; die vollständigen
  Gruppenzahlen stehen deshalb neben jeder Quote.
- Es werden keine Firmen-Identitäten, Namen, Einzelfälle, Signale oder
  Tagesbeobachtungen ausgegeben.
- Die Effektgrenzen treffen kein Methoden-, Studien- oder Produkturteil. Dieses
  Urteil bleibt ausdrücklich beim Review durch Claude.

Alle Zahlen dieses Berichts stehen maschinenlesbar in
`reports/studie/D2-attrition-size-sector-2026-08-23.json`; der zugehörige Test
gleicht jede AFS- und Sektorzeile gegen dieses Artefakt ab.
