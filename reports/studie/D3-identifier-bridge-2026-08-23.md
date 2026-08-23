**Ergebnis: Im S-U-Signalarm des Prüffensters bleiben nach einer reinen Kennungsbrücke 74 von 438 Firmen als Schwund (16,894977 %); 72 der zuvor 146 Verluste werden zurückgewonnen, die Retention steigt damit um 16,438356164384 Prozentpunkte auf 83,105023 %.**

# D3 — Kennungsbrücke messen statt vermuten

## Wie gemessen

Die Messregel wurde vor dem D3-Faktenzugriff in
`protocol/early-detection/2.0.0/d3-identifier-bridge-preregistration.json`
eingefroren. Der Lauf hat die beiden committeten E4a-Aggregate mit den dort
gebundenen Rechenmodulen erneut erzeugt und bytegenau gegen ihre Anker
abgeglichen. Beide Anker stimmten.

Zurückgewonnen wird ausschließlich E4a-Klasse
`klasse_b1_nur_kennungsname`: Die Firma bleibt als auswertbar gezählt, aber es
werden keine Werte über die Kennungsnaht hinweg verrechnet. Klasse
`klasse_b2_auch_waehrungseinheit` bleibt Verlust. Nullmodell ist null
zurückgewonnene Firmen; die vorregistrierte deskriptive Schwelle ist mindestens
eine zurückgewonnene Firma. Das ist kein Signifikanztest und kein Gate.

Effektives N ist in jeder Zeile die Zahl der Firmen mit erstem Ereignis. Die
Fenster und Arme werden nicht zusammengelegt; insbesondere werden
überlappende Zeitfenster nicht als unabhängige Beobachtungen behandelt. Tage
und Berichte sind kein zusätzliches N.

## S-U — Kennungsbrücke

| Fenster | Band | Arm | effektives N | gehalten vorher | Schwund vorher | Kennung zurück | gehalten nachher | Schwund nachher | Schwundquote nachher | Retentionsgewinn |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| entdeckung | 2009-2015 | signal | 651 | 543 | 108 | 17 | 560 | 91 | 13.978495 % | 2.611367127496 Prozentpunkte |
| entdeckung | 2009-2015 | kontrolle | 4514 | 3761 | 753 | 139 | 3900 | 614 | 13.602127 % | 3.079308817014 Prozentpunkte |
| pruefung | 2017-2019 | signal | 438 | 292 | 146 | 72 | 364 | 74 | 16.894977 % | 16.438356164384 Prozentpunkte |
| pruefung | 2017-2019 | kontrolle | 4163 | 3085 | 1078 | 613 | 3698 | 465 | 11.169829 % | 14.724957963007 Prozentpunkte |

## S-G — vorregistrierte Negativkontrolle

| Fenster | Band | Arm | effektives N | Schwund vorher | Kennung zurück | Währungswechsel nicht zurück | Schwund nachher | Schwundquote nachher | Retention nachher |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| entdeckung | 2009-2015 | signal | 647 | 90 | 0 | 0 | 90 | 13.910355 % | 86.089645 % |
| entdeckung | 2009-2015 | kontrolle | 5768 | 768 | 0 | 2 | 768 | 13.314840 % | 86.685160 % |
| pruefung | 2017-2019 | signal | 365 | 39 | 0 | 0 | 39 | 10.684932 % | 89.315068 % |
| pruefung | 2017-2019 | kontrolle | 4733 | 448 | 0 | 1 | 448 | 9.465455 % | 90.534545 % |

Die Negativkontrolle gewinnt in jeder Zeile null reine Kennungsfälle zurück;
ihre Retention verbessert sich durch die Brücke daher um null Prozentpunkte.

## Was ausdrücklich nicht gezeigt ist

- Es werden keine Firmen-Identitäten, Namen oder Einzelfälle ausgegeben.
- Die Brücke zeigt keine wirtschaftliche Kontinuität und validiert keine
  Unternehmenshistorie außerhalb der bereits gebundenen E4a-Klassifikation.
- Über die Kennungsnaht werden keine Werte, Wachstumsraten oder Signale
  gerechnet; Währungswechsel werden ausdrücklich nicht repariert.
- Es wird kein späteres Endtest-Fenster geöffnet, gezählt oder dargestellt.
- Die Messung ändert weder das abgeschlossene E4d/E4e-Verdikt noch eine
  Schwelle, Methode oder Produktentscheidung. Das Urteil bleibt beim Review
  durch Claude.

Alle Zahlen dieses Berichts stehen maschinenlesbar in
`reports/studie/D3-identifier-bridge-2026-08-23.json`; der zugehörige Test
rechnet jede Zeile, jeden Anker und die Berichtstabellen gegen dieses Artefakt
nach.
