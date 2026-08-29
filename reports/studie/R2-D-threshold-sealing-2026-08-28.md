**Ergebnis: Alle sieben entscheidenden D2-D5-Schwellen und die drei Mindestgruppen-Grenzen werden aus einem Objekt-Siegel gelesen, das die unveraenderten Praeregistrierungen und die aktuell aufrufenden Skripte per SHA-256 bindet.**

# R2 - D-Schwellen an die Praeregistrierungen binden

## Wie gemessen

`protocol/early-detection/2.0.0/r2-d-threshold-seal.json` bindet die drei
urspruenglichen Praeregistrierungen bytegenau. Die Entscheidungsskripte D2, D4
und D5 laden ihre Schwellen nicht mehr aus eigenen Zahlenkonstanten, sondern
ueber `scripts/studie-threshold-seal.py` aus diesem Objekt. Der Loader liest die
benannte Stelle der jeweiligen Praeregistrierung, vergleicht ihren Wert mit dem
Siegel und prueft vor dem Import den Hash des Loaders und des aufrufenden
Skripts.

Die historischen `boundInputs` in den D4-/D5-Praeregistrierungen und den
veroeffentlichten Artefakten bleiben unveraendert. Fuer gewartete Skriptbytes
existiert eine zweite, aktuelle Bindung im neuen Siegel; historische
Artefaktbytes werden weiterhin gegen die alte Bindung geprueft.

| Skript | Schwelle | Wert aus Praeregistrierung |
|---|---|---:|
| D2 | Groessen-Risikodifferenz | 5,0 Prozentpunkte |
| D2 | Sektor Cramer's V | 0,10 |
| D2 | Mindest-N fuer Sektorspannweite | 200 |
| D4 | Groessen-Survivaldifferenz | 5,0 Prozentpunkte |
| D4 | Sektor-Survivalspannweite | 10,0 Prozentpunkte |
| D4 | Mindest-N fuer Sektorspannweite | 200 |
| D5 | Standardisierte Groessen-Survivaldifferenz | 5,0 Prozentpunkte |
| D5 | Kadenz-Survivaldifferenz | 5,0 Prozentpunkte |
| D5 | Eintrittskohorten-Spannweite | 10,0 Prozentpunkte |
| D5 | Mindest-N fuer Kohortenspannweite | 200 |

Der Selbsttest senkt D4s Sektorschwelle absichtlich von 10,0 auf 8,0, entfernt
eine D5-Schwelle vollstaendig und senkt D2s V-Wert nur im Siegel. Alle drei
Mutationen werden rot; die unveraenderte Fassung ist gruen.

## Was ausdruecklich nicht gezeigt ist

- Keine Schwelle wurde geaendert, neu gewaehlt oder methodisch bewertet.
- Die veroeffentlichten D1-D5-Artefakte und Berichte wurden nicht neu gerechnet
  und nicht ueberschrieben.
- Es wurde kein Panel, Signal, Preis, Outcome oder Endtest geoeffnet.
- Das Siegel hat keine Studien-, Methoden- oder Produkt-Verdiktautoritaet.

## Neue Fragen und Hypothesen (Pflichtblock nach R16)

Dieser Block fuehrt ausschliesslich die oben selbst dokumentierten Grenzen als
Anschlussfragen zusammen. Es kommt keine Grenze hinzu, die der Bericht nicht nennt.

- **Gebunden heisst nicht bewertet.** Der Bericht haelt fest, dass keine Schwelle
  geaendert, neu gewaehlt oder methodisch bewertet wurde. Offen bleibt genau das: ob die
  jetzt gebundenen Schwellen die methodisch richtigen sind. Das Siegel macht sie
  unveraenderlich, nicht richtig.
- **Keine Verdiktautoritaet.** Das Siegel hat laut Bericht keine Studien-, Methoden-
  oder Produkt-Verdiktautoritaet. Offen bleibt, welche Instanz ueber die Schwellen
  entscheidet — die Bindung ersetzt diese Entscheidung nicht, sie konserviert sie.
- **Was unberuehrt blieb.** Die veroeffentlichten D1-D5-Artefakte wurden nicht neu
  gerechnet, und weder Panel noch Signal, Preis, Outcome oder Endtest wurden geoeffnet.
  Jede Anschlussfrage, die daran haengt, ist aus diesem Bericht heraus nicht
  beantwortbar.

**Keine neue Etappe vorgeschlagen.** Ein Etappen-Vorschlag mit Zeitschaetzung nach R16
waere eine Forschungsentscheidung des Autors und wird hier nicht nachtraeglich erfunden.
