**Ergebnis: Das deskriptive Paket D1–D5 ist mit 0 Integritätsfehlern über 21 bytegebundene Quellen rechnerisch übergabereif; D6 hat 0 Paneldateien geöffnet und lässt 4 Urteilsfragen ausdrücklich bei Claude.**

# D6 — Panel-freier Abschluss-Audit des beschreibenden Strangs

## Wie gemessen

Der Auditvertrag wurde nach Veröffentlichung von D1–D5, aber vor der
D6-Assemblierung in
`protocol/early-detection/2.0.0/d6-descriptive-closure-audit-registration.json`
eingefroren. D6 ist deshalb ehrlich kein neuer hypothesenblinder Studientest,
sondern ein Reproduzierbarkeits- und Übergabeaudit über bereits veröffentlichte
Artefakte.

Gebunden sind 21 Dateien: die fünf Messregeln, fünf Skripte, fünf
JSON-Artefakte, fünf Berichte und das versiegelte Kadenzskript. Teststatistik
ist die Zahl der Hash-, Berichtskontrakt-, Rechen-, Anker-, Scope- oder
Reconciliation-Fehler. Nullmodell sind 0 Fehler; bereits 1 Fehler lässt den
Audit fail-closed abbrechen. Beobachtet wurden 0 Fehler.

D6 hat keine SQLite-Datei, keine Firmenzeile und keine neue empirische
Beobachtung geöffnet. Alle effektiven N bleiben ausschließlich die der
Quellartefakte; D6 addiert sie nicht.

## Gebundener Zahlenpass

| Stufe | Kennzahl | Wert |
|---|---|---:|
| D1 | Firmen | 13317 |
| D1 | terminale Ausstiege | 6919 |
| D1 | rechtszensiert | 6398 |
| D1 | Median Verweildauer | 27 Quartale |
| D2 | rohe Schwunddifferenz smaller minus larger | 19.544694723695 Prozentpunkte |
| D2 | Sektor Cramérs V | 0.119840265081 |
| D3 | S-U-Prüfsignal Firmen beim ersten Ereignis | 438 |
| D3 | Schwund vor Kennungsbrücke | 146 |
| D3 | reine Kennungsfälle zurückgewonnen | 72 |
| D3 | verbleibender Schwund | 74 |
| D3 | verbleibende Schwundquote | 16.894977 % |
| D3 | Retention nach Brücke | 83.105023 % |
| D4 | Survivaldifferenz smaller minus larger | -18.469370499300 Prozentpunkte |
| D4 | Sektorspannweite Survival Q12 | 9.740293323500 Prozentpunkte |
| D5 | standardisierte Survivaldifferenz smaller minus larger | -11.968435603766 Prozentpunkte |
| D5 | absolute Verschiebung gegenüber D4 | 6.500934895534 Prozentpunkte |
| D5 | Kadenzdifferenz annual minus quarterly | 6.886425312800 Prozentpunkte |
| D5 | Eintrittskohorten-Spannweite | 27.966342979300 Prozentpunkte |

## Reconciliation über die Stufen

- D1, D2, D4 und D5 führen exakt dieselben Firmen-, Ereignis- und
  Zensurzahlen.
- Die Größenrichtung ist über D2, D4 und D5 konsistent: höhere rohe
  Attrition der kleineren Gruppe entspricht niedrigerer Survival vor und nach
  Eintrittsjahr-Standardisierung.
- Die D3-Zielzeile geht exakt auf: 72 zurückgewonnene plus 74 verbleibende
  Verluste ergeben die 146 Verluste vor der Brücke.
- Die vorregistrierten deskriptiven Sektorflags unterscheiden sich: D2
  überschreitet seine Cramérs-V-Marke, D4 unterschreitet seine
  Zwölf-Quartals-Spannweitenmarke.
- In D5 überschreiten sowohl Kadenz als auch Eintrittskohorte ihre jeweils
  vorregistrierte deskriptive Marke.

## Offene Urteilsfragen — ausschließlich Claude

| Schlüssel | Was Claude entscheiden muss |
|---|---|
| size-association-after-adjustments | Welche methodische Bedeutung der über rohe Quote, Kaplan-Meier und Eintrittsjahr-Standardisierung gleichgerichtete Größenbefund erhält. |
| sector-statistics-disagree-on-descriptive-flags | Wie das unterschiedliche Sektorbild zwischen D2 und D4 berichtet und gewichtet wird. |
| entry-cohort-and-cadence-heterogeneity | Ob spätere Beschreibungen standardmäßig nach Eintrittskohorte und Kadenz stratifiziert werden müssen. |
| identity-bridge-as-future-default | Ob kennungsüberbrückte Verfügbarkeit künftig der Standard wird, ohne Werte über die Naht zu rechnen. |

## Was ausdrücklich nicht gezeigt ist

- D6 liefert keine neue empirische Evidenz und ist keine nachträgliche
  Präregistrierung der bereits veröffentlichten D1–D5-Befunde.
- Ein sauberer Audit macht keinen Zusammenhang kausal und entscheidet nicht,
  welche der verschiedenen deskriptiven Statistiken methodisch Vorrang hat.
- D6 ändert weder das abgeschlossene konfirmatorische Verdikt noch eine
  Schwelle, ein Signal, eine Methode oder eine Produktentscheidung.
- Es wurden keine Firmen-Identitäten, Namen, Einzelfälle, Panelzeilen,
  Tagespunkte oder neuen Signale gelesen beziehungsweise ausgegeben.
- Es wurde kein späteres Endtest-Fenster geöffnet, gezählt oder dargestellt.
- „Übergabereif“ bedeutet ausschließlich: Hashes, Rechenketten und
  Berichtskontrakte sind geschlossen. Ob der beschreibende Studienstrang damit
  methodisch abgeschlossen ist, entscheidet Claude.

Alle Zahlen und vier offenen Schlüssel dieses Berichts stehen
maschinenlesbar in
`reports/studie/D6-descriptive-closure-audit-2026-08-23.json`.

## Neue Fragen und Hypothesen (Pflichtblock nach R16)

Dieser Block führt ausschließlich zusammen, was der Bericht oben selbst als Grenze
oder als offene Urteilsfrage benennt. Es kommt nichts hinzu, was hier nicht schon steht.

- **Vorrang unter den deskriptiven Statistiken.** Der Bericht hält fest, dass ein
  sauberer Audit nicht entscheidet, welche der verschiedenen deskriptiven Statistiken
  methodisch Vorrang hat. Offen bleibt genau diese Reihenfolge.
- **Ist der beschreibende Strang methodisch abgeschlossen?** „Übergabereif" bedeutet
  laut Bericht ausschließlich, dass Hashes, Rechenketten und Berichtskontrakte
  geschlossen sind. Die methodische Abschlussfrage ist ausdrücklich offen und liegt
  bei Claude.
- **Kausalität bleibt außerhalb.** Der Bericht hält fest, dass ein Audit keinen
  Zusammenhang kausal macht. Offen bleibt, welche Evidenzart das überhaupt leisten
  könnte — der Audit selbst kann es konstruktionsbedingt nicht.
- **Keine neue Evidenz aus D6.** D6 liefert laut eigener Aussage keine neue empirische
  Evidenz und ist keine nachträgliche Präregistrierung von D1–D5. Jede Anschlussfrage,
  die neue Evidenz bräuchte, ist aus diesem Bericht heraus nicht beantwortbar.

**Keine neue Etappe vorgeschlagen.** Ein Etappen-Vorschlag mit Zeitschätzung nach R16
wäre eine Forschungsentscheidung des Autors und wird hier nicht nachträglich erfunden.
