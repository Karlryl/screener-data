# T173 - Formtyp-Zaehlung der periodenlosen Berichte

Gemessen: 2026-08-29T20:33:54Z - Vertrag: `protocol/early-detection/2.0.0/r2-a1-t173-form-type-counter-addendum.json` SHA-256 `a7002de9b01c83bb025471ce1fc2c32faf3d947ca0f76e99eb4e6b5eb931dcc7`
Autoritaet: ENTSCHIED 17 (Orchestrator-Direktiven 2026-08-29) - Zugriffs-Register: nicht erforderlich (`accessLedgerEntryRequired: false`).
Gelesen: ausschliesslich `bericht.form` in den festen Fenstern `entdeckung` und `pruefung`.

## Zahlen

### entdeckung

`nonperiodicReportsExcluded` = 5892 von 176502 gelesenen Berichtszeilen.

| form_stem | Anzahl |
| --------- | -----: |
| `10-12B` | 1 |
| `10-12G` | 31 |
| `10-D` | 1 |
| `10-KT` | 157 |
| `10-QT` | 34 |
| `18-K` | 1 |
| `424B3` | 21 |
| `424B4` | 1 |
| `425` | 5 |
| `6-K` | 604 |
| `8-K` | 983 |
| `8-K12B` | 1 |
| `DEF 14A` | 3 |
| `DEFA14A` | 2 |
| `F-1` | 34 |
| `F-3` | 5 |
| `F-3ASR` | 2 |
| `F-4` | 11 |
| `NT 10-Q` | 1 |
| `POS AM` | 624 |
| `POS EX` | 12 |
| `POSASR` | 1 |
| `PRE 14A` | 1 |
| `S-1` | 2806 |
| `S-11` | 52 |
| `S-3` | 5 |
| `S-3ASR` | 4 |
| `S-4` | 489 |

Groesster Posten: `S-1` mit 2806 von 5892 (47.6 %).

### pruefung

`nonperiodicReportsExcluded` = 49093 von 148912 gelesenen Berichtszeilen.

| form_stem | Anzahl |
| --------- | -----: |
| `10-12G` | 23 |
| `10-KT` | 93 |
| `10-QT` | 26 |
| `20FR12G` | 1 |
| `424B3` | 10 |
| `424B4` | 1 |
| `424B5` | 1 |
| `425` | 3 |
| `6-K` | 1063 |
| `8-K` | 45547 |
| `8-K12B` | 14 |
| `8-K12G3` | 1 |
| `ARS` | 1 |
| `F-1` | 57 |
| `F-3ASR` | 1 |
| `F-4` | 6 |
| `POS AM` | 293 |
| `POS EX` | 2 |
| `S-1` | 1595 |
| `S-11` | 19 |
| `S-3` | 3 |
| `S-4` | 333 |

Groesster Posten: `8-K` mit 45547 von 49093 (92.8 %).

## Summenabgleich (selber Lauf)

| Fenster | Summe Karte | nonperiodicReportsExcluded | gleich |
| ------- | ----------: | ---------------------------: | ------ |
| entdeckung | 5892 | 5892 | ja |
| pruefung | 49093 | 49093 | ja |

## Quervergleich (NICHT bindend, nur zur Kenntnis)

Gegen den bereits veroeffentlichten Gesamtzaehler aus `reports/studie/R2-A1-identity-bridge-artifact-2026-08-29.json`. Der bindende Abgleich ist der Summenabgleich oben (`sameRunOnly`).

| Fenster | veroeffentlicht | dieser Lauf | gleich |
| ------- | --------------: | ----------: | ------ |
| entdeckung | 5892 | 5892 | ja |
| pruefung | 49093 | 49093 | ja |

## Belege

| Waechter | Richtung | Ampel |
| -------- | -------- | ----- |
| normalisierung | intakt | GRUEN |
| sabotage-fehlklassifikation | gebrochen | ROT |
| zwei-fenster-waechter | intakt | GRUEN |
| zwei-fenster-waechter | gebrochen | ROT |
| sabotage-leck | intakt | GRUEN |
| sabotage-leck | gebrochen | ROT |

## Neue Fragen und Hypothesen

Dieser Lauf ist eine Zaehlung, keine Analyse. Er benennt, welcher Formtyp die nichtperiodische Zaehlung je Fenster traegt, und sonst nichts. Was er ausdruecklich NICHT beantwortet, bleibt offen:

- Warum die Formtyp-Zusammensetzung zwischen den beiden Fenstern abweicht. Die Verteilung wird hier weder gedeutet noch auf eine Ursache zurueckgefuehrt (Addendum, `explicitNonClaims`).
- Ob ein gezaehlter Ausschluss inhaltlich richtig war. Der Lauf prueft die Ausschlussregel nicht, er schluesselt ihr Ergebnis auf.
- Was die Zusammensetzung fuer die Fakt-Ebene bedeutet. Die Tabelle `fakt` wurde nicht gelesen; Berichte je Formtyp sind nicht Fakten je Formtyp.
- Ob die Arbeitshypothese aus der Inbox (hoeherer Anteil auslaendischer Einreicher) traegt. Sie wird hier weder bestaetigt noch verworfen - dazu braeuchte es Groessen, die dieser Vertrag nicht freigibt.

Keine Deutung ueber die Zahlen hinaus. Keine Schwelle, kein Gate und keine Entscheidungsregel wurde beruehrt.
