# E2 — Basisraten der Beschleunigungs-Signale

Stand 2026-08-19. Gelesen wurde **ausschließlich** das Entdeckungsfenster (2009-01-01 bis 2016-12-31). Prüffenster und Endtest-Fenster wurden **nicht geöffnet, nicht entschlüsselt und nicht gezählt** — der Endtest bleibt bis zum Ende der Studie verschlossen.

*Fachwörter werden bei der ersten Verwendung in einem Halbsatz übersetzt.*

**Lauf-Flag (R4): Ergebnisdaten berührt = NEIN.** Es wurde keine Kurs-, Rendite- oder Ergebnisdatei geöffnet. Tatsächlich geöffnete Dateien:
- `panel-entdeckung.sqlite`
- `panel-entdeckung.sqlite`

## Kurz gefasst

- **S-U** (Umsatz-Beschleunigung) feuert im Zielzeitraum 2012–2016 in **877** Firmen-Quartalen von **63.033** auswertbaren — Feuerrate **1,39 %**. Reifes Erst-Ereignis bei **487 Firmen**.
- **S-G** (Beschleunigung des Betriebsergebnisses) feuert in **872** von **82.611** — Rate **1,06 %**, reifes Erst-Ereignis bei **545 Firmen**.
- **S-UG** (beides im selben Fiskalquartal) feuert in **41** von **51.794** — Rate **0,08 %**, reifes Erst-Ereignis bei **27 Firmen**.

**Vorab festgelegte Scheiternskriterien, die gegriffen haben:**
- S-UG — K1: nur 27 Firmen mit reifem Erst-Ereignis (gefordert 300)

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

Der Umsatz heißt in den SEC-Daten nicht durchgehend gleich. Feste Priorität, je Firmen-Quartal wird **genau eine** Quelle gewählt:

1. `Revenues`
2. `RevenueFromContractWithCustomerExcludingAssessedTax`
3. `SalesRevenueNet`
4. `SalesRevenueGoodsNet+SalesRevenueServicesNet` (Summe beider Komponenten, nur wenn beide in beiden Perioden vorliegen)

`RevenueFromContractWithCustomerIncludingAssessedTax` bleibt bewusst draußen — diese Kennung enthält durchlaufende Steuern und liegt damit auf einem anderen Niveau.

**Die zentrale Regel:** verglichen wird **nie über Quellen hinweg**. Wechselt eine Firma zwischen zwei Quartalen die Kennung, existiert für dieses Paar kein Wachstum — der Fall heißt *nicht berechenbar* und wird als **Quellen-Naht** gezählt (2.663 Fälle).

Im Entdeckungsfenster ist Priorität 2 (`RevenueFromContractWithCustomerExcludingAssessedTax`) **leer**: die Kennung wurde erst ab 2018 verwendet. Für dieses Fenster tragen also nur die Prioritäten 1, 3 und 4.

## 2. Kalibrierung — regelbasiert, nicht nach Augenmaß

Zielband je Signal, vorab festgelegt: Feuerrate zwischen **0,5 %** und **2,5 %** der auswertbaren Firmen-Quartale **und** mindestens **300 Firmen** mit reifem Erst-Ereignis, gemessen 2012–2016. Nachjustiert wird ausschließlich das Perzentil P: Rate zu hoch → P + 5, Rate zu tief oder zu wenige Firmen → P − 5; höchstens zwei Schritte, erlaubt sind [80, 85, 90, 95].

Die Persistenz-Regel (zwei Quartale) und das Niveau-Gate (g > 0) sind **keine Knöpfe** — sie wurden nicht verändert.

**S-U** — Endstand P95:

| Schritt | P | Feuerungen | auswertbar | Rate | Firmen reif | Entscheid |
|---|---:|---:|---:|---:|---:|---|
| 0 | 90 | 1.979 | 63.033 | 3,14 % | 1.025 | Rate ueber dem Band -> P 90 -> 95 |
| 1 | 95 | 877 | 63.033 | 1,39 % | 487 | im Zielband — keine Nachjustierung |

**S-G** — Endstand P95:

| Schritt | P | Feuerungen | auswertbar | Rate | Firmen reif | Entscheid |
|---|---:|---:|---:|---:|---:|---|
| 0 | 90 | 2.137 | 82.611 | 2,59 % | 1.311 | Rate ueber dem Band -> P 90 -> 95 |
| 1 | 95 | 872 | 82.611 | 1,06 % | 545 | im Zielband — keine Nachjustierung |

S-UG hat **keine eigenen Parameter** — es ist die Schnittmenge von S-U und S-G im selben Fiskalquartal.

## 3. Feuerraten und Fallzahlen je Signal

| Größe | S-U | S-G | S-UG |
|---|---:|---:|---:|
| Firmen mit auswertbarer Quartalsreihe | 7.065 | 8.191 | — |
| Wachstumswerte g | 88.832 | 111.495 | — |
| Beschleunigungswerte a | 76.109 | 97.365 | — |
| auswertbare Firmen-Quartale 2012–2016 | 63.033 | 82.611 | 51.794 |
| **Feuerungen 2012–2016** | 877 | 872 | 41 |
| Feuerrate 2012–2016 | 1,39 % | 1,06 % | 0,08 % |
| Firmen mit mindestens einer Feuerung | 698 | 810 | 39 |
| **Firmen mit reifem Erst-Ereignis** | 487 | 545 | 27 |
| Firmen mit unreifem Erst-Ereignis | 211 | 265 | 12 |

Feuerungen in den **Rumpfjahren 2009–2011** — nur nachrichtlich, sie sind von Kalibrierung und Zielband ausgeschlossen (2009 trägt laut E1 nur 6 %, 2010 nur 19 % der Firmen des Fensters): S-U **47**, S-G **30**.

S-UG ist 4,68 % von S-U und 4,70 % von S-G.

**Warum S-UG so dünn ist.** Hätten die beiden Signale nichts miteinander zu tun, wären auf dem gemeinsamen Nenner rein rechnerisch **6,6** Doppel-Feuerungen zu erwarten. Beobachtet sind **41** — das 6,2-fache. Umsatz- und Ergebnis-Beschleunigung treten also **häufiger gemeinsam auf als der Zufall es täte, aber bei weitem nicht deckungsgleich**. S-UG scheitert an der Fallzahl nicht, weil die Daten fehlen, sondern weil beide Bedingungen zugleich schlicht selten sind. Das ist ein Ergebnis, kein Defekt — und es ist der Grund, warum S-UG als eigenes Signal in dieser Form nicht trägt.

## 4. Wie dicht liegen die Feuerungen?

Gezählt wird nach dem **Signal-Zeitstempel**: dem Moment, ab dem alle Zutaten der Rechnung öffentlich waren (spätester `accepted`-Zeitpunkt aller beteiligten Berichte). Jede Zahl steht **mit ihrem Nenner** — die auswertbaren Firmen-Quartale desselben Monats bzw. Bereichs.

### S-U je Kalendermonat (2012–2016)

| Monat | Feuerungen | auswertbar | Rate |
|---|---:|---:|---:|
| 2012-01 | 1 | 58 | 1,72 % |
| 2012-02 | 26 | 1.207 | 2,15 % |
| 2012-03 | 5 | 222 | 2,25 % |
| 2012-04 | 0 | 269 | 0,00 % |
| 2012-05 | 8 | 940 | 0,85 % |
| 2012-06 | 3 | 164 | 1,83 % |
| 2012-07 | 2 | 329 | 0,61 % |
| 2012-08 | 10 | 923 | 1,08 % |
| 2012-09 | 5 | 223 | 2,24 % |
| 2012-10 | 2 | 525 | 0,38 % |
| 2012-11 | 57 | 2.535 | 2,25 % |
| 2012-12 | 6 | 278 | 2,16 % |
| 2013-01 | 5 | 213 | 2,35 % |
| 2013-02 | 11 | 1.484 | 0,74 % |
| 2013-03 | 24 | 1.522 | 1,58 % |
| 2013-04 | 21 | 883 | 2,38 % |
| 2013-05 | 32 | 2.418 | 1,32 % |
| 2013-06 | 3 | 389 | 0,77 % |
| 2013-07 | 3 | 625 | 0,48 % |
| 2013-08 | 42 | 2.309 | 1,82 % |
| 2013-09 | 9 | 317 | 2,84 % |
| 2013-10 | 5 | 676 | 0,74 % |
| 2013-11 | 47 | 2.466 | 1,91 % |
| 2013-12 | 2 | 292 | 0,68 % |
| 2014-01 | 1 | 242 | 0,41 % |
| 2014-02 | 14 | 1.629 | 0,86 % |
| 2014-03 | 35 | 1.688 | 2,07 % |
| 2014-04 | 12 | 729 | 1,65 % |
| 2014-05 | 27 | 2.366 | 1,14 % |
| 2014-06 | 3 | 305 | 0,98 % |
| 2014-07 | 2 | 641 | 0,31 % |
| 2014-08 | 37 | 2.188 | 1,69 % |
| 2014-09 | 6 | 354 | 1,69 % |
| 2014-10 | 5 | 803 | 0,62 % |
| 2014-11 | 39 | 2.479 | 1,57 % |
| 2014-12 | 1 | 332 | 0,30 % |
| 2015-01 | 5 | 250 | 2,00 % |
| 2015-02 | 15 | 1.648 | 0,91 % |
| 2015-03 | 32 | 1.814 | 1,76 % |
| 2015-04 | 11 | 765 | 1,44 % |
| 2015-05 | 31 | 2.383 | 1,30 % |
| 2015-06 | 5 | 305 | 1,64 % |
| 2015-07 | 5 | 721 | 0,69 % |
| 2015-08 | 27 | 2.180 | 1,24 % |
| 2015-09 | 2 | 296 | 0,68 % |
| 2015-10 | 10 | 719 | 1,39 % |
| 2015-11 | 29 | 2.498 | 1,16 % |
| 2015-12 | 3 | 300 | 1,00 % |
| 2016-01 | 0 | 205 | 0,00 % |
| 2016-02 | 16 | 2.125 | 0,75 % |
| 2016-03 | 28 | 1.588 | 1,76 % |
| 2016-04 | 6 | 725 | 0,83 % |
| 2016-05 | 33 | 2.488 | 1,33 % |
| 2016-06 | 8 | 316 | 2,53 % |
| 2016-07 | 2 | 584 | 0,34 % |
| 2016-08 | 37 | 2.395 | 1,54 % |
| 2016-09 | 4 | 278 | 1,44 % |
| 2016-10 | 9 | 596 | 1,51 % |
| 2016-11 | 47 | 2.525 | 1,86 % |
| 2016-12 | 1 | 306 | 0,33 % |

### Feuerungen je SIC-Bereich (2012–2016)

Die **SIC-Kennung** ist die vierstellige amtliche US-Branchenkennung der SEC; gruppiert wird auf die amtlichen Bereiche.

| Bereich | S-U | Nenner | Rate | S-G | Nenner | Rate |
|---|---:|---:|---:|---:|---:|---:|
| Verarbeitendes Gewerbe | 393 | 24.266 | 1,62 % | 353 | 33.878 | 1,04 % |
| Dienstleistungen | 160 | 12.458 | 1,28 % | 185 | 16.739 | 1,11 % |
| Finanzen, Versicherung, Immobilien | 126 | 9.670 | 1,30 % | 93 | 8.215 | 1,13 % |
| Transport, Kommunikation, Versorger | 64 | 5.951 | 1,08 % | 57 | 8.000 | 0,71 % |
| Bergbau und Rohstoffgewinnung | 63 | 3.527 | 1,79 % | 87 | 6.699 | 1,30 % |
| Einzelhandel | 23 | 3.968 | 0,58 % | 43 | 4.836 | 0,89 % |
| Grosshandel | 20 | 2.008 | 1,00 % | 34 | 2.659 | 1,28 % |
| Bau | 14 | 808 | 1,73 % | 14 | 848 | 1,65 % |
| Land- und Forstwirtschaft, Fischerei | 11 | 320 | 3,44 % | 6 | 567 | 1,06 % |
| Nicht klassifiziert (SEC-Sammelcode) | 2 | 30 | 6,67 % | 0 | 170 | 0,00 % |

### Feuerungen je Kalenderjahr (2012–2016)

| Jahr | S-U | S-G | S-UG |
|---|---:|---:|---:|
| 2012 | 125 | 114 | 8 |
| 2013 | 204 | 232 | 7 |
| 2014 | 182 | 165 | 12 |
| 2015 | 175 | 141 | 7 |
| 2016 | 191 | 220 | 7 |

Die vollständige Kreuztabelle Monat × Bereich steht in der JSON-Fassung dieses Reports (`kreuz_monat_sektor`); sie hier abzudrucken würde den Report nur aufblähen.

## 5. Die drei Prüfschritte

### Prüfschritt 1 — Naht-Invariante

Frage: steht im fertigen Ergebnis auch nur **eine** Wachstums- oder Beschleunigungszahl, deren beide Enden verschiedene Umsatz-Quellen tragen? Antwort: **0** (gefordert: 0) — davon 0 Wachstums- und 0 Beschleunigungswerte. Ergebnis: **bestanden**.

Der Nachzähler ist **unabhängig vom Wächter**: er prüft nicht, ob der Wächter aufgerufen wurde, sondern zählt am Ergebnis nach. Beim Gegenprobe-Lauf wurde der Wächter absichtlich ausgebaut — dann geht diese Zahl über null und der Selbsttest wird rot. Die rote Meldung steht wörtlich in Abschnitt 10.

### Prüfschritt 2 — Belegungs-Glätte

Anteil der Firmen mit mindestens einem auswertbaren Umsatz-Quartal je Kalenderjahr. Nenner: Firmen mit mindestens einem periodischen Bericht in diesem Jahr. Ein Sprung von über 5,0 Prozentpunkten zwischen Nachbarjahren wäre fast immer ein Datenbruch, kein Marktereignis.

| Jahr | Firmen gesamt | davon mit Umsatz-Quartal | Anteil |
|---|---:|---:|---:|
| 2012 | 8.456 | 4.731 | 55,95 % |
| 2013 | 8.127 | 4.689 | 57,70 % |
| 2014 | 7.950 | 4.696 | 59,07 % |
| 2015 | 7.732 | 4.666 | 60,35 % |
| 2016 | 7.193 | 4.407 | 61,27 % |

Größter Sprung zwischen Nachbarjahren: **1,75 Punkte** → **bestanden**.

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

Der Anteil liegt über 10 % — die **vorab festgelegte** Folgeregel greift: die Quelle wird künftig **je Firma** fixiert (längste Serie) statt je Quartal. Diese Regel stand vor der Messung fest, sie wurde hier nicht erfunden. **Sie ist in dieser Etappe noch nicht angewandt** — das wäre eine Änderung der präregistrierten Rechenvorschrift und gehört in die nächste Etappe.

## 6. Was nicht berechenbar war (Regel R5)

Nie geschätzt, nie auf null gesetzt — jeder Fall mit Grund gezählt.

| Fall | Anzahl |
|---|---:|
| Bericht ohne Veröffentlichungszeitpunkt | 0 |
| Bericht ohne brauchbare Branchenkennung | 55 |
| Bericht ohne Firmennummer | 0 |
| Bericht ohne Geschäftsjahresende | 0 |
| Bericht ohne lesbaren Berichtszeitraum | 0 |
| periodische Berichte gesamt (nachrichtlich) | 170.610 |
| Betriebsergebnis: Jahrespaar kein volles Kalenderjahr (nachrichtlich) | 213 |
| Betriebsergebnis: kein Vorjahresquartal | 30.739 |
| Betriebsergebnis: kein Vorquartal | 14.126 |
| Betriebsergebnis: kein Vorquartal für die zweite Beschleunigung | 11.962 |
| Betriebsergebnis: Trailing-Fenster zu dünn | 42 |
| Betriebsergebnis: Summen-Quelle unvollständig | 0 |
| Betriebsergebnis: symmetrischer Nenner ist null | 10 |
| Betriebsergebnis: viertes Quartal abgeleitet (nachrichtlich) | 18.769 |
| Betriebsergebnis: viertes Quartal nicht ableitbar | 12.497 |
| Betriebsergebnis: Quellen-Naht | 47 |
| geprüfte Datenzeilen der Zielkennungen (nachrichtlich) | 2.158.042 |
| Nettoergebnis (Diagnose): Jahrespaar kein volles Kalenderjahr | 322 |
| Nettoergebnis (Diagnose): kein Vorjahresquartal | 38.762 |
| Nettoergebnis (Diagnose): kein Vorquartal | 17.658 |
| Nettoergebnis (Diagnose): kein Vorquartal für die zweite Beschleunigung | 0 |
| Nettoergebnis (Diagnose): keine Schwelle (Diagnose hat keine) | 0 |
| Nettoergebnis (Diagnose): Summen-Quelle unvollständig | 0 |
| Nettoergebnis (Diagnose): symmetrischer Nenner ist null | 183 |
| Nettoergebnis (Diagnose): viertes Quartal abgeleitet | 18.127 |
| Nettoergebnis (Diagnose): viertes Quartal nicht ableitbar | 18.893 |
| Nettoergebnis (Diagnose): Quellen-Naht | 65 |
| Größe steht in mehreren Berichtsfassungen (frühester gewinnt) | 363.442 |
| Größe wurde später mit ANDEREM Wert erneut gemeldet | 55.290 |
| Größen nach der Zeitpunkt-Bereinigung (nachrichtlich) | 594.429 |
| Datenzeilen nach allen Filtern (nachrichtlich) | 1.194.307 |
| Umsatz: Jahrespaar kein volles Kalenderjahr (nachrichtlich) | 136 |
| Umsatz: kein Vorjahresquartal im Fenster 330–380 Tage | 26.499 |
| Umsatz: kein Vorquartal im Fenster 80–110 Tage | 12.348 |
| Umsatz: kein Vorquartal für die zweite Beschleunigung | 10.332 |
| Umsatz: Trailing-Fenster trägt weniger als 200 Werte | 56 |
| Umsatz: Summen-Quelle unvollständig (nur eine Komponente) | 1.438 |
| Umsatz: symmetrischer Nenner ist null | 0 |
| Umsatz: viertes Quartal erfolgreich abgeleitet (nachrichtlich) | 12.271 |
| Umsatz: viertes Quartal nicht ableitbar (Komponente fehlt) | 15.371 |
| Umsatz: viertes Quartal abgeleitet, aber ein Vorquartal war <= 0 (nachrichtlich) | 1.795 |
| Umsatz: Partnerquartal trägt eine andere Quelle (Quellen-Naht) | 2.663 |
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
| Jahrespaare, deren Abstand kein volles Kalenderjahr ist | 136 |

Diese Firmen sind also **nicht ignoriert** — sie sind gezählt und laufen normal mit. Was fehlt, ist die Möglichkeit, das einzelne 53-Wochen-Jahr zu markieren; das steht als offene Frage in Abschnitt 9.

## 7. Diagnose: trägt `NetIncomeLoss` mehr als `OperatingIncomeLoss`?

Reine Diagnose — kein Signal, keine Schwelle, keine Kalibrierung. Sie soll der nächsten Etappe erlauben, **mit Zahlen** zu entscheiden, falls S-G zu dünn trägt. `NetIncomeLoss` ist das Ergebnis nach Steuern, `OperatingIncomeLoss` das Betriebsergebnis.

| Größe | NetIncomeLoss | OperatingIncomeLoss |
|---|---:|---:|
| Firmen mit auswertbarer Quartalsreihe | 10.128 | 8.191 |
| Wachstumswerte g | 136.156 | 111.495 |
| Beschleunigungswerte a | 118.491 | 97.365 |
| Firmen mit mindestens einem g | 9.959 | — |

## 8. Scheiternskriterien — vorab festgelegt

| Kriterium | Stand |
|---|---|
| K1 — S-U unter 300 Firmen mit reifem Erst-Ereignis | 487 → nicht gegriffen |
| K2 — unter 50 % der Firmen mit 8-Quartals-Kette haben ein Umsatz-Wachstumsquartal | 66,94 % von 7.973 → nicht gegriffen |
| K3a — über 50 % der S-U-Feuerungen in einem SIC-Bereich | 44,86 % (Verarbeitendes Gewerbe) → nicht gegriffen |
| K3b — über 40 % der S-U-Feuerungen in einem Kalenderjahr | 23,29 % (2013) → nicht gegriffen |
| K4 — Naht-Invariante ungleich 0 oder Belegungssprung über 5 Punkte | Naht 0, Sprung 1,75 → nicht gegriffen |

S-G und S-UG dürfen **einzeln** scheitern, ohne die Signalfamilie zu kippen.

## 9. Neue Fragen und Hypothesen (Pflichtblock nach R16)

- **Banken-Sonderfamilie ja/nein?** Der Bereich „Finanzen, Versicherung, Immobilien" stellt laut E1 die zweitgrößte Firmengruppe, hat aber ein anderes Umsatzverständnis (Zinsertrag statt Warenverkauf). Hier trägt er 14,38 % der S-U-Feuerungen. Zu klären: eigene Signalfamilie, Ausschluss oder unverändert mitlaufen lassen — mit Vorab-Kriterium, nicht nach Ergebnislage. (Zeitschätzung: 1–2 Tage)
- **`NetIncomeLoss` als Alternative für S-G?** Das Ergebnis nach Steuern liefert 118.491 Beschleunigungswerte gegen 97.365 beim Betriebsergebnis. Ob die zusätzliche Tiefe die schlechtere Aussagekraft (Einmaleffekte, Steuerquote) aufwiegt, ist eine Vorab-Entscheidung der nächsten Etappe — nicht nachträglich nach Ergebnis auswählbar. (Zeitschätzung: 1 Tag)
- **Aktienzahl-Abdeckung für die Je-Aktie-Rechnung (R10).** Der Endpunkt-Wächter verlangt eine Pflicht-Nebenrechnung „Umsatz je Aktie". Laut E1 steht `CommonStockSharesOutstanding` in 70 % der periodischen Berichte — ob das nach denselben Filtern (Konzern-Zeilen, amtliche Taxonomie, Zeitpunkt-Regel) reicht, ist ungemessen. Das ist die nächste Pflichtmessung, bevor R10 präregistriert wird. (Zeitschätzung: 1 Tag)
- **Quellenwahl je Firma statt je Quartal.** Prüfschritt 3 hat die vorab festgelegte Schwelle gerissen (15,51 % der überlappenden Firmen-Quartale liegen über 5 Punkten auseinander). Die Regel verlangt, die Quelle künftig je Firma zu fixieren. Offen: um wie viel schrumpft dadurch die Fallzahl, und ändert sich die Feuerrate? Beides muss vor der Umstellung gemessen und präregistriert werden. (Zeitschätzung: 1 Tag)
- **Wie viel kostet die Naht?** 2.663 Firmen-Quartale sind nur deshalb nicht berechenbar, weil die Firma zwischen zwei Quartalen die Umsatz-Kennung wechselt. Offen: Sind das Zufallswechsel oder systematisch dieselben Firmen (dann fehlt eine ganze Firmenklasse)? Und: wäre eine Verkettung über einen Überlappungsfaktor verantwortbar, oder ist das genau die Sorte stiller Annahme, die diese Studie verbietet? (Zeitschätzung: 1–2 Tage)
- **53-Wochen-Geschäftsjahre sichtbar machen.** Der Stichtag `ddate` ist in dieser Quelle auf das Monatsende gerundet, deshalb ist ein 53-Wochen-Jahr über den Stichtagsabstand unsichtbar. Messbar wäre es über das Geschäftsjahresende `fye` im Berichtskopf (639 Firmen mit wanderndem Ende, davon 425 mit Umsatzreihe) oder über das echte Periodenende in den Original-Einreichungen. Offen: Verzerrt das zusätzliche Quartal die Wachstumsrate dieser Firmen systematisch nach oben — und liegen sie deshalb häufiger unter den Feuerungen? (Zeitschätzung: 1 Tag)
- **Was bedeutet der Deckel bei ±2?** Wie viele Wachstumswerte laufen tatsächlich in die Begrenzung, und sind das dieselben Firmen (Neulinge aus dem Nichts) wie die späteren Signalträger? Wenn ja, misst das Signal womöglich vor allem Basiseffekte kleiner Ausgangszahlen. (Zeitschätzung: 0,5 Tage)

## 10. Woran das hier verifiziert wurde

**a) Selbsttest gegen eine kleine, selbst gebaute Datenbank.** Geprüft wird gegen acht Fixture-Firmen, deren Erwartungswerte von Hand nachgerechnet sind — unter anderem: die Zeitpunkt-Regel (früherer Bericht 100 schlägt späteren 999), die Ableitung des vierten Quartals (100 − (10+20+30) = 40), das symmetrische Wachstum (20/110 = 0,181818…), der Quellenwechsel als Naht, der 53-Wochen-Fall, und alle drei Signal-Bedingungen einzeln — jede einmal erfüllt und einmal verletzt. Jede Prüfung wird in **beide** Richtungen gestellt: die gültige Form muss durchgehen, die kaputte muss auffliegen.

**b) Jede Prüfung einmal absichtlich kaputtgemacht.** Ein Wächter, den man nie rot gesehen hat, ist eine Zeremonie. Protokoll:

*Prüfschritt 1 — Naht-Wächter* — Sabotage: `basis_gleich` liefert statt des Vergleichs immer `True`.

```
  ROT   Firma 3000: Quellenwechsel erzeugt VIER Naht-Faelle   (ist: 0 | soll: 4)
  ROT   Firma 3000 hat kein einziges Wachstum ueber die Naht
  ROT   Naht-Invariante ist null (gueltige Form geht DURCH)   (ist: 4 | soll: 0)
  SELBSTTEST ROT — 3 Pruefung(en) gescheitert (Exit-Code 1)
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

**c) Nachrechnung von außen.** Drei Feuerungen und eine abgeleitete Q4-Zahl wurden mit **eigenem Code und eigenen Datenbank-Abfragen** neu berechnet. Vom Skript stammt dabei nur die Behauptung „hier feuert es"; die Zahlen dahinter wurden ohne eine einzige seiner Funktionen aus dem Panel neu geholt und neu gerechnet — Wachstum, beide Beschleunigungen und der Schwellenvergleich stimmen auf neun Nachkommastellen überein; die Q4-Ableitung (1.163.096 − 816.610 − 3.837 − 3.804 = 338.845) ebenfalls.

**d) Plausibilitätsanker gegen E1.** Die unabhängig nachgezählte Zahl der Firmen mit mindestens acht Berichtsquartalen am Stück trifft den E1-Report exakt (7.973).

**e) Wiederaufnahme (R15c).** Der Lauf arbeitet in Häppchen und vermerkt jedes abgeschlossene. Ein zweiter Lauf über dieselbe Arbeitsdatei verdoppelt nichts — das ist eine eigene Selbsttest-Prüfung.

---

*Erzeugt 2026-08-19T09:05:51+00:00 · Python 3.12.10 · SQLite 3.49.1 · nur Standardbibliothek und sqlite3 (R14c).*
