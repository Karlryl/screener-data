# E2 — Basisraten der Beschleunigungs-Signale

Stand 2026-08-19. Gelesen wurde **ausschließlich** das Entdeckungsfenster (2009-01-01 bis 2016-12-31). Prüffenster und Endtest-Fenster wurden **nicht geöffnet, nicht entschlüsselt und nicht gezählt** — der Endtest bleibt bis zum Ende der Studie verschlossen.

*Fachwörter werden bei der ersten Verwendung in einem Halbsatz übersetzt.*

**Lauf-Flag (R4): Ergebnisdaten berührt = NEIN.** Es wurde keine Kurs-, Rendite- oder Ergebnisdatei geöffnet. Was dieser Lauf wirklich angefasst hat (Verzeichnis und Dateiname):

- gelesen: `e2-selbsttest-pd5d9p5a/panel-entdeckung.sqlite`
- gelesen: `leer/panel-entdeckung.sqlite`
- gelesen: `panel/panel-entdeckung.sqlite`
- geschrieben: `e2-selbsttest-pd5d9p5a/zwischen.sqlite` (Arbeitsdatei für die Wiederaufnahme)
- geschrieben: `leer/zwischen.sqlite` (Arbeitsdatei für die Wiederaufnahme)
- geschrieben: `arbeit/E2-zwischenstand.sqlite` (Arbeitsdatei für die Wiederaufnahme)

Läuft im selben Aufruf zuerst der Selbsttest, taucht hier zusätzlich dessen Fixture-Datenbank auf — sie heißt absichtlich genauso wie das Panel und liegt in einem Temp-Verzeichnis. Am Verzeichnisnamen ist sie eindeutig zu unterscheiden.

## Kurz gefasst

- **S-U** (Umsatz-Beschleunigung) feuert im Zielzeitraum 2012–2016 in **925** Firmen-Quartalen von **65.809** auswertbaren — Feuerrate **1,41 %**. Reifes Erst-Ereignis bei **512 Firmen**.
- **S-G** (Beschleunigung des Betriebsergebnisses) feuert in **873** von **82.642** — Rate **1,06 %**, reifes Erst-Ereignis bei **546 Firmen**.
- **S-UG** (beides im selben Fiskalquartal) feuert in **43** von **54.292** — Rate **0,08 %**, reifes Erst-Ereignis bei **29 Firmen**.

**Vorab festgelegte Scheiternskriterien, die gegriffen haben:**
- S-UG — K1: nur 29 Firmen mit reifem Erst-Ereignis (gefordert 300)
- S-UG — K3a: 51.2 % aller Feuerungen im Bereich Verarbeitendes Gewerbe

**Geändert gegenüber dem ersten Stand vom selben Tag:** die Umsatz-Quelle wird jetzt **je Firma festgelegt** statt je Quartal — die vorab festgelegte Folgeregel aus Prüfschritt 3 hat gegriffen. Beide Stände stehen nebeneinander in **Abschnitt 2**; der alte ist nicht gelöscht. **S-UG wird nicht weiterverfolgt** und liegt mit Begründung im Muster-Friedhof (Abschnitt 4).

Plausibilitätsanker gegen den E1-Report: Firmen mit einer ununterbrochenen Kette von mindestens 8 Berichtsquartalen — hier gezählt **7.973**, laut E1 **7.973** → stimmt.

## 1. Was hier eigentlich gemessen wird

Ein **Signal** ist hier kein Kaufsignal, sondern nur ein Datum, an dem ein vorab festgelegtes Muster in den veröffentlichten Zahlen einer Firma auftritt. Ob daraus je etwas folgt, ist Gegenstand späterer Etappen — diese Etappe misst ausschließlich, **wie oft** das Muster überhaupt vorkommt und **wie viele Firmen** es tragen.

- **Wachstum g(t)**: Umsatz des Quartals gegen dasselbe Quartal des Vorjahres, geteilt durch den Mittelwert beider Beträge (*symmetrisch* — so bleibt die Zahl auch dann endlich, wenn das Vorjahr nahe null lag). Begrenzt auf ±2.
- **Beschleunigung a(t)**: g(t) minus g des Vorquartals. Positiv heißt: das Wachstum wird schneller, nicht bloß, dass es Wachstum gibt.
- **Schwelle θ(q)**: das **Trailing-Perzentil** — der Wert, den nur die obersten X % aller Firmen im *bereits veröffentlichten* Rückblick (Kalenderquartale q−5 bis q−2) überschritten haben. Damit kennt die Schwelle zum Signalzeitpunkt keine Zukunft.
- **Feuerung**: ein Firmen-Quartal, in dem alle drei Bedingungen gelten — zwei Beschleunigungsquartale hintereinander, a(t) über der Schwelle, und g(t) > 0 (echtes Wachstum, kein langsameres Schrumpfen).
- **Reifes Erst-Ereignis**: die **erste** Feuerung einer Firma, gefolgt von mindestens 4 weiteren Quartalen mit auswertbarem Wert derselben Quelle. Nur *Existenz* geprüft — es wurde kein einziger Ergebniswert berechnet.

**Feuerungen und Fallzahl sind zwei verschiedene Dinge und werden hier getrennt berichtet.** Die Feuerungen sagen, wie dicht die Ereignisse liegen; die Fallzahl sagt, wie viele *Firmen* eine spätere Auswertung überhaupt tragen könnten. Wer nur eine der beiden nennt, verwechselt später Dichte mit Stichprobe.

### Die Umsatz-Abbildungsschicht (eingefroren)

Der Umsatz heißt in den SEC-Daten nicht durchgehend gleich. Vier Quellen kommen in Frage, in dieser festen Priorität:

1. `Revenues`
2. `RevenueFromContractWithCustomerExcludingAssessedTax`
3. `SalesRevenueNet`
4. `SalesRevenueGoodsNet+SalesRevenueServicesNet` (Summe beider Komponenten, nur wenn beide in beiden Perioden vorliegen)

`RevenueFromContractWithCustomerIncludingAssessedTax` bleibt bewusst draußen — diese Kennung enthält durchlaufende Steuern und liegt damit auf einem anderen Niveau.

**Die zentrale Regel:** verglichen wird **nie über Quellen hinweg**. Seit der Umstellung (Abschnitt 2) wird die Quelle nicht mehr je Firmen-Quartal gewählt, sondern **je Firma festgelegt** — und zwar mit dem Wissensstand des Signalzeitpunkts: es gilt die dann längste auswertbare Serie. Die ganze Rechenkette eines Signals stammt aus dieser einen Serie. Damit kann eine **Quellen-Naht** gar nicht mehr entstehen; der Zähler steht konstruktiv bei 0 Fällen (vorher 2.663). Bei Gleichstand entscheidet die Priorität, dann USD, dann die Einheit alphabetisch.

Im Entdeckungsfenster ist Priorität 2 (`RevenueFromContractWithCustomerExcludingAssessedTax`) **leer**: die Kennung wurde erst ab 2018 verwendet. Für dieses Fenster tragen also nur die Prioritäten 1, 3 und 4.

## 2. Die Quellenwahl ist umgestellt — beide Stände stehen hier

**Was ausgelöst hat.** Prüfschritt 3 des vorigen Laufs hat eine **vorab festgelegte** Schwelle gerissen: 15,51 % der Firmen-Quartale mit mehreren verfügbaren Umsatz-Quellen weichen um mehr als 5 Punkte voneinander ab — erlaubt waren 10 %. Die dort präregistrierte Folgeregel lautet dann: **Quelle je Firma fixieren (längste Serie) statt je Quartal.** Der vorige Lauf hat sie noch nicht angewandt, dieser Lauf wendet sie an. Eine vorab festgelegte Wenn-Dann-Regel, deren Auslöser die Messung zeigt, ist keine nachträgliche Änderung — sie **ist** die Vorschrift.

**Was ergänzt werden musste.** „Längste Serie" allein ist nicht ausführbar. Verbindlich festgelegt wurde:

1. **Gleichstand** wird deterministisch aufgelöst, in dieser Reihenfolge: längste Serie → Prioritätsrang der Quelle → USD → Einheit alphabetisch.
2. **Maßgeblich ist der Stand zum Signalzeitpunkt t**, also nur, was bis dahin veröffentlicht war. Die gesamte Rechenkette eines Signals — Wachstum, Vorjahresquartal, Vorquartal, zweite Beschleunigung — stammt aus **dieser einen** Serie.
3. **Länge** heißt: Zahl der bis t auswertbaren Quartale dieser Quelle. Nicht die längste lückenlose Folge — gebraucht wird die verfügbare Historie, aus der die Partner-Quartale kommen, und die zählt auch mit einem Loch in der Mitte.

**Warum nicht die naheliegende Fenster-Fassung.** Man könnte fragen: welche Quelle hat über das **ganze** Fenster die längste Serie? Diese Fassung wählt die Quelle **mit Wissen über das Fensterende** — ein Selektions-Vorgriff genau der Sorte, die diese Studie überall sonst verbietet. Außerdem wäre sie in der laufenden Vorwärts-Aufzeichnung gar nicht berechenbar, und die Verfassung verlangt Live-Berechenbarkeit (R11). Sie taugt als Plausibilitätsanker, nie als Rechenvorschrift.

| Größe | alter Stand (je Quartal) | Fenster-Fassung (nur Anker) | **neuer Stand (je Firma, zeitpunkt-ehrlich)** |
|---|---:|---:|---:|
| S-U Feuerungen 2012–2016 | 877 | 911 | **925** |
| S-U auswertbare Firmen-Quartale | 63.033 | 65.420 | **65.809** |
| S-U Feuerrate | 1,39 % | 1,39 % | **1,41 %** |
| S-U Firmen mit reifem Erst-Ereignis | 487 | 512 | **512** |
| S-G Feuerungen | 872 | 872 | **873** |
| S-G Firmen mit reifem Erst-Ereignis | 545 | 546 | **546** |
| S-UG Feuerungen | 41 | 41 | **43** |
| S-UG Firmen mit reifem Erst-Ereignis | 27 | 28 | **29** |
| **Quellen-Naht-Ausfälle** | 2.663 | 0 | **0** |
| Naht-Invariante (gefordert 0) | 0 | 0 | **0** |
| Belegungs-Glätte, größter Sprung | 1,75 | 2,08 | **1,80** |
| Perzentil P am Ende der Kalibrierung | 95 | — | **95** |

**Wie das zu lesen ist.** Die mittlere Spalte ist **kein Sollwert**, sondern ein Plausibilitätsanker aus einem Vergleichslauf. Die zeitpunkt-ehrliche Fassung ist **strenger** und darf davon abweichen. Sie tut es nur wenig: bei S-U 925 statt 911 Feuerungen (+1,5 %), die Fallzahl trifft mit 512 Firmen den Anker exakt.

**Der wichtigste Effekt ist kein Zahlenwert, sondern ein Wegfall.** Die Quellen-Naht — Firmen-Quartale, die nur deshalb nicht berechenbar waren, weil die Firma zwischen zwei Quartalen die Umsatz-Kennung wechselt — fällt von 2.663 auf 0. Das ist kein Wegsehen: weil jede Rechenkette jetzt vollständig aus **einer** Reihe stammt, kann eine Naht gar nicht mehr entstehen.

Nicht jeder dieser Fälle wird dadurch rechenbar — verschwunden ist der **Ausfallgrund**, nicht die Prüfung. Wo die gewählte Reihe kein Vorjahresquartal trägt, fällt das Quartal weiterhin aus, jetzt aber unter dem zutreffenden Namen: „kein Vorjahrespartner" steigt von 26.499 auf 27.223. Unterm Strich sind 2.776 Firmen-Quartale mehr auswertbar als vorher.

Der alte Stand bleibt hier sichtbar und beziffert. Wer die Etappe später prüft, sieht beide Rechnungen nebeneinander und muss keinem Satz glauben, dass „sich nicht viel geändert hat".

## 3. Kalibrierung — regelbasiert, nicht nach Augenmaß

Zielband je Signal, vorab festgelegt: Feuerrate zwischen **0,5 %** und **2,5 %** der auswertbaren Firmen-Quartale **und** mindestens **300 Firmen** mit reifem Erst-Ereignis, gemessen 2012–2016. Nachjustiert wird ausschließlich das Perzentil P: Rate zu hoch → P + 5, Rate zu tief oder zu wenige Firmen → P − 5; höchstens zwei Schritte, erlaubt sind [80, 85, 90, 95].

Die Persistenz-Regel (zwei Quartale) und das Niveau-Gate (g > 0) sind **keine Knöpfe** — sie wurden nicht verändert.

**S-U** — Endstand P95:

| Schritt | P | Feuerungen | auswertbar | Rate | Firmen reif | Entscheid |
|---|---:|---:|---:|---:|---:|---|
| 0 | 90 | 2.072 | 65.809 | 3,15 % | 1.066 | Rate ueber dem Band -> P 90 -> 95 |
| 1 | 95 | 925 | 65.809 | 1,41 % | 512 | im Zielband — keine Nachjustierung |

**S-G** — Endstand P95:

| Schritt | P | Feuerungen | auswertbar | Rate | Firmen reif | Entscheid |
|---|---:|---:|---:|---:|---:|---|
| 0 | 90 | 2.135 | 82.642 | 2,58 % | 1.309 | Rate ueber dem Band -> P 90 -> 95 |
| 1 | 95 | 873 | 82.642 | 1,06 % | 546 | im Zielband — keine Nachjustierung |

S-UG hat **keine eigenen Parameter** — es ist die Schnittmenge von S-U und S-G im selben Fiskalquartal.

## 4. Feuerraten und Fallzahlen je Signal

| Größe | S-U | S-G | S-UG |
|---|---:|---:|---:|
| Firmen mit auswertbarer Quartalsreihe | 7.065 | 8.191 | — |
| Wachstumswerte g | 90.396 | 111.532 | — |
| Beschleunigungswerte a | 78.579 | 97.398 | — |
| auswertbare Firmen-Quartale 2012–2016 | 65.809 | 82.642 | 54.292 |
| **Feuerungen 2012–2016** | 925 | 873 | 43 |
| Feuerrate 2012–2016 | 1,41 % | 1,06 % | 0,08 % |
| Firmen mit mindestens einer Feuerung | 731 | 811 | 41 |
| **Firmen mit reifem Erst-Ereignis** | 512 | 546 | 29 |
| Firmen mit unreifem Erst-Ereignis | 219 | 265 | 12 |

**Wie viele Firmen tragen überhaupt eine Umsatzreihe?** 7.065 Firmen liefern mindestens einen auswertbaren Quartalsumsatz; **3.959 Firmen liefern in KEINER der vier Quellen auch nur einen einzigen** — das sind 35,91 % aller Firmen des Fensters. Das sind keine Datenfehler, sondern überwiegend Firmen, die ihren Umsatz unter einer anderen Kennung melden (Banken, Versicherer, Beteiligungsgesellschaften) oder gar keinen ausweisen. Für die spätere Auswertung heißt das: die Grundgesamtheit dieser Studie ist **nicht** der ganze US-Markt, sondern der Teil davon, der einen vergleichbaren Umsatz meldet. Dieser Satz gehört in jeden Folgereport.

Feuerungen in den **Rumpfjahren 2009–2011** — nur nachrichtlich, sie sind von Kalibrierung und Zielband ausgeschlossen (2009 trägt laut E1 nur 6 %, 2010 nur 19 % der Firmen des Fensters): S-U **49**, S-G **30**.

S-UG ist 4,65 % von S-U und 4,93 % von S-G.

**Warum S-UG so dünn ist.** Hätten die beiden Signale nichts miteinander zu tun, wären auf dem gemeinsamen Nenner rein rechnerisch **7,0** Doppel-Feuerungen zu erwarten. Beobachtet sind **43** — das 6,1-fache. Umsatz- und Ergebnis-Beschleunigung treten also **häufiger gemeinsam auf als der Zufall es täte, aber bei weitem nicht deckungsgleich**. S-UG scheitert an der Fallzahl nicht, weil die Daten fehlen, sondern weil beide Bedingungen zugleich schlicht selten sind. Das ist ein Ergebnis, kein Defekt — und es ist der Grund, warum S-UG als eigenes Signal in dieser Form nicht trägt.

### S-UG kommt in den Muster-Friedhof

**S-UG wird nicht weiterverfolgt.** Es scheitert am vorab festgelegten Mindest-Fallzahl-Kriterium: **29 Firmen** mit reifem Erst-Ereignis gegen geforderte **300**. Das ist keine knappe Verfehlung, die man mit einer Stellschraube einholen könnte — es fehlt eine Größenordnung. Gemessen wird S-UG weiterhin mit, geführt wird es als **gescheitert**.

Der Beifang bleibt als **beschreibender Befund** stehen, nicht als Signal: Umsatz- und Ergebnis-Beschleunigung treten 6,1-mal häufiger gemeinsam auf, als der Zufall es täte. Das ist eine Aussage über die **Kopplung beider Signale**, kein tragfähiges eigenes Signal — aus einem Überhang folgt keine Fallzahl.

## 5. Wie dicht liegen die Feuerungen?

Gezählt wird nach dem **Signal-Zeitstempel**: dem Moment, ab dem alle Zutaten der Rechnung öffentlich waren (spätester `accepted`-Zeitpunkt aller beteiligten Berichte). Jede Zahl steht **mit ihrem Nenner** — die auswertbaren Firmen-Quartale desselben Monats bzw. Bereichs.

### S-U je Kalendermonat (2012–2016)

| Monat | Feuerungen | auswertbar | Rate |
|---|---:|---:|---:|
| 2012-01 | 1 | 66 | 1,52 % |
| 2012-02 | 28 | 1.260 | 2,22 % |
| 2012-03 | 5 | 224 | 2,23 % |
| 2012-04 | 0 | 282 | 0,00 % |
| 2012-05 | 9 | 975 | 0,92 % |
| 2012-06 | 3 | 171 | 1,75 % |
| 2012-07 | 2 | 354 | 0,56 % |
| 2012-08 | 11 | 967 | 1,14 % |
| 2012-09 | 5 | 236 | 2,12 % |
| 2012-10 | 3 | 560 | 0,54 % |
| 2012-11 | 59 | 2.666 | 2,21 % |
| 2012-12 | 7 | 311 | 2,25 % |
| 2013-01 | 6 | 239 | 2,51 % |
| 2013-02 | 14 | 1.595 | 0,88 % |
| 2013-03 | 26 | 1.585 | 1,64 % |
| 2013-04 | 22 | 927 | 2,37 % |
| 2013-05 | 35 | 2.548 | 1,37 % |
| 2013-06 | 3 | 408 | 0,74 % |
| 2013-07 | 4 | 664 | 0,60 % |
| 2013-08 | 44 | 2.434 | 1,81 % |
| 2013-09 | 9 | 330 | 2,73 % |
| 2013-10 | 6 | 716 | 0,84 % |
| 2013-11 | 52 | 2.590 | 2,01 % |
| 2013-12 | 2 | 311 | 0,64 % |
| 2014-01 | 1 | 259 | 0,39 % |
| 2014-02 | 17 | 1.736 | 0,98 % |
| 2014-03 | 35 | 1.769 | 1,98 % |
| 2014-04 | 13 | 778 | 1,67 % |
| 2014-05 | 27 | 2.470 | 1,09 % |
| 2014-06 | 6 | 330 | 1,82 % |
| 2014-07 | 2 | 687 | 0,29 % |
| 2014-08 | 36 | 2.279 | 1,58 % |
| 2014-09 | 6 | 375 | 1,60 % |
| 2014-10 | 4 | 838 | 0,48 % |
| 2014-11 | 42 | 2.569 | 1,63 % |
| 2014-12 | 2 | 344 | 0,58 % |
| 2015-01 | 5 | 263 | 1,90 % |
| 2015-02 | 17 | 1.731 | 0,98 % |
| 2015-03 | 34 | 1.892 | 1,80 % |
| 2015-04 | 12 | 784 | 1,53 % |
| 2015-05 | 32 | 2.456 | 1,30 % |
| 2015-06 | 5 | 322 | 1,55 % |
| 2015-07 | 6 | 744 | 0,81 % |
| 2015-08 | 29 | 2.240 | 1,29 % |
| 2015-09 | 2 | 313 | 0,64 % |
| 2015-10 | 10 | 734 | 1,36 % |
| 2015-11 | 29 | 2.561 | 1,13 % |
| 2015-12 | 3 | 311 | 0,96 % |
| 2016-01 | 0 | 220 | 0,00 % |
| 2016-02 | 15 | 2.225 | 0,67 % |
| 2016-03 | 28 | 1.639 | 1,71 % |
| 2016-04 | 6 | 746 | 0,80 % |
| 2016-05 | 34 | 2.561 | 1,33 % |
| 2016-06 | 7 | 328 | 2,13 % |
| 2016-07 | 2 | 604 | 0,33 % |
| 2016-08 | 37 | 2.462 | 1,50 % |
| 2016-09 | 4 | 287 | 1,39 % |
| 2016-10 | 9 | 614 | 1,47 % |
| 2016-11 | 51 | 2.600 | 1,96 % |
| 2016-12 | 1 | 319 | 0,31 % |

### Feuerungen je SIC-Bereich (2012–2016)

Die **SIC-Kennung** ist die vierstellige amtliche US-Branchenkennung der SEC; gruppiert wird auf die amtlichen Bereiche.

| Bereich | S-U | Nenner | Rate | S-G | Nenner | Rate |
|---|---:|---:|---:|---:|---:|---:|
| Verarbeitendes Gewerbe | 417 | 25.907 | 1,61 % | 353 | 33.887 | 1,04 % |
| Dienstleistungen | 174 | 12.974 | 1,34 % | 185 | 16.740 | 1,11 % |
| Finanzen, Versicherung, Immobilien | 127 | 9.722 | 1,31 % | 94 | 8.227 | 1,14 % |
| Bergbau und Rohstoffgewinnung | 70 | 3.646 | 1,92 % | 87 | 6.708 | 1,30 % |
| Transport, Kommunikation, Versorger | 65 | 6.148 | 1,06 % | 57 | 8.000 | 0,71 % |
| Einzelhandel | 24 | 4.074 | 0,59 % | 43 | 4.836 | 0,89 % |
| Grosshandel | 19 | 2.104 | 0,90 % | 34 | 2.659 | 1,28 % |
| Bau | 14 | 843 | 1,66 % | 14 | 848 | 1,65 % |
| Land- und Forstwirtschaft, Fischerei | 12 | 334 | 3,59 % | 6 | 567 | 1,06 % |
| Nicht klassifiziert (SEC-Sammelcode) | 2 | 30 | 6,67 % | 0 | 170 | 0,00 % |

### Feuerungen je Kalenderjahr (2012–2016)

| Jahr | S-U | S-G | S-UG |
|---|---:|---:|---:|
| 2012 | 133 | 114 | 8 |
| 2013 | 223 | 233 | 9 |
| 2014 | 191 | 165 | 12 |
| 2015 | 184 | 141 | 7 |
| 2016 | 194 | 220 | 7 |

Die vollständige Kreuztabelle Monat × Bereich steht in der JSON-Fassung dieses Reports (`kreuz_monat_sektor`); sie hier abzudrucken würde den Report nur aufblähen.

## 6. Die drei Prüfschritte

### Prüfschritt 1 — Naht-Invariante

Frage: steht im fertigen Ergebnis auch nur **eine** Wachstums- oder Beschleunigungszahl, deren beide Enden verschiedene Umsatz-Quellen tragen? Antwort: **0** (gefordert: 0) — davon 0 Wachstums- und 0 Beschleunigungswerte. Ergebnis: **bestanden**.

Der Nachzähler ist **unabhängig vom Wächter**: er prüft nicht, ob der Wächter aufgerufen wurde, sondern zählt am Ergebnis nach. Beim Gegenprobe-Lauf wurde der Wächter absichtlich ausgebaut — dann geht diese Zahl über null und der Selbsttest wird rot. Die rote Meldung steht wörtlich in Abschnitt 11.

### Prüfschritt 2 — Belegungs-Glätte

Anteil der Firmen mit mindestens einem auswertbaren Umsatz-Quartal je Kalenderjahr. Nenner: Firmen mit mindestens einem periodischen Bericht in diesem Jahr. Ein Sprung von über 5,0 Prozentpunkten zwischen Nachbarjahren wäre fast immer ein Datenbruch, kein Marktereignis.

| Jahr | Firmen gesamt | davon mit Umsatz-Quartal | Anteil |
|---|---:|---:|---:|
| 2012 | 8.456 | 4.728 | 55,91 % |
| 2013 | 8.127 | 4.690 | 57,71 % |
| 2014 | 7.950 | 4.701 | 59,13 % |
| 2015 | 7.732 | 4.663 | 60,31 % |
| 2016 | 7.193 | 4.405 | 61,24 % |

Größter Sprung zwischen Nachbarjahren: **1,80 Punkte** → **bestanden**.

### Prüfschritt 3 — Überlappung der Quellen

Wo mindestens zwei Umsatz-Quellen im selben Firmen-Quartal ein Wachstum liefern: wie weit liegen sie auseinander?

| Größe | Wert |
|---|---:|
| Firmen-Quartale mit mindestens zwei Quellen | 11.383 |
| davon Abstand über 5 Punkte | 1.766 |
| Anteil | 15,51 % |
| Median des Abstands | 0,0000 |
| 90. Perzentil | 0,1247 |
| 99. Perzentil | 1,2501 |

Der Anteil liegt über 10 % — die **vorab festgelegte** Folgeregel greift: die Quelle wird **je Firma** fixiert (längste Serie) statt je Quartal. Diese Regel stand vor der Messung fest, sie wurde hier nicht erfunden. **Sie ist in diesem Lauf angewandt** — die Zahlen dieses Reports sind bereits die der fixierten Quelle; wie sie sich gegen den alten Stand verhalten, steht in Abschnitt 2.

Die Zahlen dieser Tabelle sind bewusst **weiterhin die der ungewählten Rohlage**: Prüfschritt 3 vergleicht jede Quelle mit jeder, damit sichtbar bleibt, wie weit sie auseinanderliegen. Er misst den Widerspruch, nicht das Ergebnis der Wahl — sonst hätte die Umstellung ihren eigenen Auslöser wegmoderiert.

## 7. Was nicht berechenbar war (Regel R5)

Nie geschätzt, nie auf null gesetzt — jeder Fall mit Grund gezählt.

| Fall | Anzahl |
|---|---:|
| Bericht ohne Veröffentlichungszeitpunkt | 0 |
| Bericht ohne brauchbare Branchenkennung | 55 |
| Bericht ohne Firmennummer | 0 |
| Bericht ohne Geschäftsjahresende | 0 |
| Bericht ohne lesbaren Berichtszeitraum | 0 |
| Berichte in der Panel-Datei gesamt (nachrichtlich) | 176.502 |
| Bericht ohne Berichtsperiode (8-K, S-1 und Verwandte) — verworfen | 5.892 |
| periodische Berichte gesamt (nachrichtlich) | 170.610 |
| Betriebsergebnis: Firma liefert keinen auswertbaren Wert | 2.833 |
| Betriebsergebnis: Jahrespaar kein volles Kalenderjahr (nachrichtlich) | 213 |
| Betriebsergebnis: kein Vorjahresquartal | 30.745 |
| Betriebsergebnis: kein Vorquartal | 14.134 |
| Betriebsergebnis: kein Vorquartal für die zweite Beschleunigung | 11.964 |
| Betriebsergebnis: Trailing-Fenster zu dünn | 42 |
| Betriebsergebnis: Summen-Quelle unvollständig | 0 |
| Betriebsergebnis: symmetrischer Nenner ist null | 10 |
| Betriebsergebnis: viertes Quartal abgeleitet (nachrichtlich) | 18.769 |
| Betriebsergebnis: viertes Quartal nicht ableitbar | 12.497 |
| Betriebsergebnis: Jahresstichtag unlesbar | 0 |
| Betriebsergebnis: Quellen-Naht | 0 |
| geprüfte Datenzeilen der Zielkennungen (nachrichtlich) | 2.158.042 |
| Nettoergebnis (Diagnose): Firma liefert keinen auswertbaren Wert | 896 |
| Nettoergebnis (Diagnose): Jahrespaar kein volles Kalenderjahr | 322 |
| Nettoergebnis (Diagnose): kein Vorjahresquartal | 38.775 |
| Nettoergebnis (Diagnose): kein Vorquartal | 17.667 |
| Nettoergebnis (Diagnose): kein Vorquartal für die zweite Beschleunigung | 0 |
| Nettoergebnis (Diagnose): keine Schwelle (Diagnose hat keine) | 0 |
| Nettoergebnis (Diagnose): Summen-Quelle unvollständig | 0 |
| Nettoergebnis (Diagnose): symmetrischer Nenner ist null | 183 |
| Nettoergebnis (Diagnose): viertes Quartal abgeleitet | 18.127 |
| Nettoergebnis (Diagnose): viertes Quartal nicht ableitbar | 18.893 |
| Nettoergebnis (Diagnose): Jahresstichtag unlesbar | 0 |
| Nettoergebnis (Diagnose): Quellen-Naht | 0 |
| Größe steht in mehreren Berichtsfassungen (frühester gewinnt) | 363.442 |
| Größe wurde später mit ANDEREM Wert erneut gemeldet | 55.290 |
| Größen nach der Zeitpunkt-Bereinigung (nachrichtlich) | 594.429 |
| Datenzeilen nach allen Filtern (nachrichtlich) | 1.194.307 |
| Umsatz: Firma liefert in KEINER Quelle einen auswertbaren Wert | 3.959 |
| Umsatz: Jahrespaar kein volles Kalenderjahr (nachrichtlich) | 138 |
| Umsatz: kein Vorjahresquartal im Fenster 330–380 Tage | 27.223 |
| Umsatz: kein Vorquartal im Fenster 80–110 Tage | 11.817 |
| Umsatz: kein Vorquartal für die zweite Beschleunigung | 9.927 |
| Umsatz: Trailing-Fenster trägt weniger als 200 Werte | 54 |
| Umsatz: Summen-Quelle unvollständig (nur eine Komponente) | 26.140 |
| Umsatz: symmetrischer Nenner ist null | 0 |
| Umsatz: viertes Quartal erfolgreich abgeleitet (nachrichtlich) | 12.271 |
| Umsatz: viertes Quartal nicht ableitbar (Komponente fehlt) | 15.371 |
| Umsatz: viertes Quartal abgeleitet, aber ein Vorquartal war <= 0 (nachrichtlich) | 1.795 |
| Umsatz: Jahresstichtag unlesbar (viertes Quartal nicht ableitbar) | 0 |
| Umsatz: Partnerquartal trägt eine andere Quelle (Quellen-Naht) | 0 |
| Umsatz: Wert kleiner oder gleich null | 11.295 |
| Datenzeile eines Mit-Registranten (nicht Konzern) — verworfen | 363.624 |
| Datenzeile mit firmeneigener Kennung — verworfen | 0 |
| Datenzeile aus nicht-periodischem Bericht — verworfen | 82.177 |
| Datenzeile mit anderer Periodenlänge als 1 oder 4 Quartale | 497.512 |
| Datenzeile mit unlesbarem Bilanzstichtag | 0 |
| Datenzeile ohne Wert | 20.422 |

Die Zeile *Groesse wurde spaeter mit ANDEREM Wert erneut gemeldet* ist der Beleg dafür, dass die Zeitpunkt-Regel etwas bewirkt: in **55.290** Fällen hätte ein späterer Berichtsstand eine andere Zahl geliefert. Gerechnet wurde immer mit der **zuerst veröffentlichten**.

### Was diese Datenquelle nicht hergibt: 53-Wochen-Geschäftsjahre

Viele Handels- und Technikfirmen rechnen nicht in Kalendermonaten, sondern in 52 bzw. 53 Wochen — etwa alle fünf bis sechs Jahre hat ihr Geschäftsjahr eine Woche mehr. Der Plan sah vor, diese Fälle zu **zählen**. Über den Abstand der Bilanzstichtage geht das hier **nicht**: der SEC-Datensatz rundet den Stichtag `ddate` auf das Monatsende. Als Tag des Monats kommen nur 28, 29, 30 und 31 vor, und **alle** Jahrespaare liegen bei 365 oder 366 Tagen — ein 53-Wochen-Jahr (371 Tage) kann in diesen Daten gar nicht auffallen.

Ein Zähler auf „Abstand ab 368 Tagen" hätte deshalb dauerhaft **0** gemeldet und wie ein Befund ausgesehen. Er wurde ersetzt durch das, was hier wirklich messbar ist:

| Größe | Anzahl |
|---|---:|
| Firmen mit angegebenem Geschäftsjahresende | 11.156 |
| davon mit **wanderndem** Geschäftsjahresende (das sind die 52/53-Wochen-Rechner) | 639 |
| davon mit auswertbarer Umsatzreihe | 425 |
| Jahrespaare, deren Abstand kein volles Kalenderjahr ist | 138 |

Diese Firmen sind also **nicht ignoriert** — sie sind gezählt und laufen normal mit. Was fehlt, ist die Möglichkeit, das einzelne 53-Wochen-Jahr zu markieren; das steht als offene Frage in Abschnitt 10.

## 8. Diagnose: trägt `NetIncomeLoss` mehr als `OperatingIncomeLoss`?

Reine Diagnose — kein Signal, keine Schwelle, keine Kalibrierung. Sie soll der nächsten Etappe erlauben, **mit Zahlen** zu entscheiden, falls S-G zu dünn trägt. `NetIncomeLoss` ist das Ergebnis nach Steuern, `OperatingIncomeLoss` das Betriebsergebnis.

| Größe | NetIncomeLoss | OperatingIncomeLoss |
|---|---:|---:|
| Firmen mit auswertbarer Quartalsreihe | 10.128 | 8.191 |
| Wachstumswerte g | 136.201 | 111.532 |
| Beschleunigungswerte a | 118.534 | 97.398 |
| Firmen mit mindestens einem g | 9.962 | — |

## 9. Scheiternskriterien — vorab festgelegt

| Kriterium | Stand |
|---|---|
| K1 — S-U unter 300 Firmen mit reifem Erst-Ereignis | 512 → nicht gegriffen |
| K2 — unter 50 % der Firmen mit 8-Quartals-Kette haben ein Umsatz-Wachstumsquartal | 67,01 % von 7.973 → nicht gegriffen |
| K3a — über 50 % der S-U-Feuerungen in einem SIC-Bereich | 45,08 % (Verarbeitendes Gewerbe) → nicht gegriffen |
| K3b — über 40 % der S-U-Feuerungen in einem Kalenderjahr | 24,11 % (2013) → nicht gegriffen |
| K4 — Naht-Invariante ungleich 0 oder Belegungssprung über 5 Punkte | Naht 0, Sprung 1,80 → nicht gegriffen |

S-G und S-UG dürfen **einzeln** scheitern, ohne die Signalfamilie zu kippen.

## 10. Neue Fragen und Hypothesen (Pflichtblock nach R16)

- **Banken-Sonderfamilie ja/nein?** Der Bereich „Finanzen, Versicherung, Immobilien" stellt laut E1 die zweitgrößte Firmengruppe, hat aber ein anderes Umsatzverständnis (Zinsertrag statt Warenverkauf). Hier trägt er 13,74 % der S-U-Feuerungen. Zu klären: eigene Signalfamilie, Ausschluss oder unverändert mitlaufen lassen — mit Vorab-Kriterium, nicht nach Ergebnislage. (Zeitschätzung: 1–2 Tage)
- **`NetIncomeLoss` als Alternative für S-G?** Das Ergebnis nach Steuern liefert 118.534 Beschleunigungswerte gegen 97.398 beim Betriebsergebnis. Ob die zusätzliche Tiefe die schlechtere Aussagekraft (Einmaleffekte, Steuerquote) aufwiegt, ist eine Vorab-Entscheidung der nächsten Etappe — nicht nachträglich nach Ergebnis auswählbar. (Zeitschätzung: 1 Tag)
- **Aktienzahl-Abdeckung für die Je-Aktie-Rechnung (R10) — auf der NEUEN Kohorte nachzumessen.** Der Endpunkt-Wächter verlangt eine Pflicht-Nebenrechnung „Umsatz je Aktie". Diese Messung ist am selben Tag erfolgt (`E2-aktienzahl-2026-08-19`) und kam auf 83,6 % Abdeckung — aber auf den **487** Firmen des alten Stands. Mit der umgestellten Quellenwahl sind es 512 Firmen, also eine andere Grundgesamtheit; der dortige Anker hält den Lauf dafür richtigerweise an. Die Abdeckung muss auf der neuen Kohorte neu gemessen werden, bevor R10 präregistriert wird — übertragen werden darf sie nicht. (Zeitschätzung: 0,5 Tage)
- **Wie oft wechselt die fixierte Quelle im Lauf einer Firmenhistorie?** Die Folgeregel aus Prüfschritt 3 ist angewandt (Abschnitt 2), und die Frage nach Fallzahl und Feuerrate ist damit beantwortet — die Fallzahl steigt auf 512 Firmen. Offen ist die Anschlussfrage: Die zeitpunkt-ehrliche Wahl darf die Quelle im Lauf der Zeit wechseln, wenn eine andere Reihe länger wird. Wie oft passiert das, und trifft es dieselben Firmen, die später feuern? Häufige Wechsel würden bedeuten, dass „je Firma fixiert" in der Praxis weniger fix ist, als der Name verspricht. (Zeitschätzung: 0,5 Tage)
- **Was die Naht gekostet hat — und wen sie getroffen hätte.** Vor der Umstellung waren 2.663 Firmen-Quartale nur deshalb nicht berechenbar, weil die Firma zwischen zwei Quartalen die Umsatz-Kennung wechselte; jetzt sind es 0. Offen bleibt die inhaltliche Frage: Waren das Zufallswechsel oder systematisch dieselben Firmen? Falls systematisch, hat der alte Stand eine ganze Firmenklasse verloren — und dann ist die Umstellung nicht nur sauberer, sondern korrigiert eine Verzerrung, die im alten Report unsichtbar war. Das ist prüfbar, indem man die betroffenen Firmen gegen die übrigen hält (Branche, Größe, Feuerhäufigkeit). (Zeitschätzung: 1 Tag)
- **53-Wochen-Geschäftsjahre sichtbar machen.** Der Stichtag `ddate` ist in dieser Quelle auf das Monatsende gerundet, deshalb ist ein 53-Wochen-Jahr über den Stichtagsabstand unsichtbar. Messbar wäre es über das Geschäftsjahresende `fye` im Berichtskopf (639 Firmen mit wanderndem Ende, davon 425 mit Umsatzreihe) oder über das echte Periodenende in den Original-Einreichungen. Offen: Verzerrt das zusätzliche Quartal die Wachstumsrate dieser Firmen systematisch nach oben — und liegen sie deshalb häufiger unter den Feuerungen? (Zeitschätzung: 1 Tag)
- **Was bedeutet der Deckel bei ±2?** Wie viele Wachstumswerte laufen tatsächlich in die Begrenzung, und sind das dieselben Firmen (Neulinge aus dem Nichts) wie die späteren Signalträger? Wenn ja, misst das Signal womöglich vor allem Basiseffekte kleiner Ausgangszahlen. (Zeitschätzung: 0,5 Tage)

## 11. Woran das hier verifiziert wurde

**a) Selbsttest gegen eine kleine, selbst gebaute Datenbank.** Geprüft wird gegen zwölf Fixture-Firmen, deren Erwartungswerte von Hand nachgerechnet sind — unter anderem: die Zeitpunkt-Regel (früherer Bericht 100 schlägt späteren 999), die Ableitung des vierten Quartals (100 − (10+20+30) = 40), das symmetrische Wachstum (20/110 = 0,181818…), der Quellenwechsel (eine Firma, die 2012 unter der einen und 2013 unter der anderen Kennung meldet, bekommt über diesen Bruch hinweg kein Wachstum), der 53-Wochen-Fall, und alle drei Signal-Bedingungen einzeln — jede einmal erfüllt und einmal verletzt. Jede Prüfung wird in **beide** Richtungen gestellt: die gültige Form muss durchgehen, die kaputte muss auffliegen.

Für die umgestellte Quellenwahl kamen drei Firmen dazu, die genau die Fälle treffen, an denen sich die Fassungen unterscheiden:

- **Längste Serie schlägt Priorität**: eine Firma, deren höher priorisierte Kennung nur ein Quartal trägt, die niedrigere aber vier — gewählt wird die längere.
- **Zeitpunkt-Ehrlichkeit**: eine Firma, bei der die niedriger priorisierte Kennung *später* die längere wird. Wer mit Blick auf das Fensterende wählt, nimmt sie schon 2012; zeitpunkt-ehrlich sind 2012 beide gleich lang, also gewinnt dort die Priorität. Genau diese Prüfung wird rot, wenn man die Rückblick-Fassung einbaut.
- **Kette bleibt in einer Quelle**: eine Firma mit zwei Kennungen auf verschiedenem Niveau (100 und 200). Wer die Kette aus der je Quartal gemischten Reihe baut, rechnet 220 gegen 100 statt 220 gegen 200 — die Prüfung nagelt die Zahl 20/210 fest und fällt bei jeder Mischung auf.

**b) Jede Prüfung einmal absichtlich kaputtgemacht.** Ein Wächter, den man nie rot gesehen hat, ist eine Zeremonie. Sieben Gegenproben, jede mit Exit-Code 1 — der Originalstand war vorher committet, danach wiederhergestellt. Protokoll:

*Quellenwahl — Zeitpunkt-Ehrlichkeit* — Sabotage: die Serienlänge wird über die GANZE Reihe gezählt statt nur bis zum Signalzeitpunkt (das ist genau die verbotene Fenster-Rückblick-Fassung).

```
  ROT   ZEITPUNKT-EHRLICH: 2012 sind beide Quellen gleich lang, also gewinnt
        Revenues — die spaetere Laenge von SalesRevenueNet aendert die Wahl von
        damals NICHT (Firma 7600)
        (ist: (('SalesRevenueNet', 'USD'), ('SalesRevenueNet', 'USD'))
         soll: (('Revenues', 'USD'), ('Revenues', 'USD')))
  SELBSTTEST ROT — 1 Pruefung(en) gescheitert (Exit-Code 1)
```

*Quellenwahl — längste Serie* — Sabotage: die Serienlänge fällt aus der Rangfolge, es entscheidet wieder allein die Priorität.

```
  ROT   laengste Serie schlaegt die Prioritaet (Firma 7700: SalesRevenueNet
        mit 4 Quartalen gegen Revenues mit 1)
        (ist: ('Revenues', 'USD') | soll: ('SalesRevenueNet', 'USD'))
  SELBSTTEST ROT — 1 Pruefung(en) gescheitert (Exit-Code 1)
```

*Quellenwahl — Gleichstands-Regel* — Sabotage: der Währungs-Vorzug wird umgedreht (Fremdwährung schlägt USD).

```
  ROT   Gleichstand bei der Waehrung -> USD (Firma 7800)
        (ist: ('Revenues', 'EUR') | soll: ('Revenues', 'USD'))
  SELBSTTEST ROT — 1 Pruefung(en) gescheitert (Exit-Code 1)
```

*Kette bleibt in einer Quelle* — Sabotage: die Rechenkette wird wieder aus der je Quartal gemischten Reihe gebaut (Rückfall auf die alte Quellenwahl).

```
  ROT   Firma 3000 hat kein einziges Wachstum ueber die Naht
  ROT   Kette bleibt in EINER Quelle: g(7600, 20130331) = 20/210 =
        0,095238... (nicht 120/160 = 0,75 ueber die Naht)
        (ist: 0.75 | soll: 0.09523809523809523)
  SELBSTTEST ROT — 2 Pruefung(en) gescheitert (Exit-Code 1)
```

*Prüfschritt 1 — Naht-Wächter* — Sabotage: `basis_gleich` liefert statt des Vergleichs immer `True`.

```
  ROT   Folgequartal anderer Quelle zaehlt fuer die Reife NICHT mit
        (ist: 6 | soll: 5)
  SELBSTTEST ROT — 1 Pruefung(en) gescheitert (Exit-Code 1)
```

*Prüfschritt 2 — Belegungs-Glätte* — Sabotage: die Sprungmessung wird entfernt (größter Sprung immer 0).

```
  ROT   Glaette: Loch in 2014 faellt AUF (50 Punkte Sprung)   (ist: 0.0 | soll: 50.0)
  SELBSTTEST ROT — 1 Pruefung(en) gescheitert (Exit-Code 1)
```

*Prüfschritt 3 — Überlappung* — Sabotage: der Vergleich zweier Quellen im selben Firmen-Quartal wird abgeschaltet.

```
  ROT   Ueberlappung: zwei Firmen-Quartale mit zwei Quellen   (ist: 0 | soll: 2)
  ROT   Ueberlappung: genau eines davon ueber 5 Punkten   (ist: 0 | soll: 1)
  ROT   Ueberlappung: Anteil 50 % > 10 % -> Folgeregel greift   (ist: None | soll: 0.5)
  SELBSTTEST ROT — 3 Pruefung(en) gescheitert (Exit-Code 1)
```

Nach jeder Gegenprobe wurde der Originalstand wiederhergestellt und der Selbsttest lief wieder grün.

**c) Nachrechnung von außen.** Drei Feuerungen **dieses** Laufs wurden mit **eigenem Code und eigenen Datenbank-Abfragen** neu berechnet: Filter, Zeitpunkt-Regel, Q4-Ableitung, **Quellenwahl**, Wachstum und beide Beschleunigungen — ohne eine einzige Funktion des Skripts. Vom Skript stammt nur die Behauptung „hier feuert es". Alle drei stimmen auf neun Nachkommastellen überein, die gewählte Quelle ebenfalls:

| Firma | Quartal | gewählte Quelle | g(t) | a(t) | a(t−1) | Schwelle |
|---|---|---|---:|---:|---:|---:|
| 1000694 | 31.12.2013 | Revenues | 0,628013519 | 0,810279062 | 0,489541867 | 0,609562574 |
| 1445883 | 30.06.2013 | Revenues | 1,086339077 | 1,599425047 | 0,331776980 | 0,578088764 |
| 9984 | 31.12.2012 | SalesRevenueNet | 0,496055383 | 0,557295095 | 0,049895003 | 0,460964067 |

Der dritte Fall prüft die neue Regel im Echtbetrieb gleich mit: Firma 9984 wird **nicht** über die höher priorisierte Kennung gerechnet, sondern über `SalesRevenueNet` — weil diese Reihe zum Signalzeitpunkt 14 auswertbare Quartale trug und damit die längere war. Die unabhängige Rechnung kommt zur selben Wahl.

Bei derselben Firma hängt der Wert an einer **abgeleiteten** Q4-Zahl, und die hängt an der Zeitpunkt-Regel: der Jahresumsatz 2012 wurde zuerst am 25.02.2013 mit 1.229.959.000 gemeldet und später auf 928.780.000 geändert. Gerechnet wird mit der **zuerst veröffentlichten** Fassung: 1.229.959.000 − 306.059.000 − 293.422.000 − 303.096.000 = 327.382.000. Mit der späteren Fassung käme eine andere Zahl heraus — genau deshalb steht die Regel im Code und nicht in einer Zusage.

**d) Plausibilitätsanker gegen E1.** Die unabhängig nachgezählte Zahl der Firmen mit mindestens acht Berichtsquartalen am Stück trifft den E1-Report exakt (7.973).

**e) Wiederaufnahme (R15c).** Der Lauf arbeitet in Häppchen und vermerkt jedes abgeschlossene. Ein zweiter Lauf über dieselbe Arbeitsdatei verdoppelt nichts — das ist eine eigene Selbsttest-Prüfung.

---

*Erzeugt 2026-08-19T10:00:33+00:00 · Python 3.12.10 · SQLite 3.49.1 · nur Standardbibliothek und sqlite3 (R14c).*
