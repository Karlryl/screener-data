# E2 — Nebenmessung: Ist die Aktienzahl da? (Stand 2026-08-19)

**Reine Abdeckungsmessung im Entdeckungsfenster (2009-2016). Kein Signal, kein Ergebnis, keine Bewertung.** Gemessen wird ausschliesslich, ob der *Nenner* der von R10 geforderten Rechnung „Umsatz je Aktie“ in den Daten steht — nicht, was diese Rechnung ergibt.

Warum das vorher feststehen muss: R10 verlangt, dass Wachstum **je Aktie** nachgerechnet wird. Eine Firma, die ihren Umsatz verdoppelt, dafuer aber die Aktienzahl verdreifacht hat, ist fuer einen Anleger geschrumpft. Ist die Aktienzahl nicht flaechendeckend da, ist R10 in dieser Form nicht praeregistrierbar — und das gehoert **vor** die Praeregistrierung, nicht mittendrin.

## Das Ergebnis in fuenf Saetzen
- Am haeufigsten vorhanden ist `EntityCommonStockSharesOutstanding` (10.460 Firmen, 93.8 %) — aber nur 19.8 % dieser Werte haben einen Stichtag, der auf ein Quartalsende faellt. Fuer eine quartalsgenaue Rechnung ist die haeufigste Kennung damit die schlechteste.
- Brauchbar sind die Bilanz-Stichtagszahlen: `CommonStockSharesOutstanding` steht bei 9.069 Firmen (81.3 %) und deckt 62.8 % der Firmen-Quartale, mit 87.3 % passenden Stichtagen.
- Verwaessert (89.455 Firmen-Quartale) ist knapp duenner belegt als unverwaessert (96.757), Unterschied 7.5 % — beide aber deutlich duenner als die Stichtagszahlen.
- Die entscheidende Zahl: von den 487 Firmen mit reifem Erst-Ereignis haben 407 (83.6 %) eine Stichtags-Aktienzahl im Ereignisquartal UND in allen vier Folgequartalen. Mit Periodendurchschnitten waeren es nur 55 (11.3 %).
- Die Aktienzahl bewegt sich, und zwar deutlich: in 39.7 % aller gemessenen Firmenjahre aendert sie sich um mehr als 5 %, in 23.7 % um mehr als 20 % (Median je Firmenjahr: 2.5 %). Ueber das ganze Fenster trifft es 55.9 % der Firmen mindestens einmal. R10 ist also keine Division durch eine Konstante.
- Ein Namenswechsel wie beim Umsatz liegt **nicht** vor — keine Kennung verschwindet oder taucht neu auf. Wohl aber lohnt die Familie: alle drei Stichtags-Kennungen zusammen decken 20.8 % mehr Firmen-Quartale als die beste einzelne.

## 1. Welche Kennungen tragen ueberhaupt eine Aktienzahl?

Gesucht wurde **nicht nach Namen**, sondern nach der *Einheit*: jede Zeile, deren Messgroesse „shares“ (Stueck) ist. Das findet auch, was eine Namensliste uebersehen haette.

- Zeilen mit Einheit „shares“: **3.984.536**
- verschiedene Kennungen davon in der **amtlichen** Taxonomie (dem gemeinsamen Begriffskatalog der US-Boersenaufsicht, in dem alle Firmen dasselbe Wort fuer dieselbe Sache benutzen): **358**
- verschiedene **firmeneigene** Kennungen (jede Firma erfindet ihren eigenen Namen — nicht vergleichbar): **78.878** in 444.935 Zeilen

Die haeufigsten amtlichen Kennungen mit Einheit „shares“ (Top 25):

| Kennung | Zeilen | in der Auswahl? |
|---|---:|---|
| `WeightedAverageNumberOfSharesOutstandingBasic` | 350.227 | **ja** |
| `WeightedAverageNumberOfDilutedSharesOutstanding` | 328.876 | **ja** |
| `CommonStockSharesAuthorized` | 296.986 | nein — genehmigtes Kapital — Obergrenze aus der Satzung, keine existierende Aktie |
| `CommonStockSharesIssued` | 290.853 | **ja** |
| `CommonStockSharesOutstanding` | 260.920 | **ja** |
| `PreferredStockSharesAuthorized` | 182.398 | nein — Vorzugsaktien — anderer Aktientyp, nicht der Nenner von 'Umsatz je Aktie' |
| `EntityCommonStockSharesOutstanding` | 163.492 | **ja** |
| `PreferredStockSharesIssued` | 148.734 | nein — Vorzugsaktien — anderer Aktientyp, nicht der Nenner von 'Umsatz je Aktie' |
| `AntidilutiveSecuritiesExcludedFromComputationOfEarningsPerShareAmount` | 142.717 | nein — ausdruecklich NICHT eingerechnete Rechte — das Gegenteil einer Aktienzahl |
| `WeightedAverageNumberOfShareOutstandingBasicAndDiluted` | 135.473 | **ja** |
| `PreferredStockSharesOutstanding` | 128.086 | nein — Vorzugsaktien — anderer Aktientyp, nicht der Nenner von 'Umsatz je Aktie' |
| `IncrementalCommonSharesAttributableToShareBasedPaymentArrangements` | 96.688 | nein — Verwaesserungs-Zuschlag — Bestandteil der verwaesserten Zahl, nicht sie selbst |
| `ShareBasedCompensationArrangementByShareBasedPaymentAwardOptionsOutstandingNumber` | 92.566 | nein — Optionsprogramme — Bestand an Rechten, keine Aktien |
| `TreasuryStockShares` | 91.014 | nein — eigene Aktien — Abzugsposten, keine umlaufende Aktie |
| `WeightedAverageNumberDilutedSharesOutstandingAdjustment` | 69.329 | nein — Ueberleitungsposten von unverwaessert nach verwaessert, kein Bestand |
| `StockIssuedDuringPeriodSharesStockOptionsExercised` | 53.586 | nein — Bewegung innerhalb der Periode, kein Bestand |
| `ShareBasedCompensationArrangementByShareBasedPaymentAwardOptionsGrantsInPeriodGross` | 38.640 | nein — Optionsprogramme — Bestand an Rechten, keine Aktien |
| `ShareBasedCompensationArrangementByShareBasedPaymentAwardOptionsExercisableNumber` | 36.873 | nein — Optionsprogramme — Bestand an Rechten, keine Aktien |
| `ShareBasedCompensationArrangementByShareBasedPaymentAwardOptionsForfeituresInPeriod` | 28.270 | nein — Optionsprogramme — Bestand an Rechten, keine Aktien |
| `ShareBasedCompensationArrangementByShareBasedPaymentAwardEquityInstrumentsOtherThanOptionsNonvestedNumber` | 25.332 | nein — Optionsprogramme — Bestand an Rechten, keine Aktien |
| `ShareBasedCompensationArrangementByShareBasedPaymentAwardOptionsGrantsInPeriod` | 23.611 | nein — Optionsprogramme — Bestand an Rechten, keine Aktien |
| `StockIssuedDuringPeriodSharesNewIssues` | 23.259 | nein — Bewegung innerhalb der Periode, kein Bestand |
| `TreasuryStockSharesAcquired` | 20.842 | nein — eigene Aktien — Abzugsposten, keine umlaufende Aktie |
| `IncrementalCommonSharesAttributableToCallOptionsAndWarrants` | 19.210 | nein — Verwaesserungs-Zuschlag — Bestandteil der verwaesserten Zahl, nicht sie selbst |
| `ShareBasedCompensationArrangementByShareBasedPaymentAwardEquityInstrumentsOtherThanOptionsGrantsInPeriod` | 17.253 | nein — Optionsprogramme — Bestand an Rechten, keine Aktien |

**Geprueft und verworfen** (steht hier, damit „nicht dabei“ nicht wie „uebersehen“ aussieht):

- `CommonStockSharesAuthorized…` — genehmigtes Kapital — Obergrenze aus der Satzung, keine existierende Aktie
- `PreferredStockShares…` — Vorzugsaktien — anderer Aktientyp, nicht der Nenner von 'Umsatz je Aktie'
- `TreasuryStockShares…` — eigene Aktien — Abzugsposten, keine umlaufende Aktie
- `AntidilutiveSecuritiesExcludedFromComputationOfEarningsPerShareAmount…` — ausdruecklich NICHT eingerechnete Rechte — das Gegenteil einer Aktienzahl
- `ShareBasedCompensationArrangement…` — Optionsprogramme — Bestand an Rechten, keine Aktien
- `StockIssuedDuringPeriodShares…` — Bewegung innerhalb der Periode, kein Bestand
- `IncrementalCommonSharesAttributable…` — Verwaesserungs-Zuschlag — Bestandteil der verwaesserten Zahl, nicht sie selbst
- `WeightedAverageNumberDilutedSharesOutstandingAdjustment…` — Ueberleitungsposten von unverwaessert nach verwaessert, kein Bestand

## 2. Wie gut ist jede Kennung belegt?

Zwei Nenner, bewusst getrennt ausgewiesen. **Firmen**: von allen 11.156 Firmen, die im Entdeckungsfenster ueberhaupt einen regelmaessigen Bericht eingereicht haben. **Firmen-Quartale**: von allen 200.795 Kombinationen aus Firma und Kalenderquartal, fuer die ein Bericht vorliegt. Der zweite Nenner ist der strengere und der ehrlichere — eine Firma „hat“ die Kennung schon, wenn sie sie ein einziges Mal meldet.

| Kennung | was sie misst | Firmen | Anteil | Firmen-Quartale | Anteil | Stichtag auf einem Quartalsende |
|---|---|---:|---:|---:|---:|---:|
| `CommonStockSharesOutstanding` | Stammaktien im Umlauf zum Bilanzstichtag | 9.069 | 81.3 % | 126.098 | 62.8 % | 87.3 % |
| `CommonStockSharesIssued` | ausgegebene Stammaktien zum Bilanzstichtag (inkl. zurueckgekaufter) | 9.617 | 86.2 % | 140.333 | 69.9 % | 86.5 % |
| `EntityCommonStockSharesOutstanding` | Deckblatt-Angabe der Einreichung (dei), Stichtag nahe am Einreichungstag | 10.460 | 93.8 % | 142.284 | 70.9 % | 19.8 % |
| `WeightedAverageNumberOfSharesOutstandingBasic` | unverwaesserter Periodendurchschnitt (Nenner des einfachen Ergebnisses je Aktie) | 7.125 | 63.9 % | 96.757 | 48.2 % | 88.6 % |
| `WeightedAverageNumberOfDilutedSharesOutstanding` | verwaesserter Periodendurchschnitt (inkl. Optionen, Wandelanleihen, Warrants) | 6.360 | 57.0 % | 89.455 | 44.6 % | 89.5 % |
| `WeightedAverageNumberOfShareOutstandingBasicAndDiluted` | Periodendurchschnitt, wenn unverwaessert und verwaessert identisch sind | 4.365 | 39.1 % | 41.150 | 20.5 % | 85.4 % |

**Die letzte Spalte ist die Falle dieser Messung.** Eine Aktienzahl nuetzt nur, wenn ihr Stichtag zum Quartal passt, auf das sie bezogen werden soll. `EntityCommonStockSharesOutstanding` steht auf dem Deckblatt jeder Einreichung und ist deshalb die am **haeufigsten** vorhandene Zahl — aber ihr Stichtag ist der Tag der Einreichung, also typisch vier bis acht Wochen **nach** dem Quartalsende. Sie ist reichlich da und fuer eine quartalsgenaue Rechnung trotzdem fast unbrauchbar. Genau das zeigt Abschnitt 4.

*Stichtagszahlen* (`CommonStock…`, `Entity…`) sind eine Zahl zum Bilanzstichtag. *Periodendurchschnitte* (`WeightedAverage…`) mitteln ueber den Zeitraum — sie sind der rechnerisch richtige Nenner unter einer Zeitraumgroesse wie dem Umsatz, aber sie existieren nur dort, wo die Firma die Periode auch einzeln ausweist.

## 3. Stabil ueber die Jahre — oder Namenswechsel?

Beim Umsatz ist dieser Bruch belegt: die Kennung wechselt ueber die Jahre den Namen, und eine Abfrage auf nur einen Namen misst den Wechsel als Datenluecke. Deshalb hier ausdruecklich geprueft.

Firmen mit mindestens einem Quartalswert, je Kalenderjahr — **als Anteil an allen Firmen, die in diesem Jahr ueberhaupt einen Bericht abgegeben haben**. Die rohe Firmenzahl faellt in jeder Zeile, weil das Entdeckungsfenster am 31.12.2016 endet: ein Bilanzstichtag aus dem vierten Quartal 2016 wird erst 2017 eingereicht und faellt damit heraus. Erst der Anteil zeigt, ob eine Kennung **verschwindet** oder ob nur das Fenster zu Ende ist.

| Kennung | 2012 | 2013 | 2014 | 2015 | 2016 |
|---|---:|---:|---:|---:|---:|
| *Bezugsgroesse: Firmen mit Bericht* | 8.461 | 8.090 | 7.932 | 7.637 | 6.691 |
| `CommonStockSharesOutstanding` | 6.887 (81.4 %) | 6.656 (82.3 %) | 6.521 (82.2 %) | 6.132 (80.3 %) | 4.916 (73.5 %) |
| `CommonStockSharesIssued` | 7.439 (87.9 %) | 7.196 (88.9 %) | 6.979 (88.0 %) | 6.555 (85.8 %) | 5.301 (79.2 %) |
| `EntityCommonStockSharesOutstanding` | 7.863 (92.9 %) | 7.466 (92.3 %) | 7.295 (92.0 %) | 7.047 (92.3 %) | 6.283 (93.9 %) |
| `WeightedAverageNumberOfSharesOutstandingBasic` | 5.404 (63.9 %) | 5.195 (64.2 %) | 4.981 (62.8 %) | 4.708 (61.6 %) | 4.039 (60.4 %) |
| `WeightedAverageNumberOfDilutedSharesOutstanding` | 4.891 (57.8 %) | 4.729 (58.5 %) | 4.576 (57.7 %) | 4.388 (57.5 %) | 3.823 (57.1 %) |
| `WeightedAverageNumberOfShareOutstandingBasicAndDiluted` | 2.772 (32.8 %) | 3.127 (38.7 %) | 3.213 (40.5 %) | 3.038 (39.8 %) | 2.429 (36.3 %) |

**Familie „Stichtag“** (`CommonStockSharesOutstanding`, `CommonStockSharesIssued`, `EntityCommonStockSharesOutstanding`): 10.590 Firmen insgesamt, davon 9.884 (93.3 %) mit mehr als einer Kennung im Fenster. Die beste Einzelkennung (`EntityCommonStockSharesOutstanding`) deckt 142.284 Firmen-Quartale, alle drei zusammen 171.817 — ein Zugewinn von 20.8 %.

**Familie „Periodendurchschnitt“** (`WeightedAverageNumberOfSharesOutstandingBasic`, `WeightedAverageNumberOfDilutedSharesOutstanding`, `WeightedAverageNumberOfShareOutstandingBasicAndDiluted`): 9.236 Firmen insgesamt, davon 6.714 (72.7 %) mit mehr als einer Kennung im Fenster. Die beste Einzelkennung (`WeightedAverageNumberOfSharesOutstandingBasic`) deckt 96.757 Firmen-Quartale, alle drei zusammen 132.584 — ein Zugewinn von 37.0 %.

## 4. Die entscheidende Zahl: die 487 Firmen aus E2

Die Firmenliste steht **nicht** im E2-Report — dort steht nur die Zahl 487. Sie wurde deshalb rekonstruiert, indem der **Originalcode** von E2 (`scripts/studie-basisraten.py`) als Bibliothek gerufen wurde, Schritt fuer Schritt in derselben Reihenfolge. Dass es dieselben Firmen sind, ist an vier Zahlen geankert: der Kalibrierungsweg liefert bei P 90 exakt 1.979 Feuerungen und 1.025 reife Firmen, bei P 95 exakt 877 und 487 — identisch mit dem veroeffentlichten E2-Report. Weicht eine dieser Zahlen ab, **haelt der Lauf an**, statt eine andere Grundgesamtheit als „die 487“ auszugeben.

Drei Stufen, absteigend streng — weil „hat eine Aktienzahl“ und „hat sie dort, wo R10 sie braucht“ zwei verschiedene Dinge sind:

| Kennung | (a) irgendein Wert | (b) **jedes** Quartal der Umsatzreihe | (c) Ereignisquartal + 4 Folgequartale | Median-Abdeckung der Umsatzquartale |
|---|---:|---:|---:|---:|
| `CommonStockSharesOutstanding` | 425 (87.3 %) | 25 (5.1 %) | 358 (73.5 %) | 85.7 % |
| `CommonStockSharesIssued` | 443 (91.0 %) | 27 (5.5 %) | 378 (77.6 %) | 87.0 % |
| `EntityCommonStockSharesOutstanding` | 466 (95.7 %) | 0 (0.0 %) | 9 (1.8 %) | 8.0 % |
| `WeightedAverageNumberOfSharesOutstandingBasic` | 363 (74.5 %) | 12 (2.5 %) | 29 (6.0 %) | 42.9 % |
| `WeightedAverageNumberOfDilutedSharesOutstanding` | 335 (68.8 %) | 11 (2.3 %) | 32 (6.6 %) | 34.6 % |
| `WeightedAverageNumberOfShareOutstandingBasicAndDiluted` | 312 (64.1 %) | 1 (0.2 %) | 20 (4.1 %) | 35.7 % |
| **alle Stichtags-Kennungen zusammen** | — | 29 (6.0 %) | 407 (83.6 %) | — |
| **alle Durchschnitts-Kennungen zusammen** | — | 24 (4.9 %) | 55 (11.3 %) | — |


## 5. Bewegt sich die Aktienzahl ueberhaupt?

Wenn nicht, waere R10 teuer und wirkungslos: eine Division durch eine Konstante aendert keine Rangfolge. Verglichen werden Stichtage im Abstand von 330 bis 380 Kalendertagen (dasselbe Jahresfenster, das E2 benutzt); je Firma zaehlt die **groesste** Veraenderung, nicht der Durchschnitt.

**Zwei Lesarten, bewusst nebeneinander.** *Je Firma* heisst: hat sich die Aktienzahl **mindestens einmal** im ganzen Fenster so stark bewegt? *Je Firmenjahr* heisst: wie oft passiert das in einem **beliebigen einzelnen Jahr**? Die erste Zahl ist zwangslaeufig groesser — acht Jahre bieten acht Gelegenheiten. Wer nur sie berichtet, laesst acht Jahre wie ein Jahr aussehen.

| Kennung | messbare Firmen | Jahrespaare | Median je Firma (Maximum) | Median je Firmenjahr | ueber 5 % (Firmen / Firmenjahre) | ueber 20 % | ueber 50 % | Rueckgang | Split-Verdacht |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `CommonStockSharesOutstanding` | 8.082 | 92.794 | 31.0 % | 2.5 % | 73.6 % / 39.7 % | 55.9 % / 23.7 % | 44.0 % / 15.4 % | 1.552 | 786 (9.7 %) |
| `CommonStockSharesIssued` | 8.631 | 104.942 | 32.5 % | 1.8 % | 71.1 % / 36.6 % | 56.3 % / 22.8 % | 45.1 % / 15.0 % | 1.262 | 840 (9.7 %) |
| `EntityCommonStockSharesOutstanding` | 8.777 | 105.374 | 16.5 % | 2.1 % | 68.7 % / 35.4 % | 47.1 % / 19.0 % | 34.1 % / 11.4 % | 2.122 | 792 (9.0 %) |
| `WeightedAverageNumberOfSharesOutstandingBasic` | 7.020 | 76.040 | 19.8 % | 2.1 % | 73.1 % / 33.1 % | 49.8 % / 16.0 % | 36.6 % / 9.9 % | 1.464 | 458 (6.5 %) |
| `WeightedAverageNumberOfDilutedSharesOutstanding` | 6.280 | 70.942 | 20.8 % | 2.3 % | 76.8 % / 34.0 % | 50.9 % / 15.4 % | 36.1 % / 9.3 % | 1.488 | 430 (6.8 %) |
| `WeightedAverageNumberOfShareOutstandingBasicAndDiluted` | 4.241 | 29.111 | 50.6 % | 9.0 % | 76.1 % / 56.7 % | 63.0 % / 39.3 % | 50.1 % / 25.6 % | 489 | 415 (9.8 %) |

**Grenze dieser Messung (R5):** ein *Aktiensplit* (die Firma teilt jede Aktie in mehrere, ohne dass sich am Besitz etwas aendert) verdoppelt die Aktienzahl, ohne dass ein Anleger verwaessert wird. Aus dieser Datenquelle allein ist beides **nicht** zu unterscheiden. Die Spalte „Split-Verdacht“ zaehlt die Faelle, deren Verhaeltnis auf ein Prozent genau einem gaengigen Splitverhaeltnis entspricht — das ist eine **Untergrenze** der Ueberschneidung, keine Korrektur.

## 6. Verwaessert oder unverwaessert?

*Unverwaessert* zaehlt die Aktien, die es gibt. *Verwaessert* zaehlt zusaetzlich die Aktien, die es geben wird, wenn alle Optionen, Wandelanleihen und Bezugsrechte eingeloest werden. Fuer die Frage „kommt das Wachstum beim Anleger an?“ ist die verwaesserte Zahl die haertere und damit richtige.

- **Belegung, unverwaessert gegen verwaessert:** unverwaessert 96.757 Firmen-Quartale (48.2 %), verwaessert 89.455 (44.6 %). Die unverwaesserte Zahl ist also um 7.5 % besser belegt — ein kleiner Vorsprung. Dazu kommen 41.150 Firmen-Quartale in der gemeinsamen Kennung `WeightedAverageNumberOfShareOutstandingBasicAndDiluted`, die Firmen benutzen, wenn beide Zahlen gleich sind — typisch bei Verlustfirmen, wo Optionen nicht eingerechnet werden duerfen. Wer diese dritte Kennung vergisst, verliert ausgerechnet die verlustschreibenden Wachstumsfirmen.
- **Der Befund, der die Rangfolge umdreht:** fuer das Fenster, auf das es ankommt (Ereignisquartal plus vier Folgequartale bei den 487 Firmen), liefert der verwaesserte Durchschnitt 6.6 % Abdeckung, der unverwaesserte 6.0 %, alle Durchschnitts-Kennungen zusammen 11.3 %. Die Stichtagszahlen kommen im selben Fenster auf 83.6 %. Der rechnerisch sauberere Nenner ist hier also der, den es fast nie gibt.
- **Der Grund ist Bauart, nicht Datenqualitaet:** E2 leitet den Umsatz des vierten Quartals aus dem Geschaeftsjahr minus den drei Vorquartalen ab. Bei einem *Durchschnitt* geht diese Subtraktion nicht (ein Durchschnitt ist nicht addierbar). Fuer jedes so abgeleitete Quartal existiert deshalb gar kein Durchschnitts-Nenner — und Firmen, die ohnehin nur Jahreswerte melden, haben nie einen.
- **Empfehlung — primaer die Stichtagszahl:** `CommonStockSharesOutstanding` (126.098 Firmen-Quartale, 87.3 % passende Stichtage), und wo sie fehlt `CommonStockSharesIssued` — mit **protokollierter Herkunft je Wert**, nicht als stille Mischung. Der Unterschied zwischen beiden sind die zurueckgekauften eigenen Aktien: 'issued' ist immer groesser oder gleich 'outstanding', der Fehler geht also **in eine bekannte Richtung** (die Je-Aktie-Groesse wird zu klein, also zu vorsichtig).
- **Empfehlung — verwaessert als Zweitrechnung:** die verwaesserte Zahl ist die haertere Pruefung (sie zaehlt die Ansprueche mit, die dem Altaktionaer noch bevorstehen) und bleibt deshalb im Vertrag — aber als **Sensitivitaets-Rechnung auf der Teilmenge, wo sie existiert**, nicht als Hauptnenner. Innerhalb der Durchschnitts-Familie ist verwaessert der Vorzug, zusammen mit der gemeinsamen Kennung fuer die Verlustfirmen.
- **Ausdruecklich nicht verwenden:** `EntityCommonStockSharesOutstanding`. Sie ist die am besten belegte Kennung ueberhaupt und trotzdem falsch fuer diesen Zweck — ihr Stichtag ist der Einreichungstag, nicht das Quartalsende. Wer nach Belegungsquote auswaehlt, greift genau daneben.

## Ist R10 in dieser Form praeregistrierbar?

**JA, MIT AUFLAGEN — praeregistrierbar, aber die Abdeckungsquote gehoert als Pflichtangabe in jeden Report, und die fehlenden Firmen brauchen Unsicherheits-Schranken nach R11.**

- Der Nenner ist da, wo er gebraucht wird: 407 von 487 Firmen (83.6 %) tragen eine Stichtags-Aktienzahl im Ereignisquartal und in allen vier Folgequartalen.
- Mit Periodendurchschnitten waeren es nur 55 (11.3 %). Der rechnerisch sauberere Nenner ist also der, den es fast nie gibt — die Praeregistrierung muss den Stichtags-Nenner benennen und den Durchschnitt als Sensitivitaets-Rechnung fuehren, nicht umgekehrt.
- Die Rechnung ist nicht wirkungslos: in 39.7 % aller gemessenen Firmenjahre aendert sich die Aktienzahl um mehr als 5 %.
- Offene Auflage: Aktiensplits sind aus dieser Quelle nicht von echter Verwaesserung zu trennen (9.7 % der Firmen mit Split-Verdacht). Das gehoert als Vorbehalt in die Praeregistrierung — genauso wie R10 den Zukauf-Waechter offen als nicht berechenbar fuehrt.

## Nicht berechenbar — mit Grund (R5)

| Zaehler | Wert |
|---|---:|
| `berichte_gesamt` | 176.502 |
| `berichte_nicht_periodisch` | 5.892 |
| `berichte_periodisch` | 170.610 |
| `kandidaten_zeilen` | 1.532.109 |
| `shares_kennungen_firmeneigen` | 78.878 |
| `shares_kennungen_standard` | 358 |
| `shares_zeilen` | 3.984.536 |
| `shares_zeilen_firmeneigen` | 444.935 |
| `shares_zeilen_standard` | 3.539.601 |
| `verworfen_coreg` | 21.158 |
| `verworfen_firmeneigene_taxonomie` | 2.265 |
| `verworfen_nicht_periodisch` | 53.909 |
| `verworfen_wert_leer` | 2.558 |
| `verworfen_wert_nicht_positiv` | 6.592 |
| `werte_fassungskonflikt` | 65.135 |
| `werte_pit` | 877.504 |
| `werte_spaetere_fassung` | 568.123 |

## Woran das geprueft ist

- **Selbsttest** gegen eine selbstgebaute Mini-Datenbank mit von Hand nachgerechneten Erwartungswerten, 10 Pruefungen: `python scripts/studie-panel-aktienzahl.py --selbsttest`
- **Gegenprobe**: jede dieser Pruefungen wird einmal absichtlich kaputtgemacht — kaputtgemacht wird die *Sache*, die sie schuetzt, nicht die Pruefung selbst — und muss rot werden. Bleibt eine gruen, ist sie wirkungslos und der Lauf meldet das: `python scripts/studie-panel-aktienzahl.py --gegenprobe`
- **Fenster-Mauer**: geoeffnet wird ausschliesslich `panel-entdeckung.sqlite`, schreibgeschuetzt. Geprueft wird der *aufgeloeste* Pfad, nicht der geschriebene — eine harmlos benannte Verzeichnis-Verknuepfung in Richtung Endtest wird abgewiesen. Der Endtest wurde nie geoeffnet, nie entschluesselt, nie gezaehlt.
- **Plausibilitaetsanker** gegen die Vor-Etappen (unten). Ein Anker, der Abweichungen schluckt, waere keiner: eine Abweichung von einer einzigen Firma haelt den Lauf an.

## Plausibilitaetsanker

- Firmen im Entdeckungsfenster (E1): erwartet 11.156, gemessen 11.156 — **stimmt**
- reife Erst-Ereignisse S-U (E2): erwartet 487, gemessen 487 — **stimmt**

## Neue Fragen und Hypothesen (R16)

- Aktiensplits sind aus den SEC-Daten allein nicht von Verwaesserung zu trennen. Gibt es eine gratis verfuegbare Split-Historie (R17: erst gratis suchen, dann Geldfrage), oder wird der Vorbehalt offen praeregistriert? (Zeitschaetzung: 0,5 Tage Suche)
- Der Periodendurchschnitt fehlt genau dort, wo E2 das vierte Quartal ableitet. Soll die Je-Aktie-Rechnung durchgehend auf Stichtagszahlen laufen (einheitlich, aber rechnerisch unsauber) oder gemischt mit protokollierter Herkunft je Wert? Das beruehrt die Rechenvorschrift und gehoert vor die Praeregistrierung. (Zeitschaetzung: 0,5 Tage)
- Zwischen `CommonStockSharesIssued` und `CommonStockSharesOutstanding` liegen genau die zurueckgekauften eigenen Aktien, und `TreasuryStockShares` steht mit 91.014 Zeilen im Panel. Laesst sich die Luecke damit schliessen, statt sie als Herkunfts-Vermerk mitzuschleppen? (Zeitschaetzung: 0,5 Tage)
- R10 nennt den Zukauf-Waechter ausdruecklich als nicht berechenbar. Traegt das Panel eine Kennung fuer den Akquisitions-Umsatzbeitrag (z. B. `BusinessAcquisitionsProFormaRevenue`), und wie duenn ist sie? Dieselbe Messung, anderer Nenner. (Zeitschaetzung: 0,5 Tage)

---

Lauf: 2026-08-19T09:57:07Z · gelesene Dateien: `panel/panel-entdeckung.sqlite` · Ergebnisdaten (Kurse, Renditen) beruehrt: **nein**
