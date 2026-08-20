# C1 — Die Zeitleisten je Thema

**Lauf vom 20.08.2026 · Zweig `studie/c1-zeitleisten` · baut auf C0 auf**

> Karls Frage dahinter: *„Wann ist das Thema aufgekommen? Wann ist es größer
> geworden?"* — C1 beantwortet die **Ereignis-Seite**. Die Kurs-Seite ist nicht
> Gegenstand dieser Etappe und wurde nicht angefasst.

---

## 0 · Das Ergebnis in fünf Zeilen

1. **Die Verbreitungskurve steht — vollständig und belastbar.** Für alle 26 Themen die
   Zahl verschiedener US-Firmen, die den Begriff im Jahresbericht verwenden, Jahr für
   Jahr von 2001 bis 2025. 675 Auszählungen, kein einziges gedeckeltes Jahr, jede Zahl
   mit versiegelter Rohantwort.
2. **Die „öffentlich erkennbar ab"-Datierung steht für 26 von 26 Themen** — jede mit
   Datum, Quelle und Prüfsumme. Bei 9 Themen liegt das Datum auf der Untergrenze der
   Quelle und ist deshalb als **linkszensiert** markiert: älter kann sein, die Quelle
   sieht nur nicht weiter zurück.
3. **Die „fachlich erkennbar ab"-Datierung ist NICHT BRAUCHBAR.** Sie liefert zwar für
   26 von 26 Themen ein belegtes Datum — aber die Belege sind zum großen Teil
   Metadaten-Müll oder Treffer in einem anderen Wortsinn. Abschnitt 4 zeigt es an den
   Titeln. **Das ist ein Ergebnis über das Messwerkzeug, kein Ergebnis über die Themen.**
4. **Deshalb kann die interessanteste Zahl des Auftrags — der Abstand zwischen fachlich
   und öffentlich erkennbar — NICHT angegeben werden.** Der gerechnete Median von 393
   Monaten misst die Fehler der Quelle, nicht die Welt. Er steht im Bericht, damit man
   ihn nachrechnen kann, und er ist ausdrücklich **kein Befund**.
5. **Die Führungsfrage ist beantwortbar und beantwortet:** je Thema die acht frühesten
   10-K-Nennungen mit Firma, Datum, Kontextfenster und grober Rolle. 173 von 208
   Fenstern belegt. NVIDIA taucht in allen 26 Themen **genau einmal** in den frühesten
   Acht auf — bei `deep learning`, auf Platz 3, am 12.03.2015, im Geschäftsteil.

---

## 1 · Was gemessen wurde, in Karls Sprache

Drei Dinge, für alle 26 Themen **identisch**, ohne einen einzigen Handgriff, der nur
bei einem Thema stattfindet:

- **Wie viele Firmen reden darüber, Jahr für Jahr?** Gezählt werden verschiedene Firmen
  (nicht Dokumente), die den Begriff in ihrem Jahresbericht (Formular 10-K) verwenden.
  Gerechnet wird mit **demselben Code wie C0** — die Zählfunktionen werden importiert,
  nicht nachgebaut. Zeitraum 2001–2025 (2001 ist die Untergrenze der
  EDGAR-Volltextsuche, 2026 ist unvollständig).
- **Wann war das Thema erstmals datierbar sichtbar?** Fünf Sonden, für jedes Thema
  dieselben fünf: zwei fachliche (OpenAlex, Crossref — Aufsätze) und drei öffentliche
  (Wikipedia-Artikelanlage, frühestes 10-K, US-Bundesanzeiger *Federal Register*).
  Jede liefert bis zu fünf datierte Kandidaten; Anker ist der früheste **zulässige**.
- **Wer war zuerst dran, und in welcher Rolle?** Die acht frühesten 10-K-Nennungen je
  Thema, dazu aus dem Originaldokument ein Textfenster von ±400 Zeichen um den Begriff
  und eine grobe Einordnung: Anbieter, Anwender, Risikoteil oder bloße Erwähnung.

**Jedes Datum in der Ausgabe trägt die Prüfsumme der Rohantwort, aus der es stammt.**
Ein Datum ohne diese Prüfsumme lässt der Wächter nicht durch. Wo keine Sonde etwas
findet, steht **NICHT BELEGBAR** — nie eine Schätzung.

---

## 2 · Die Tabelle

`fachl.` = fachlich erkennbar ab · `öff.` = öffentlich erkennbar ab · `*` = auf der
Untergrenze der Quelle, also **linkszensiert** · `Abst.` = Abstand in Monaten ·
`Verz./Verd./Höhe/Kipp` = die vier Beschleunigungs-Punkte.

| Thema | fachl. | Quelle | öff. | Quelle | Abst. | C0-Jahr/D | Verz. | letzte Verd. | Höhepunkt (D) | Kipp |
| --- | --- | --- | --- | --- | ---: | --- | --- | --- | --- | --- |
| transparency *(Sprachmode)* | 1901-02-01 | crossref | 1994-01-03 | fedreg * | 1115 | 2004/395 | — | 2010 | 2025 (3624) | — |
| solar power | 1908-02-08 | crossref | 1994-04-15 | fedreg * | 1034 | 2008/72 | — | 2011 | 2023 (264) | — |
| cloud | 1902-12 | crossref | 1994-01-03 | fedreg * | 1093 | 2010/318 | — | 2016 | 2025 (3122) | — |
| 3d printing *(Verwechsler)* | 1950-07-01 | openalex | 1994-10-24 | fedreg * | 531 | 2014/25 | — | 2016 | 2022 (73) | — |
| internet of things | 1969-12-31 ⚠ | openalex | 2007-07-02 | wikipedia | 451 | 2014/50 | 2013 | 2018 | 2022 (386) | — |
| software-defined networking | 1997-01-01 | openalex | 2011-10-24 | wikipedia | 177 | 2014/24 | 2013 | 2016 | 2018 (43) | **2025** |
| wearables | 1988-06 | crossref | 2001-05-23 | fedreg | 155 | 2014/34 | 2015 | 2017 | 2022 (104) | — |
| additive manufacturing *(Verwechsler)* | 1900-01-01 | openalex | 1994-11-01 | fedreg * | 1138 | 2015/23 | — | 2016 | 2023 (67) | — |
| apple pay | 2014-09-10 | crossref | 2013-03-01 | edgar | **−18** | 2015/24 | 2015 | 2017 | 2024 (52) | — |
| augmented reality | 1969-12-31 ⚠ | openalex | 2002-09-15 | wikipedia | 393 | 2015/21 | — | 2020 | 2023 (154) | — |
| machine learning | 1910-01-01 ⚠ | openalex | 1997-04-10 | fedreg | 1047 | 2015/44 | — | 2024 | 2025 (1616) | — |
| connected home | 1979-04-18 | openalex | 2002-06-28 | edgar | 278 | 2016/36 | — | 2016 | 2018 (48) | — |
| virtual reality | 1969-12-31 ⚠ | openalex | 1994-05-27 | fedreg * | 293 | 2016/38 | — | 2019 | 2022 (153) | — |
| autonomous vehicles | 1979-08-20 | openalex | 2006-03-16 | edgar | 319 | 2017/42 | 2018 | 2020 | 2022 (144) | — |
| blockchain *(Verwechsler)* | 1984-01-01 ⚠ | openalex | 2014-03-28 | edgar | 362 | 2017/24 | 2016 | 2023 | 2025 (409) | — |
| cryptocurrencies | 2010-05-16 | openalex | 2015-02-13 | edgar | 57 | 2018/70 | 2018 | 2024 | 2025 (228) | — |
| deep learning | 1969-12-31 ⚠ | openalex | 2011-07-20 | wikipedia | 499 | 2018/27 | 2017 | 2021 | 2025 (95) | — |
| natural language processing | 1965-01-01 | openalex | 2001-03-16 | edgar * | 434 | 2019/30 | — | 2024 | 2024 (100) | — |
| green hydrogen *(Verwechsler)* | 1995-07-01 | openalex | 2012-01-31 | edgar | 198 | 2021/28 | 2021 | 2024 | 2024 (69) | — |
| quantum computing | 1990-08-23 | openalex | 2001-10-21 | wikipedia * | 134 | 2021/24 | — | 2025 | 2025 (166) | — |
| reimagined *(Sprachmode)* | 1989-05 | crossref | 2014-02-24 | edgar | 297 | 2021/30 | — | 2023 | 2022 (56) | — |
| advanced machine learning | 1992 | crossref | 1998-01-08 | fedreg | 72 | 2022/25 | — | 2024 | 2025 (40) | — |
| digital twin | 1970-12-01 ⚠ | openalex | 2015-09-22 | wikipedia | 537 | 2022/25 | — | 2024 | 2023 (35) | — |
| proof of stake | 2014-01-01 | openalex | 2013-11-20 | wikipedia | **−2** | 2022/27 | — | 2024 | 2025 (53) | — |
| **Metaverse** `MANDAT` | 1970-01-01 ⚠ | crossref | 2005-02-08 | wikipedia | 421 | — | 2022 | 2024 | 2023 (84) | — |
| **Cannabis** `MANDAT` | 1900 | crossref | 1994-02-25 | fedreg * | 1129 | — | 2014 | 2020 | 2022 (298) | — |

⚠ = fachlicher Anker mit erkennbar kaputtem Quell-Datum, siehe Abschnitt 4.

### Die Firmenzahl-Reihen 2001 → 2025

Jede Zeile: 25 Jahreswerte, 2001 links, 2025 rechts.

```
transparency                   86  133  307  394  453  581  597 1189 2469 2012 1884 1873 1744 1736 1733 2000 2218 2447 2506 2456 2511 3032 3093 3455 3624
solar power                    11    8   13   17   18   23   38   72  162  192  202  214  218  215  210  212  202  201  201  208  235  261  264  253  231
cloud                         113   99  117  121   99  102  100  123  190  318  518  664  795  951 1192 1847 1559 1450 2448 2575 2814 3023 2863 3108 3122
3d printing                     1    0    0    1    1    1    1    1    1    2    3    4   11   25   38   31   33   43   48   49   56   73   70   63   58
internet of things              0    0    0    0    0    0    0    0    0    1    6    9   17   50  114  181  233  292  308  340  358  386  355  321  297
software-defined networking     0    0    0    0    0    0    0    0    0    0    0    3   13   24   34   40   37   43   40   40   35   36   30   29   15
wearables                       0    1    0    0    2    3    4    5    5    5    6    5    5   34   61   75   69   83   82   86   87  104  104   95   88
additive manufacturing          1    2    1    0    3    5    4    5    4    3    5    6    7   19   23   26   28   34   38   38   46   65   67   57   51
apple pay                       0    0    0    0    0    0    0    0    0    0    0    0    1    5   24   37   34   33   36   42   39   48   44   52   49
augmented reality               0    0    2    2    2    1    0    0    1    5    9    5   12   19   21   27   44   79   93   99  111  146  154  136  123
machine learning                2    2    1    1    2    2    4    9    8    7    9    8   14   29   44   62  136  236  338  425  572  839  869 1220 1616
connected home                  0    2    2    3    5    6    9   12   12   11   12   15   11   21   29   36   39   48   45   41   33   34   33   33   28
virtual reality                26   17   16   13   15   14   14   12   13   10   14    8   11   10   18   38   78  107  108  113  130  153  146  134  119
autonomous vehicles             0    0    0    0    0    2    2    2    2    2    1    1    3    5    6   19   42   69   88   89  110  144  131  113  107
blockchain                      0    0    0    0    0    0    0    0    0    0    0    0    0    2    7   12   24  136  179  182  234  391  400  379  409
cryptocurrencies                0    0    0    0    0    0    0    0    0    0    0    0    0    0    4    2    5   70   67   64   97  201  205  194  228
deep learning                   0    0    0    0    0    0    0    0    0    0    0    0    0    1    3    6   12   27   39   41   60   76   78   87   95
natural language processing     8    9   12    8   10    7    5    3    7    7    8   11   11   14   14    9   14   19   30   37   50   80   77  100   96
green hydrogen                  0    0    0    0    0    0    0    0    0    0    0    1    0    0    1    1    0    1    1    4   28   40   56   69   39
quantum computing               0    0    0    0    1    1    2    2    2    2    2    3    4    4    5    5    7    7    9   14   24   60   70  111  166
reimagined                      0    0    0    0    0    0    0    0    0    0    0    0    0    2    1    2    5    7   10    7   30   56   50   52   53
advanced machine learning       0    0    0    0    0    0    0    0    0    0    0    0    0    0    0    2    9    5    7    6   12   25   30   27   40
digital twin                    0    0    0    0    0    0    0    0    0    0    0    0    0    0    0    0    2    2    5    7   15   25   35   33   29
proof of stake                  0    0    0    0    0    0    0    0    0    0    0    0    0    0    2    0    1    7    5    4    9   27   32   35   53
Metaverse                       0    0    0    0    0    0    0    0    0    0    0    0    0    0    0    0    1    0    0    0    1   54   84   66   50
Cannabis                        1    2    2    3    2    1    3    1    2    3    4    5   13   64  105  103  117  147  220  238  264  298  282  249  207
```

**Was daran auffällt, rein deskriptiv:** Die beiden eingebauten Sprachmoden verhalten
sich nicht wie Rauschen — `transparency` ist mit 3624 Firmen im Jahr 2025 die **größte
Reihe der ganzen Tabelle**, größer als `cloud` (3122) und `machine learning` (1616).
`reimagined` verzehnfacht sich zwar nie, wächst aber von 2 (2014) auf 53 (2025). **Wer
Themen an der Höhe oder am Wachstum der Nennungszahl erkennen will, erkennt zuerst die
Floskeln.** Das ist der Grund, warum die Negativ-Kontrollen in der Liste stehen — und
sie haben beim ersten Kontakt sofort etwas geleistet.

**Nur ein einziges Thema ist gekippt:** `software-defined networking`, 2025 auf 15
Firmen nach 43 im Höhepunktjahr 2018. Neun Themen stehen 2025 auf ihrem Höchststand.

---

## 3 · Wie viele Themen sauber datiert werden konnten

| | Zahl | Anmerkung |
| --- | ---: | --- |
| Themen insgesamt | 26 | 24 Regel + 2 Mandat, keins ausgelassen |
| Verbreitungskurve vollständig 2001–2025 | **26 / 26** | 675 Auszählungen, **0 gedeckelte Jahre** |
| „öffentlich erkennbar ab" belegt | **26 / 26** | davon **9 linkszensiert** |
| „fachlich erkennbar ab" belegt | 26 / 26 | **aber inhaltlich unbrauchbar, s. u.** |
| Führung: Kontextfenster belegt | **173 / 208** | 35 mit ausgewiesenem Grund |

**Es gibt kein Thema, bei dem die Datierung ganz gescheitert ist.** Gescheitert ist eine
ganze **Ebene**: die fachliche.

Die neun linkszensierten öffentlichen Anker: `transparency`, `solar power`, `cloud`,
`3d printing`, `additive manufacturing`, `virtual reality`, `natural language
processing`, `quantum computing`, `Cannabis`. Bei ihnen heißt das Datum nicht „da fing
es an", sondern „so weit reicht die Quelle zurück".

Die Sonde, die den öffentlichen Anker setzte: Federal Register 10×, Wikipedia 8×,
EDGAR 8×. **Alle drei tragen** — keine ist Beiwerk.

---

## 4 · Der Abstand fachlich → öffentlich: warum die Zahl nicht geliefert wird

Gerechnet ergibt sich: n=26, Minimum −18 Monate, **Median 393 Monate (≈ 33 Jahre)**,
Maximum 1138 Monate. **Diese Zahl ist wertlos**, und zwar aus einem Grund, den man an
den Belegen selbst sieht. Zwei Fehlerarten, beide mechanisch nachweisbar:

**(a) Kaputte Datumsangaben in der Quelle.** Vier Anker tragen exakt `1969-12-31` — das
ist der Unix-Zeitrechnungs-Platzhalter, kein Datum. Und die Titel verraten den Rest:

| Thema | Anker | Titel des Belegs |
| --- | --- | --- |
| machine learning | 1910-01-01 | *A Study on Financial Fraud Detection Method Using Machine Learning* |
| deep learning | 1969-12-31 | *Early Detection of Life-Threatening Cardiac Arrhythmias Using Deep …* |
| blockchain | 1984-01-01 | *What drives adoption of smart contract? … blockchain* |
| digital twin | 1970-12-01 | *Personalised Transdermal Therapy for Chronic Pain with Digital Twin Technology* |
| software-defined networking | 1997-01-01 | *Software-Defined Networking (SDN)-based IPsec Flow Protection* |

Kein Mensch hat 1910 über Betrugserkennung mit maschinellem Lernen geschrieben.

**(b) Derselbe Wortlaut, anderer Sinn.** Wo der Begriff ein Alltagswort ist, findet die
Sonde völlig korrekt datierte, aber sachfremde Aufsätze:

| Thema | Anker | Titel des Belegs |
| --- | --- | --- |
| transparency | 1901-02-01 | *The transparency of aluminum for the radium radiation* |
| cloud | 1902-12 | *CLOUD BURSTS* |
| connected home | 1979-04-18 | *[A necessary complement — hospital connected home medical care]* |

**Wo die Ebene funktioniert:** genau dort, wo der Begriff eigens geprägt wurde und die
Metadaten zufällig stimmen — `green hydrogen` 1995-07-01 (*The green hydrogen report.
The 1995 progress report of the Secretary of Energy*), `proof of stake` 2014-01-01
(*Proof of Activity: Extending Bitcoin's Proof of Work via Proof of Stake*), `apple
pay` 2014-09-10 (*With Apple Pay, Apple just took payment security to the banks*),
`cryptocurrencies` 2010-05-16, `quantum computing` 1990-08-23.

**Verdikt: Der Abstand zwischen fachlicher und öffentlicher Erkennbarkeit ist mit
diesem Werkzeug nicht messbar.** Er wird nicht geschätzt, nicht bereinigt und nicht als
Befund verkauft. Die Regel wird **nicht nachträglich geändert** — eine Regel, die man
nach Sicht der Ergebnisse anpasst, ist keine Regel mehr. Der Vorschlag für einen
sauberen zweiten Anlauf steht in Abschnitt 9.

**Zwei negative Abstände** — das öffentliche Datum liegt VOR dem fachlichen — sind
selbst ein Befund und beide erklärbar: bei `apple pay` ist die früheste 10-K-Nennung
(01.03.2013) ein **Falschtreffer der Phrasensuche**; im Kontextfenster steht wörtlich
*„the Court ordered that **Apple pay** $33,561…"* aus einem Patentprozess von VirnetX
gegen Apple. Bei `proof of stake` sind es zwei Monate zwischen Wikipedia-Artikel und
Fachaufsatz — praktisch gleichzeitig.

### Nachträgliche Teilmenge — Hinweis, kein Ergebnis

Beschränkt man sich **nachträglich** (also nicht präregistriert) auf Anker mit
Tagesgenauigkeit ab 1970 ohne Platzhalter, bleiben 11 Themen mit Median **198 Monate**
(≈ 16½ Jahre). Auch diese Teilmenge enthält noch die kaputten Fälle `blockchain 1984`,
`digital twin 1970` und `Metaverse 1970`. **Die Zahl steht hier nur, damit sie
nachrechenbar ist. Sie ist kein Befund.**

---

## 5 · Die Führungsfrage — wer war zuerst dran, und als was

Je Thema die drei frühesten der acht ausgewerteten Nennungen:

| Thema | 1. | 2. | 3. |
| --- | --- | --- | --- |
| transparency | 2001-01-03 UBRANDIT COM | 2001-01-29 AEP INDUSTRIES [ANBIETER] | 2001-02-26 ADOBE SYSTEMS [ANBIETER] |
| solar power | 2001-01-08 INTELLICALL [ERWÄHNUNG] | 2001-02-05 INTELLICALL | 2001-02-13 INTELLICALL |
| cloud | 2001-01-16 ADVEST GROUP [ERWÄHNUNG] | 2001-01-29 ADVEST GROUP | 2001-02-21 LCNB CORP |
| 3d printing | 2001-03-16 **3D SYSTEMS** [ERWÄHNUNG] | 2004-03-15 **STRATASYS** [ANBIETER] | 2005-03-16 STRATASYS [ANBIETER] |
| internet of things | 2010-03-26 FORLINK SOFTWARE | 2011-02-28 ASIAINFO-LINKAGE | 2011-03-08 EVOLVING SYSTEMS |
| software-defined networking | 2012-09-12 **CISCO** | 2012-11-21 **F5 NETWORKS** | 2012-12-14 **BROCADE** |
| wearables | 2002-03-28 AT ROAD | 2005-02-11 NEXT INC | 2005-05-17 ENNIS |
| additive manufacturing | 2001-12-21 MTS SYSTEMS | 2002-03-28 LUBRIZOL | 2002-04-16 PIONEER COMPANIES |
| apple pay | 2013-03-01 VirnetX *(Falschtreffer)* | 2014-03-03 VirnetX *(Falschtreffer)* | 2014-07-29 VirnetX |
| augmented reality | 2003-03-26 MICROVISION | 2003-03-28 THREE FIVE SYSTEMS | 2004-03-15 MICROVISION |
| machine learning | 2001-04-02 FONIX | 2001-04-02 KANA COMMUNICATIONS | 2002-03-29 FONIX |
| connected home | 2002-06-28 AMX CORP | 2002-07-01 ABAXIS | 2002-12-24 ABAXIS |
| virtual reality | 2001-01-29 ACTION PERFORMANCE | 2001-02-26 CROWN AMERICAN REALTY | 2001-02-26 VENTRO |
| autonomous vehicles | 2006-03-16 KVH INDUSTRIES [RISIKOTEIL] | 2006-03-16 **iROBOT** [ANBIETER] | 2007-03-02 iROBOT [ANBIETER] |
| blockchain | 2014-03-28 BITCOIN SHOP | 2014-07-30 WPCS INTERNATIONAL [RISIKOTEIL] | 2015-03-31 Mecklermedia |
| cryptocurrencies | 2015-02-13 **MASTERCARD** | 2015-03-12 **OVERSTOCK** [ANWENDER] | 2015-05-07 AVRA |
| deep learning | 2014-03-06 ISSUER DIRECT | 2015-03-04 ISSUER DIRECT | 2015-03-12 **NVIDIA** |
| natural language processing | 2001-03-16 SPEECHWORKS [ANBIETER] | 2001-03-23 SIDEWARE SYSTEMS | 2001-03-26 MEDQUIST |
| green hydrogen | 2012-01-31 THERMAL ENERGY STORAGE | 2015-09-28 Hypersolar | 2016-09-21 Hypersolar |
| quantum computing | 2005-03-09 MARSH & McLENNAN | 2006-03-02 MARSH & McLENNAN | 2007-03-01 MARSH & McLENNAN |
| reimagined | 2014-02-24 STARWOOD HOTELS | 2014-02-28 YAHOO | 2015-02-25 STARWOOD HOTELS |
| advanced machine learning | 2016-02-26 IMPERVA | 2016-12-22 MYnd Analytics | 2017-02-15 TiVo |
| digital twin | 2017-02-23 **ANSYS** | 2017-07-14 AMERICAN SOFTWARE [RISIKOTEIL] | 2018-03-21 **ALTAIR** |
| proof of stake | 2015-04-15 BITCOIN SHOP [RISIKOTEIL] | 2015-08-31 HashingSpace [RISIKOTEIL] | 2017-06-23 BTCS [RISIKOTEIL] |
| Metaverse | 2017-04-07 TimefireVR | 2021-10-13 ESPORTS ENTERTAINMENT | 2022-01-12 CYTTA [ANBIETER] |
| Cannabis | 2001-05-08 PICK COMMUNICATIONS | 2002-03-21 BENTLEY PHARMACEUTICALS | 2002-04-11 PHARMOS |

**Rollenverteilung über alle 208 ausgewerteten Nennungen:** bloße Erwähnung 133 ·
Risikoteil 20 · Anbieter 19 · Anwender 1 · nicht belegbar 35.

**Der Befund, der Karls NVIDIA-Frage vorbereitet — und er ist ernüchternd:** Über alle
26 Themen und 208 frühesten Nennungen taucht NVIDIA **genau einmal** auf: bei `deep
learning`, auf Platz 3, am 12.03.2015, im Geschäftsteil (Item 1), als *bloße Erwähnung*
in einem Satz über Grafikkarten für Spieler und Designer. **Aus der Reihenfolge der
frühen Nennungen wäre NVIDIA 2015 nicht als Schlüsselfirma erkennbar gewesen** — die
Firma stand nicht vorn, und ihr Kontext war kein Anbieter-Kontext.

Umgekehrt gilt: In vier Themen stehen die späteren Namen tatsächlich ganz vorn und mit
Anbieter-Rolle — `3d printing` (3D Systems, Stratasys), `software-defined networking`
(Cisco, F5, Brocade), `autonomous vehicles` (iRobot) und `digital twin` (ANSYS,
Altair). **Ob „vorn stehen" etwas wert war, entscheidet erst die Kursseite. C1 sagt
darüber nichts.**

**Falschtreffer sind nicht die Ausnahme, sondern ein Mechanismus** — und sie sind nur
sichtbar, weil das Kontextfenster mitgeliefert wird. Zwei belegte Fälle:

- `apple pay`, früheste Nennung 01.03.2013, VirnetX Holding: *„…the Court ordered that
  **Apple pay** $33,561…"* — ein Patentprozess, kein Bezahldienst. Der Bezahldienst kam
  erst im September 2014.
- `cloud`, früheste Nennung 16.01.2001, Advest Group: die Fundstelle ist eine
  **Unterschriftenseite**, und der Treffer ist der Name eines Direktors — *„/s/ Sanford
  **Cloud**, Jr. Director"*.

Ohne das Fenster stünden beide Firmen in einer Tabelle als „früheste Nennung" — und
sähen dort aus wie ein Befund.

---

## 6 · Anker-Gegenprobe gegen C0, Wächter, Sabotage, Zahlen

### Der C0-Anker ist beim ersten Lauf ROT geworden — zu Recht

`transparency`, Aufnahmejahr 2004: C0 zählte **395** Firmen, C1 einen Tag später
**394**. Die Ursache wurde byte-genau gefunden, nicht vermutet:

- Beide Läufe melden dieselben **446 Treffer**.
- C0s versiegelte Antworten enthalten **446 Dokumente**, C1s nur noch **445**.
- Verschwunden ist genau ein Dokument: `0001047469-04-006934:a2129092zex-13.htm` —
  IBMs Anhang 13 zum Jahresbericht 2003, das **einzige** Dokument, über das IBM in
  diese Zählung kam.

**EDGARs Volltextindex lebt.** Der Wächter verlangte in seiner ersten Fassung, dass
eine lebende Quelle sich zwischen zwei Läufen nicht ändert — das ist keine Eigenschaft,
die man prüfen kann, sondern eine, die die Quelle nicht hat. Er wurde deshalb **nicht
abgeschwächt, sondern geteilt und verschärft** (FREEZE 1c):

- **Stufe 1 — Methoden-Identität, ohne Toleranz:** Derselbe Zähl-Code muss aus **C0s
  versiegelten Rohantworten** exakt C0s Firmenmenge herausrechnen. Ergebnis:
  **24 von 24 Themen, exakt.**
- **Stufe 2 — Live-Abweichung mit Erklärungspflicht:** Jede Abweichung gegen den
  heutigen Index muss byte-genau aufgehen — welche Dokumente fehlen und dass genau
  daraus die Firmendifferenz folgt. Eine Abweichung **ohne** Erklärung ist rot. Ein
  Toleranzband gibt es nicht; es hätte jede künftige stille Zähl-Drift durchgewunken.
  Ergebnis: **1 Abweichung, vollständig erklärt.**

### Sabotage-Protokoll — jeder Wächter einmal kaputtgemacht

| Eingriff | Erwartung | Ergebnis |
| --- | --- | --- |
| Zugriff **vor** dem serverbestätigten Zeitpunkt versucht | Abbruch | **rot**, Exit 1: *„Der freigegebene Zugriffszeitpunkt … ist noch nicht erreicht"* |
| Prüfsumme eines Kandidaten entfernt (Datum ohne Beleg) | Wächter rot | **rot**, `W3_jedes_datum_traegt_eine_quellen_pruefsumme` |
| Sprachmode `reimagined` aus der Ausgabe gelöscht | Wächter rot | **rot**, `W1_alle_26_themen_haben_eine_zeitleiste` |
| C0-Anker Stufe 1 auf „ungleich" gesetzt | Wächter rot | **rot**, `W2_c0_firmenzahl_im_aufnahmejahr_reproduziert` |
| Live-Abweichung ohne Dokument-Beleg eingetragen | Wächter rot | **rot**, `W2b_jede_live_abweichung_ist_byte_genau_erklaert` |
| **Meta:** Anker-Vergleich aus dem Prüfer ausgebaut, dann sabotiert | Wächter findet nichts mehr | **findet nichts mehr** — der Vergleich IST die tragende Stelle |
| ausgelieferter Stand, unverändert | Wächter grün | **grün**, 9 von 9 |

Der Sabotage-Fall für die gelöschte Sprachmode ist mit Absicht so gewählt: `reimagined`
ist die bequemste stille Streichung, weil sie „eh kein Thema" ist — und genau dadurch
wäre die eingebaute Negativ-Kontrolle weg.

### Prüfungszahlen

| | vorher (C0-Stand) | nachher |
| --- | ---: | ---: |
| Studien-Prüfungen | **139 grün / 0 rot** | **155 grün / 0 rot** (16 neue C1-Prüfungen) |
| Rechen-Selbsttest im Skript | — | **43 Prüfungen**, jede in beide Richtungen |
| C1-Wächter (`pruefen`) | — | **9 grün / 0 rot** |

Gemessen mit echtem Exit-Code je Datei, nie über eine Ausgabe-Abkürzung.
C0s Siegel wurde gegengeprüft und ist **unberührt** (`502d52a5…`, 30 Dateien, grün);
C0s vollständige Reproduktion läuft weiterhin durch.

### Siegel und Commits

| | |
| --- | --- |
| FREEZE 1 | `73b647b1…` · angemeldet 01:13:54Z · **Server 01:14:08Z** · Zugriff ab 01:22:54Z |
| FREEZE 1b | `ca9a4260…` · angemeldet 01:34:19Z · **Server 01:34:36Z** · Zugriff ab 01:41:19Z |
| FREEZE 1c | `99eb082b…` · angemeldet 01:48:25Z · **Server 01:48:28Z** · Zugriff ab 01:54:25Z |
| FREEZE 2 | `fdd2d7e5…` über Zeitleisten, 26 Kandidaten- und 26 Führungs-Dateien |
| Zugriffs-Register | 19 Einträge, Kette gültig, vier davon von C1 |

```
36197520d6  C1 FREEZE 2: 26 Zeitleisten, 675 Phrase-Jahre, 208 Kontextfenster
cd40fd51d1  FREEZE 1c: der C0-Anker war rot - und die Ursache liegt in der Quelle
27673cf9f5  Server-Bestaetigung des zweiten C1-Regelstands
fd337ace4e  FREEZE 1b: vier Review-Befunde geheilt, bevor gemessen wurde
cc0b4b231e  C1-Waechter: drei Sabotagen und der Meta-Test gegen den C0-Anker
df1c1f1b51  Server-Bestaetigung der C1-Anmeldung - 01:14:08Z auf der GitHub-Uhr
38621876af  C1 FREEZE 1: die Zeitleisten-Regel steht vor der ersten Messung
```

### Warum es drei Regelstände gibt — offen, weil ein Prüfer das sehen muss

**FREEZE 1b:** Zwei unabhängige Code-Reviews (`silent-failure-hunter`,
`python-reviewer`) fanden **denselben kritischen Fehler**: die Fundstellensuche im
Filing-Dokument arbeitete **ohne Wortgrenzen** und hätte `cloud` in `cloudy` getroffen —
ein Kontextfenster samt Rolle für eine Stelle, an der der Begriff gar nicht steht. Dazu
drei weitere: „nicht erreichbar" und „nicht enthalten" waren derselbe leere Wert;
gedeckelte EDGAR-Jahre lieferten „früheste" Nennungen aus einer Liste, die EDGAR nicht
vollständig herausgibt; der Kandidaten-Deckel griff **vor** der Zulässigkeitsprüfung und
hätte einen gültigen Anker durch Datenmüll verdrängen können. Kein Schwellenwert, kein
Zeitraum, keine Sonde, keine Fenstergröße wurde angefasst; der **Zählpfad ist
byte-gleich** nachgewiesen, weshalb die zu diesem Zeitpunkt bereits laufende
Verbreitungskurve gültig bleibt.

**FREEZE 1c:** der oben beschriebene C0-Anker.

---

## 7 · Was NICHT belegt werden konnte — offene Prüfschritte, kein Restrisiko

1. **Die fachliche Ebene.** Freie Aufsatz-Metadaten datieren einen Technologie-Begriff
   nicht zuverlässig — zwei Fehlerarten, beide belegt (Abschnitt 4). *Offener
   Prüfschritt: eigener Freeze mit einer Regel, die Platzhalter-Daten und Datensätze
   ohne Tagesgenauigkeit ausschließt und ein Mindest-Konsensdatum aus beiden Sonden
   verlangt. Nicht in C1 nachziehen — das wäre eine Regeländerung nach Sicht der
   Ergebnisse.*
2. **35 von 208 Kontextfenstern fehlen.** 20× wurde die Phrase in den geprüften
   Dokumenten nicht gefunden — die Nennung stand dann in einem Anhang, der nicht unter
   den drei geprüften Dokumenten war (Beispiel: `virtual reality`, Action Performance
   2001); 15× war keines der drei Dokumente abrufbar (Beispiel: `virtual reality`,
   Crown American Realty 2001). *Offener Prüfschritt: alle Dokumente einer Einreichung prüfen
   statt der ersten drei.*
3. **Kein Produktstart-Kanal.** Für Produktankündigungen gibt es keine freie, uniforme,
   datierte Quelle. Ein Produktstart erscheint in C1 nur, wenn ihn eine der fünf Sonden
   ohnehin sieht. Geprüft und verworfen: arXiv (drosselt dauerhaft und hätte Themen je
   nach Tageszeit ungleich behandelt), USPTO-Portal (ohne Schlüssel nur HTML),
   GDELT (Volltext erst ab 2017 — hätte alte Themen benachteiligt), Google-Books-Ngrams
   (keine Schnittstelle), Presse-Archive hinter Bezahlschranken (R7).
4. **Neun linkszensierte öffentliche Anker.** Federal Register beginnt 1994, EDGAR-
   Volltext und Wikipedia 2001. Was davor war, sieht keine der freien Quellen.
   *Kein Gratis-Prüfschritt in Sicht.*
5. **Schreibvarianten und Wortsinn.** Die Volltextsuche trifft die exakte Phrase; „3-D
   printing" entgeht der Zählung von „3d printing", und „Apple pay" trifft auch
   „…ordered that Apple pay $33,561". Das trifft Gewinner und Flops gleichermaßen und
   bleibt bewusst unkorrigiert — eine Varianten- oder Ausschlussliste wäre genau das
   Urteil, das die Regel verbietet.
6. **Nicht-US-Firmen.** EDGAR und Federal Register sehen nur die USA. Ein Thema, das
   überwiegend von europäischen oder asiatischen Anbietern getragen wurde, erscheint zu
   klein. *Kein Gratis-Prüfschritt in Sicht — Pflichtsatz in jedem C-Bericht.*
7. **Die Rollen-Marke ist grob.** Sie sagt, in welchem Zusammenhang das Wort stand —
   nicht, was die Firma tat. 133 von 208 Nennungen fielen in den Rest-Eimer „bloße
   Erwähnung". Filings, die ihre Abschnitts-Überschriften nur optisch abtrennen, sind
   aus reinem Text nicht erkennbar; dort bleibt der Abschnitt leer.

---

## 8 · Die Pflichtsätze

**Aus der Verfassung, Abschnitt „Was Strang C NICHT kann":** Bei ~15–25 Themen gibt es
**keinen statistischen Beweis**; „backgetestet und validiert" im strengen Sinn ist
retrospektiv nicht erreichbar. Erreichbar sind Rekonstruktion, Verwechsler-Vergleich
und der eingefrorene Vorwärtstest. Und „ein bis zwei Jahre vor allen anderen" ist
ergebnis-offen — auch „das Fenster war meist kürzer als sechs Monate" wäre eine gültige
und wertvolle Antwort.

**Was ein C1-Ergebnis behaupten darf:** dass ein Begriff an einem bestimmten Tag in
einer bestimmten, abrufbaren Quelle stand; wie viele US-Firmen ihn in welchem Jahr in
ihrem Jahresbericht verwendeten; welche Firmen ihn zuerst verwendeten und in welchem
Textzusammenhang.

**Was ein C1-Ergebnis NICHT behaupten darf:** dass ein Thema an diesem Tag „entstand";
dass ein Thema groß oder klein war; dass eine früh nennende Firma eine gute oder
schlechte Anlage war; und irgendetwas über Kurse — C1 hat keine gesehen.

---

## 9 · Neue Fragen und Hypothesen (R16)

- **H-C1-1:** Die größte Nennungs-Reihe der ganzen Tabelle gehört einer **Floskel**
  (`transparency`, 3624 Firmen 2025). **Hypothese:** Die Höhe und das Wachstum der
  Nennungszahl trennen Themen **nicht** von Sprachmoden. Falsifizierbar in C-c: Wenn
  ein Aufmerksamkeits-Marker `reimagined` nicht von `cloud` trennt, taugt er nichts —
  und nach diesem ersten Blick trennt er nicht.
- **H-C1-2:** Nur **ein** Thema von 26 ist im Beobachtungsfenster gekippt
  (`software-defined networking`). **Frage:** Ist das eine Eigenschaft von Themen —
  einmal im Jahresbericht, immer im Jahresbericht — oder ist das Fenster zu kurz? Am
  vorhandenen Bestand prüfbar, indem man die Reihen auf Halbwertszeiten absucht.
- **H-C1-3:** In vier Themen stehen die späteren Namen mit Anbieter-Rolle ganz vorn, in
  einem (`deep learning`/NVIDIA) nicht. **Frage:** Gibt es eine Regel, die diese beiden
  Fälle VOR der Kursreaktion trennt? Das ist Karls NVIDIA-Frage, und sie wird erst mit
  C2 entscheidbar.
- **H-C1-4:** `cryptocurrencies` (70 → 67 → 64) und `proof of stake` (7 → 5 → 4) gehen
  2018–2020 gemeinsam zurück und steigen ab 2021 gemeinsam wieder; `blockchain` fällt
  nicht, flacht aber im selben Fenster ab (136 → 179 → 182), bevor es 2022 auf 391
  springt. **Frage:** Sind Nennungs-Reihen thematisch so korreliert, dass 26 Themen
  nicht 26 unabhängige Beobachtungen sind? Das berührt jede spätere Statistik und ist
  ohne neue Abrufe beantwortbar.
- **VORSCHLAG C1-N1:** Fachliche Ebene neu, als eigener Freeze mit Platzhalter- und
  Genauigkeits-Ausschluss und Zwei-Sonden-Konsens. Zeitschätzung: 1 Tag.
- **VORSCHLAG C1-N2:** Führungs-Lücke schließen — alle Dokumente einer Einreichung
  prüfen statt der ersten drei, und die Zahl der frühesten Nennungen je Thema von 8 auf
  20 heben. Zeitschätzung: 1 Tag.
