# T156 — Einmalertrags-Lampe x Wachstums-Bonus: der Zaehl-Lauf auf eingefrorenem Boden

**Datum:** 2026-09-19 · **Lane D (Daylauf 19.09.)** · **Klasse:** Diagnose, kein Bau
**Messstand:** CI-Artefakt `snapshots` des Daily-Yahoo-Pull-Laufs **35319115201** (2026-09-18T07:22Z),
16.027 Dateien, 16.022 nach Watchlist-Filter, 9.520 gescorte Zeilen.
**Die uebrigen Eingaben** (Engine, `watchlist.json`, `external-data/**`) sind git-versioniert und
ueber den Commit gebunden: `repoCommit 27fb7a90a2`, `watchlistSha256 8ba42d06949b265a` — beides
steht im JSON unter `codeStand`, damit der Lauf wiederholbar ist. Zweitlauf mit denselben Eingaben:
Zahlen identisch (27 / 8 / 33 / 1.139 / 2.569).
**Skript:** `scripts/t156-einmalertrag-bonus-schnittmenge.js` · **Rohdaten:** `reports/t156-einmalertrag-bonus-2026-09-19.json`
**Waechter:** `tests/t156-schnittmenge.test.js` (6/6, Sabotage einmal rot gesehen)

---

## AUF EINEN BLICK

**Die Kipp-Bedingung des Rats ist erfuellt: die Lampe liest deutlich mehr als "grob ein Fuenftel"
der geflaggten Zeilen falsch — gemessene Falsch-Positiv-Rate 41,7 % auf dem urteilsfaehigen Teil,
und schon EIN weiterer Fehlalarm unter den 15 ungeprueften Faellen reicht, um die Marke auch auf
der Gesamtmenge zu reissen; dieser eine Fall liegt mit Quelle vor (5522.TW).**
Damit ist **W1 (a) nach dem eigenen Kriterium des Rats heute nicht festzuzurren** (~90 %).

- **Teil 1 (Sichtung + FP-Rate):** 27 Zeilen in der Schnittmenge. 12 tragen ein Handurteil vom
  30.07. (7 ECHT / 5 FEHLALARM = **41,7 % FP**), 15 sind ungeprueft und namentlich gelistet.
  Einer der 15 (**5522.TW**) ist hier mit Primaerquelle als Fehlalarm belegt -> **>= 6 von 27 = 22,2 %**.
- **Teil 2 (Provenienz 20/19):** bestaetigt — die Zahl stammt aus einem Finder-Lauf ohne
  eingefrorenes Universum und darf keine Prioritaet tragen. **Ersatz liegt jetzt vor:** 27 statt 20,
  auf EINEM Lauf gemessen. Die Rangwechsel-Haelfte ("19 von 20") ist **nicht** nachgemessen.
- **Teil 3 (nie gezaehlte Gegenrichtung):** erstmals gezaehlt. Bonus feuert, Spitze >= 50 % ist da,
  Lampe schweigt: **8 Zeilen** durch den Anlauf-Schutz, **33 Zeilen** wegen ungleicher Kadenz,
  und darueber hinaus kann die Lampe ueber **2.569 der 4.720 bonus-tragenden Zeilen (54,4 %)
  ueberhaupt nicht urteilen**. Die Population ist also **groesser als die Schnittmenge**, genau wie
  der Advocatus vermutete.
- **Sprungbrett:** §1 Messanordnung · §2 Teil 1 · §3 Teil 2 · §4 Teil 3 · §5 Was offen bleibt.

---

## 1. Messanordnung — warum dieser Boden zaehlt und der lokale Bestand nicht

T156 verbietet die naheliegende Abkuerzung: der lokale `snapshots/`-Bestand (15.046 Dateien,
juengste Schreibzeit 29.08.) ist ueber Wochen gewachsen, seine Zeilen stammen aus verschiedenen
Laeufen und Codestaenden. Eine Zaehlung darauf vermengt Code-, Daten- und Kohortenwirkung — genau
die Kontamination, deren Ausschluss T156 zur Bedingung macht.

Gemessen wurde deshalb auf dem **`snapshots`-Artefakt eines einzelnen CI-Laufs**: ein Universum zu
EINEM Zeitpunkt unter EINEM Codestand, per Konstruktion eingefroren. Gefahren wird die
**Produktions-Engine** (`scoreUniverse` mit den Produktions-Formeln, Watchlist-Filter und
SEC-Merge wie in `scripts/score-digest.js`) — die Lampen-Zustaende und der Bonus-Faktor kommen
aus dem Lauf selbst (`e.lamps`, `e.einmalertragBewertbarkeit`, `e._factorGrowth`), nicht aus einer
zweiten Auswertung.

> **Stolperstein, der real zuschlug und deshalb einen Waechter hat:** `scoreUniverse()` loescht
> `e.snapshot` am Ende (`src/scoring/score.js:1359`). Der erste Lauf dieses Skripts fragte die
> Lampe danach ab und meldete sauber aussehend **"Lampe an: 0, nicht bewertbar: 9.520 von 9.520"**
> — eine stille Nullzaehlung, die eine Ratsfrage mit einem Artefakt beantwortet haette.
> `tests/t156-schnittmenge.test.js` nagelt genau diesen Ausgang fest (einmal absichtlich gebrochen,
> rot gesehen).

**Gegenprobe aus einer zweiten, unabhaengigen Quelle:** der Produktions-Vintage
`board-history/2026-09-18/` (vom Lauf selbst geschrieben, nicht von diesem Skript) traegt in seinen
Board-Zeilen **genau 35 Zeilen mit der Lampe `einmalertrag`** — dieselbe Zahl wie der Zaehl-Lauf,
und **keine** davon fehlt in meiner Lampen-Menge. Die Zaehlung misst also das, was auch im Produkt
steht.

**Vorbefund, der die Weiche mitbestimmt:** die Lampe ist heute **kein reines Anzeigefeld mehr**.
`src/scoring/score.js:374` blendet fuer eine brennende Zeile fuenf Achsen
(`revGrowthLevel`, `revAcceleration`, `gpGrowth`, `ruleOfX`, `capitalEfficiency`) auf `null`.
Der Wachstums-Bonus liest den Snapshot dagegen unbeeindruckt weiter — **das ist die
Selbstaufhebung, um die W1 streitet**, und sie ist auf diesem Lauf an 27 Zeilen aktiv.

## 2. Teil 1 — die Sichtung und die Falsch-Positiv-Rate

**Schnittmenge (Lampe an UND Bonus > 1): 27 Zeilen** von 9.520 gescorten; 35 Zeilen tragen die
Lampe insgesamt, 8 davon ohne Bonus.

| Ticker | Kohorte | Anteil Spitze | Spitzenquartal | Bonus | Urteil 30.07. |
| --- | --- | --- | --- | --- | --- |
| ZEAL.VI | health-care\|profitable | 0,983 | 2025-06-30 | 1,0494 | ECHT |
| ABUS | health-care\|unprofitable | 0,986 | 2026-03-31 | 1,0196 | ECHT (Folgequartal offen) |
| BEAM | health-care\|unprofitable | 0,731 | 2025-12-31 | 1,0176 | ECHT |
| ABCL | health-care\|unprofitable | 0,678 | 2025-12-31 | 1,0271 | ECHT |
| VRDN | health-care\|unprofitable | 0,992 | 2025-09-30 | 1,0456 | ECHT |
| LKFT | health-care\|unprofitable | 0,909 | 2025-12-31 | 1,0350 | ECHT |
| MGTX | health-care\|unprofitable | 0,809 | 2026-06-30 | 1,0432 | ECHT |
| 301638.SZ | it-services\|profitable | 0,579 | 2025-12-31 | 1,0445 | FEHLALARM |
| 4325.SR | real-estate\|profitable | 0,510 | 2025-09-30 | 1,0034 | FEHLALARM |
| 7828.TWO | industrials\|profitable | 0,513 | 2025-12-31 | 1,0470 | FEHLALARM |
| BXBL | consumer-discretionary\|unprofitable | 0,528 | 2026-03-31 | 1,0463 | FEHLALARM |
| QUBT | tech-hardware\|unprofitable | 0,565 | 2026-06-30 | 1,0450 | FEHLALARM |
| **5522.TW** | real-estate\|profitable | 0,594 | 2025-12-31 | 1,0484 | **FEHLALARM (heute belegt, s. u.)** |
| 1808.TW | real-estate\|profitable | 0,539 | 2025-12-31 | 1,0475 | ungeprueft |
| 420770.KQ | semiconductors\|profitable | 0,589 | 2025-12-31 | 1,0394 | ungeprueft |
| 475150.KS | utilities\|profitable | 0,640 | 2025-12-31 | 1,0251 | ungeprueft |
| 603389.SS | consumer-discretionary\|unprofitable | 0,655 | 2025-12-31 | 1,0491 | ungeprueft |
| 8926.TW | industrials\|profitable | 0,708 | 2026-03-31 | 1,0494 | ungeprueft |
| DBV.PA | health-care\|unprofitable | 0,551 | 2025-09-30 | 1,0114 | ungeprueft |
| FDMT | health-care\|unprofitable | 0,925 | 2025-12-31 | 1,0456 | ungeprueft |
| IDYA | health-care\|unprofitable | 0,888 | 2025-09-30 | 1,0456 | ungeprueft |
| JHSF3.SA | real-estate\|profitable | 0,571 | 2025-12-31 | 1,0459 | ungeprueft |
| OGG | materials\|profitable | 0,515 | 2026-06-30 | 1,0497 | ungeprueft |
| SHAZ | it-services\|profitable | 0,625 | 2026-06-30 | 1,0500 | ungeprueft |
| SIM | materials\|profitable | 0,561 | 2025-12-31 | 1,0010 | ungeprueft |
| SWANDEF.BO | industrials\|unprofitable | 0,837 | 2026-03-31 | 1,0407 | ungeprueft |
| UROY | energy\|profitable | 0,806 | 2026-04-30 | 1,0497 | ungeprueft |

**Die Rate, ehrlich gerechnet:**

- **Urteilsfaehiger Teil (12 von 27, Handpruefung `_HANDPRUEFUNG-EINMALERTRAG-2026-07-30.md`):
  5 Fehlalarme / 12 = 41,7 %.**
- **Gesamtmenge, Untergrenze:** 6 belegte Fehlalarme / 27 = **22,2 %** — schon ueber der Marke,
  selbst wenn alle uebrigen 14 echt waeren.
- **Vergleichswert der einzigen vollstaendigen Handpruefung** (52 geflaggte Firmen, 30.07.):
  30 Fehlalarme / 52 = **57,7 %**.

**Der heute neu belegte Fall — 5522.TW (Farglory Land Development):** die Zeile feuert, weil das
Quartal 2025-12-31 59,4 % der letzten vier Quartale traegt (678,1 gegen 178,6 / 274,3 / 10,3 Mio).
Das ist die **normale Umsatzerfassung eines Bautraegers bei Bauabnahme**, kein Sonderertrag: das
Unternehmen erwartet fuer 2026 hoehere Erloese als 2025, weil zwischen Q1 und Q3 mehrere Projekte
die Nutzungsgenehmigung erhalten, und die 2025 fertiggestellten Projekte "Happiness City" und
"Farglory Business Weekly" realisieren ihre Erloese im Q1 2026 weiter
([Earnings Call 11.03.2026, BigGo Finance](https://finance.biggo.com/news/TW_5522.TW_2026-03-11)).
Also genau der Fehlermodus, vor dem der Rat warnt: **ein normaler Umsatzsprung wird als
Sonderzahlung gelesen** — bei einer Firma, die der Bonus gleichzeitig hochhebt.

**Kipp-Bedingung, offen benannt:** der Satz "ueber grob einem Fuenftel" haengt an genau einem
weiteren Fehlalarm; er liegt vor. Faellt der 5522.TW-Beleg (z. B. weil jemand Bauabnahme-Erloese
doch als einmalig einstuft), steht die Rate auf 5/27 = 18,5 % und die Bedingung ist **nicht**
erfuellt. Dann entscheiden die restlichen 14 ungeprueften Faelle. Die Basisrate der Juli-Pruefung
(57,7 % Fehlalarme) macht es sehr unwahrscheinlich, dass darunter kein weiterer Fehlalarm steckt.

**Geltungsbereich:** die zwoelf uebernommenen Urteile stammen vom 30.07.; das Lampenfenster ist
seither um Quartale weitergewandert. Uebernommen sind sie nur dort, wo die Spitze mit dem damals
untersuchten Ereignis zusammenfaellt — fuer die fuenf Fehlalarme trifft das zu (Q4-Saison bzw.
laufendes Geschaeft, kein datiertes Einzelereignis), fuer die sieben ECHT-Faelle sind es dieselben
Lizenz-/Vergleichszahlungen. Eine Nachpruefung Fall fuer Fall steht aus (§5).

## 3. Teil 2 — Provenienz der Zahl 20/19

Die Antwort vom 28.08. bleibt gueltig: **20/19 stammt aus einem Finder-Lauf ohne eingefrorenes
Universum** und darf nach T156s eigenem Kriterium keine Prioritaet tragen. Nachgetragen wird hier
nur der Ersatz: auf eingefrorenem Boden sind es **27 Schnittmengen-Zeilen**, nicht 20.

**Nicht gemessen:** die zweite Haelfte der Zahl ("19 von 20 wechseln den Rang"). Ein Rangwechsel-
Zaehler verlangt einen zweiten Lauf unter einer geaenderten Semantik — das waere bereits die
Modellierung von Option (a) und damit Bau, nicht Diagnose. Die Zahl bleibt **unbelegt**; sie sollte
bis zu einer eigenen Messung nicht mehr zitiert werden.

## 4. Teil 3 — die nie gezaehlte Gegenrichtung

Gezaehlt ueber dieselben 9.520 Zeilen: Zeilen, in denen **der Bonus feuert** und die Rohbedingung
der Lampe (Spitzenquartal >= 50 % der letzten vier) **erfuellt** ist, die Lampe aber schweigt:

| Klasse | n | Was es bedeutet |
| --- | --- | --- |
| **Anlauf-Schutz** | **8** | 402340.KS, BMNR, BRUN, CRNX, KYMR, PGEN, PTGX, UMAC — die Reihe steigt monoton, die Lampe stellt sie per Regel frei. Das ist die einzige Klasse, in der die Lampe eine echte Quartalsspitze SIEHT und bewusst schweigt. |
| **ungleiche Kadenz** | **33** | Halbjahres-Eimer u. a.; die Lampe kann hier per Beschluss nicht urteilen. **Kein "haette feuern muessen"** — die Konzentration ist dort mechanisch hoch. |
| **zu wenige Quartale** | **1.139** | Bonus feuert, die Lampe hat nicht einmal vier verwertbare Quartale. Nicht urteilbar, aber die Groesse der blinden Flaeche. |

**Der Befund:** die Schnittmenge (27) ist **kleiner** als die Menge der Bonus-Zeilen mit
vorhandener Spitze und schweigender Lampe (41). Und beide verschwinden neben der vollen blinden
Flaeche: von den **4.720 bonus-tragenden Zeilen** kann die Lampe ueber **2.569 gar nicht urteilen
= 54,4 %** (`zellen.lampeNull_bonusAn` im JSON). Die drei Klassen oben sind nur der Ausschnitt mit
messbarer Spitze; wer sie fuer das Ganze haelt, unterschaetzt die Blindheit um mehr als das Doppelte.
Wer die Score-Semantik an diesem Detektor festzurrt, zurrt sie an einem fest, der auf gut der
Haelfte der betroffenen Zeilen schweigt, weil er nicht urteilen kann.

> Korrektur nach dem Codex-Kreuzreview (19.09.): hier stand zuerst "24,1 % (1.139 + 33 von 4.720)".
> Das war doppelt falsch — die Rechnung ergibt 24,8 %, und die richtige Bezugsgroesse ist die
> vollstaendige Null-Zelle (2.569), nicht die auf Konzentration >= 50 % eingeschraenkte Teilmenge.

Zwei der acht Anlauf-Faelle (**CRNX**, **KYMR**) sind in der Juli-Handpruefung als **FEHLALARM**
gefuehrt — der Anlauf-Schutz hat dort also das Richtige getan. Das ist kein Freispruch fuer die
Regel, aber es entkraeftet die naheliegende Gegenthese "der Anlauf-Schutz versteckt echte Faelle"
fuer 2 von 8.

## 5. Was offen bleibt (und was es kostet)

1. **Handsichtung der 14 verbleibenden ungeprueften Schnittmengen-Faelle** gegen Primaerquellen
   (Muster: Handpruefung 30.07.). Kosten: ~1 Motortag, weil Quellen in CN/TW/KR/BR/IN liegen.
   Wirkung: macht die FP-Rate der Gesamtmenge belastbar statt untergrenzig.
2. **Rangwechsel-Zaehler** ("19 von 20") auf demselben eingefrorenen Lauf — gehoert an die
   Semantik-Weiche, nicht in diese Diagnose.
3. **Die 1.139 blinden Bonus-Zeilen** sind eine eigene Weiche: entweder die Lampe wird auf
   kuerzeren Reihen urteilsfaehig gemacht, oder ihr Geltungsbereich wird im Produkt sichtbar
   eingeschraenkt. Beides beruehrt Methodik — nicht hier entschieden.

**Nicht beruehrt:** `src/scoring/**` und `tests/scoring/**` wurden ausschliesslich **gelesen**.
Kein Score, kein Rang, kein Board bewegt sich durch diese Diagnose.
