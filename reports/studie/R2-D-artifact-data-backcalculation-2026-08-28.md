**Ergebnis: Sechs von sechs vorregistrierten D1-D6-Kennzahlen wurden aus ihren gebundenen Datenobjekten exakt zurueckgerechnet; die Abweichungszahl ist null.**

# R2 - Artefakt-Daten-Rueckrechnung der D-Reihe

## Wie gemessen

Die Rueckrechnung wurde vor dem Panelzugriff in `protocol/early-detection/2.0.0/r2-d-artifact-data-backcalculation-registration.json` eingefroren. D1, D2, D4 und D5 wurden aus den zwei Panels bis 31.12.2020 neu aggregiert. D3 wurde nur aus seinem bereits committeten E4a-Aggregat abgeleitet; kein E-Stadium lief. D6 wurde nur aus D1-D5 abgeleitet und oeffnete kein Panel.

| Skript | Kennzahl | Veroeffentlicht | Zurueckgerechnet | Quelle |
|---|---|---:|---:|---|
| D1 | `counts.terminalExits` | 6919 | 6919 | pre-endtest panels |
| D2 | `size.riskDifferencePercentagePointsSmallerMinusLarger` | 19.544694723695 | 19.544694723695 | pre-endtest panels |
| D3 | `pruefung/S-U/signal.identityOnlyRecovered` | 72 | 72 | committed E4a aggregate anchor |
| D4 | `size.survivalDifferencePercentagePointsSmallerMinusLarger` | -18.4693704993 | -18.4693704993 | pre-endtest panels |
| D5 | `standardizedSize.survivalDifferencePercentagePointsSmallerMinusLarger` | -11.968435603766 | -11.968435603766 | pre-endtest panels |
| D6 | `auditContract.observedFailures` | 0 | 0 | committed D1-D5 artifacts |

## Was ausdruecklich nicht gezeigt ist

- Keine veroeffentlichte D-Zahl oder Schwelle wurde geaendert.
- D3 ist an sein committetes E4a-Aggregat zurueckgerechnet, nicht durch einen neuen E4a-Lauf.
- Die Rueckrechnung trifft keine Interpretation, Empfehlung oder Verdiktaussage.
- Preise, Outcomes und das versiegelte Endtest-Fenster 2021-2023 wurden nicht geoeffnet.
- Es werden keine Firmenidentitaeten oder Einzelwerte ausgegeben.

## Neue Fragen und Hypothesen (Pflichtblock nach R16)

Dieser Block fuehrt ausschliesslich die oben selbst dokumentierten Grenzen als
Anschlussfragen zusammen. Es kommt keine Grenze hinzu, die der Bericht nicht nennt.

- **Rueckrechnung statt Neulauf.** D3 ist an sein committetes E4a-Aggregat
  zurueckgerechnet, nicht durch einen neuen E4a-Lauf. Offen bleibt, ob ein frischer
  E4a-Lauf dasselbe Aggregat ergaebe — die Rueckrechnung prueft das bauartbedingt nicht.
- **Keine Interpretation.** Der Bericht trifft ausdruecklich keine Interpretation,
  Empfehlung oder Verdiktaussage. Offen bleibt, was aus der Rueckrechnung inhaltlich
  folgt; das ist keine Frage an die Rechnung, sondern an die Methodik.
- **Was verschlossen blieb.** Preise, Outcomes und das versiegelte Endtest-Fenster
  2021-2023 wurden nicht geoeffnet, Firmenidentitaeten nicht ausgegeben. Jede
  Anschlussfrage, die daran haengt, ist aus diesem Bericht heraus nicht beantwortbar.

**Keine neue Etappe vorgeschlagen.** Ein Etappen-Vorschlag mit Zeitschaetzung nach R16
waere eine Forschungsentscheidung des Autors und wird hier nicht nachtraeglich erfunden.
