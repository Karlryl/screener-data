# Falsche Werte leer statt falsch: Vorher/Nachher am Datentag 21.11.2026

> **Auf einen Blick**
>
> **Drei der fünf falschen Werte aus der Stichprobe vom 22.11. (Dorian LPG, Tokyo Steel an der OTC, Huatai Securities) gehören zu Fehlerklassen, die sich genau abgrenzen lassen; diese drei Klassen werden jetzt leer mit deutschem Grund gezeigt, zusammen 480 Zeilen im Filter und 10 Zeilen im Rule-of-40-Brett.**
>
> - **Eingefrorener OTC-Kurs:** 457 Zeilen verlieren Börsenwert und die Kurskennzahlen. Wo es eine Heimatnotierung gibt, lagen 77 % davon mehr als 5 % daneben; geschätzt 20 bis 25 % der geleerten Werte hätten zufällig noch gepasst (Sicherheit der Schätzung etwa 70 %).
> - **China-Wachstum gegen Börsenmeldung (23 Zeilen) und EBITDA-Marge unter der operativen Marge (10 Zeilen):** Hier trifft die Regel nach Aufbau nur Werte, die um mehr als 2 Punkte falsch sind (Sicherheit etwa 90 %).
> - **Nicht umgesetzt:** Intuitive Machines (EBITDA zu günstig) und Helios Towers (Eigenkapitalrendite mit Minderheitsanteilen). Beide Klassen sind auf den Daten nicht sauber abgrenzbar; Messung und Empfehlung stehen unten.

## Was gemessen wurde
Datentag 21.11.2026: veröffentlichter Filter-Feed (gh-pages 0e24d23b42, 15.769 Zeilen) und Rule-of-40-Brett (484 Zeilen), dieselben 15.769 Snapshots, Kursspeicher `prices/history` und Börsenspeicher `external-data/exchange-quarters` auf main 08c9b5ca. „Nachher“ ist der Feed nach den drei neuen Regeln auf denselben Zeilen (Nachspiel mit den echten Funktionen des Schreibers, alles andere festgehalten). Der Vertragsprüfer des Feeds meldet nachher keinen Fehler, der Füllstands-Wächter ist grün.

Hinweis zu den Namen in `ergebnis.md`: TOKSF ist Tokyo Steel Manufacturing (Heimatnotierung 5423.T), nicht Tokyu Fudosan, und HTWS.L ist Helios Towers, nicht Hollywood Bowl. Die Prüfrunden haben die richtigen Firmen geprüft, nur die Zusammenfassung trägt die falschen Namen.

## Die fünf Stichprobenwerte
| Wert | Klasse (Ursache im Code) | abgedeckt |
|---|---|---|
| Dorian LPG, EBITDA-Marge 67,5 % | Yahoo `financialData.ebitdaMargins` rechnet die Gewinne aus Schiffsverkäufen heraus, die im operativen Ergebnis stehen; `ebitdaMargePct` in `scripts/write-rule40-export.js` reichte den Wert ungeprüft durch | ja |
| Intuitive Machines, EBITDA-Marge −9,9 % | derselbe Yahoo-Wert, hier zu günstig; Ursache vermutlich höhere Abschreibungen nach einem Zukauf oder weitere Zurechnungen | nein |
| Tokyo Steel an der OTC (TOKSF), Börsenwert | Yahoo stempelt die OTC-Kursmeldung als aktuell (19.11.), der Kurs ist aber der letzte OTC-Handel vom 05.05.; die Sperre für alte Kursmeldungen (`lib/market-cap-guard.js`) greift deshalb nicht | ja |
| Helios Towers (HTWS.L), Eigenkapitalrendite 32,9 % | Yahoo `financialData.returnOnEquity` rechnet hier mit Gewinn und Eigenkapital einschließlich Minderheitsanteilen; der Filter zeigt ihn ungeprüft | nein |
| Huatai Securities (601688.SS), Umsatzwachstum 4,38 % | Das Vorjahresquartal fehlt bei Yahoo, deshalb fällt das Wachstum auf das Geschäftsjahr 2025 gegen 2024 zurück, auf Yahoos Umsatzbegriff; die Börsenmeldung ergibt 6,83 % | ja |

## Umgesetzte Regeln
**1. Eingefrorener OTC-Kurs** (`lib/frozen-close.js`, im Filter-Feed): Eine OTC-Notierung, deren letzte 20 gespeicherte Schlusskurse gleich sind und dem Kurs der Kursmeldung entsprechen, hat keinen aktuellen Marktpreis. Dann fehlen Börsenwert, P/S, EV/Sales, P/E, Forward P/E, Dividendenrendite und Abstand zum 52-Wochen-Hoch, mit einem Satz, der genau diese Felder und den ersten Tag ohne Kursänderung nennt. Ändert sich der Kurs, kommen die Werte von selbst zurück. Snapshots, Brett-Börsenwerte und Scores bleiben unverändert.

**2. China-Wachstum gegen Börsenmeldung** (`lib/shown-growth-check.js`, im Filter-Feed; ob eine Firma prüfbar ist, entscheidet wie bisher `lib/exchange-quarter-check.js`): Das gezeigte Wachstum einer A-Aktie wird mit den Umsätzen der Börsenmeldung für dieselben zwei Zeiträume verglichen. Liegt es bei keiner Umsatzzeile innerhalb von 2 Prozentpunkten oder 5 %, fehlen Wachstum und Rule of 40, mit Grund. Banken, Versicherer, Firmen mit Handtabelle und Firmen, deren Anbieterreihe die Börsenprüfung nicht lesen kann (am 21.11. zwei Zeilen, 001236.SZ und 001246.SZ), bleiben ungeprüft und zeigen ihren Wert weiter. Der Wert auf den Sektor-Brettern bleibt unverändert (siehe offene Punkte).

**3. EBITDA-Marge unter der operativen Marge** (`ebitdaUnterBetriebsergebnis` in `scripts/write-rule40-export.js`, im Rule-of-40-Brett): EBITDA ist operatives Ergebnis plus Abschreibungen und kann nicht darunter liegen. Liegt Yahoos Marge mehr als 2 Punkte unter der operativen Marge derselben vier Quartale (gleiche Quartalsenden, Yahoos Zwölfmonatsumsatz höchstens 3 % daneben), fehlen EBITDA-Marge und r40Ebitda, und die Zeile trägt `ebitdaMarginReason`. Rang und r40 ändern sich nicht.

## Vorher/Nachher je Brett und Feld
| Ort | Feld | Zeilen mit Wert vorher | geleert | Regel |
|---|---|---|---|---|
| Filter | Börsenwert (mc) | 14.393 | 457 | 1 |
| Filter | Abstand zum 52-Wochen-Hoch (d52) | 14.593 | 457 | 1 |
| Filter | P/S (ps) | 13.921 | 380 | 1 |
| Filter | Dividendenrendite (dy) | 10.910 | 296 | 1 |
| Filter | EV/Sales (evs) | 13.019 | 284 | 1 |
| Filter | P/E (pe) | 8.873 | 24 | 1 |
| Filter | Forward P/E (fpe) | 8.048 | 3 | 1 |
| Filter | Umsatzwachstum (g) | 15.388 (davon 2.491 China) | 23 | 2 |
| Rule-of-40-Brett | EBITDA-Marge und r40Ebitda | 484 | 10 | 3 |

Von den 457 OTC-Zeilen steht keine auf einem Brett. Von den 23 China-Zeilen sind 20 Filterzeilen von Brett-Firmen (18 Finanzen, 2 Industrie), 3 davon mit Rang (601995.SS, 600150.SS, 603985.SS); ihr Wert auf dem Brett selbst bleibt. Die 10 EBITDA-Zeilen: INSW, INSM, LPG, LB, TNZ.TO, 4507.T, TNK, ZIM, 6861.T (Keyence, Yahoo liefert 0,0 %) und CENX.

Füllstände nach dem Nachspiel (Anteil unter den Zeilen, die das Feld zeigen können; Untergrenzen unverändert): mc 98,5 % (vorher 98,5 %), ps 95,1 % (95,3), evs 88,9 % (89,1), dy 72,3 % (72,8), pe 57,0 % (57,1), d52 99,8 % (99,8), g 97,4 % (97,6, Untergrenze 93,2), r40 unverändert 55,0 % (keine der 23 Zeilen hatte eine Rule of 40). Der Feed wächst von 5,93 auf 6,06 MB (Grenze 6,5 MB).

## Wie viele richtige Werte mitgeleert werden
- **Regel 1:** Für 409 der 457 Zeilen gibt es eine Notierung mit gleichem Namen, die gehandelt wird. 94 davon (23 %) lagen trotz eingefrorenem Kurs innerhalb von 5 % ihres Börsenwerts, der Median der Abweichung ist 12,7 %. Zum Vergleich weichen gehandelte OTC-Notierungen bei 18 % der Fälle mehr als 5 % ab, weil der Namensabgleich ungenau ist (Aktienklassen, ADR-Verhältnisse). Schätzung daher etwa 100 der 457 Werte, die nach der Toleranz der Stichprobe noch gepasst hätten (Sicherheit etwa 70 %). Ein Kurs, der vier Wochen und länger steht (Median 42 Handelstage), ist auch dann kein aktueller Marktpreis. Mit 40 statt 20 Tagen sänke der Anteil auf etwa 18 %, TOKSF (39 Tage seit der letzten Dividendenanpassung) wäre dann nicht mehr erfasst. Über fünf Wochen schwankt die Zahl der Fälle zwischen 372 und 489.
- **Regel 2:** Verglichen wird mit den Börsenzahlen derselben Zeiträume; ein richtiger Wert wird nur geleert, wenn der Börsenspeicher selbst falsch ist. Gegenprobe auf dem festen Prüfsatz vom 02.10.2026 (Fälle, die damals gegen die Meldungen geprüft wurden): alle 16 falschen Zeilen ohne Handtabelle sind „mixed“, alle 6 richtigen Vergleichsfälle „agree“. Geschätzt 0 bis 2 der 23 Werte richtig (Sicherheit etwa 90 %); einzeln gegen die Meldung geprüft ist nur Huatai.
- **Regel 3:** Jede getroffene Marge liegt mindestens 2 Punkte unter dem, was die Definition mindestens ergibt, bevor die Abschreibungen dazukommen. Ein richtiger Wert wird nur geleert, wenn die Quartalszahlen bei Yahoo selbst falsch sind. Geschätzt 0 bis 1 der 10 Werte (Sicherheit etwa 85 %).

## Nicht umgesetzt, mit Messung und Empfehlung
- **EBITDA-Marge zu hoch (LUNR):** 17 der 391 prüfbaren Zeilen des Rule-of-40-Bretts haben eine Marge, die mehr als 5 Punkte über operativer Marge plus Abschreibungen des letzten Geschäftsjahres liegt (unter anderem WAT, SITM, HALO, U, NOW). Bei mehreren erklärt ein Zukauf im laufenden Jahr die höheren Abschreibungen, die Regel würde also richtige Werte treffen. Empfehlung: Abschreibungen je Quartal aus der Kapitalflussrechnung mitziehen (bei SEC-Firmen `DepreciationDepletionAndAmortization`), dann wird die obere Grenze genauso beweisbar wie die untere.
- **Eigenkapitalrendite mit Minderheitsanteilen (HTWS.L):** 912 Filterzeilen haben Minderheitsanteile von mindestens 20 % des Eigenkapitals. Yahoos Wert liegt in 563 Fällen näher an der Rendite der Eigentümer und in 349 Fällen näher an der Rendite einschließlich Minderheiten; eine feste Rechenweise ist nicht erkennbar. Schon ohne Minderheiten weicht Yahoos Zwölfmonatswert bei 55 % der Zeilen um mehr als 2 Punkte von der eigenen Jahresrechnung ab (Zeitraum und Durchschnitt statt Stichtag), deshalb lässt sich mit den vorhandenen Daten nicht trennen, was falsch und was nur anders gerechnet ist. Empfehlung: Eigenkapitalrendite selbst rechnen, Gewinn der Eigentümer durch durchschnittliches Eigenkapital der Eigentümer, aus SEC und den Heimatquellen (Plan im Quellenregister `lib/source-priority.js`), und bis dahin keine Teilsperre.
- **Alle Yahoo-Fertigkennzahlen** (EBITDA-Marge, Eigenkapitalrendite, Bruttomarge; Prüfung vom 18.11.): keine Sperre, weil sie zu viele richtige Werte leeren würde. Der Hebel ist derselbe wie oben, eigene Rechnung aus den Abschlüssen.

## Offene Punkte
- Die 20 China-Firmen auf den Sektor-Brettern zeigen dort weiter das Yahoo-Wachstum (3 mit Rang). Das Brett zu ändern verschiebt Scores und ist deshalb ein Formel-Schritt mit Vorher/Nachher und Prüfung durch die andere KI; der Prüfmodus „active“ in `configs/exchange-quarter-policy.json` deckt Huatai übrigens nicht ab, weil dort kein Quartalspaar zurückgehalten wird.
- findash zeigt `ebitdaMarginReason` erst, wenn es das neue Feld liest; bis dahin ist die EBITDA-Spalte nur leer.
- Regel 1 deckt keine Hauptnotierungen mit stehendem Kurs ab (22 Zeilen mit mindestens 10 gleichen Kursen, darunter AERO.MX und 302132.SZ auf Brettern, vermutlich ausgesetzter Handel).
- Der Kursspeicher im Filter-Schritt ist der Stand des vorigen Abrufs; weil zusätzlich der Kurs der Kursmeldung gleich sein muss, wird ein Wert höchstens einen Tag zu lange zurückgehalten.
- Die strittigen Werte der Stichprobe (darunter der Börsenwert von Huatai über beide Aktienklassen) sind nicht Teil dieses Schritts.
