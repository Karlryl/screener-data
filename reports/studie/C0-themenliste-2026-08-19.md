# C0 — Die eingefrorene Themenliste für Strang C

**Lauf vom 19.08.2026 · Zweig `studie/c0-themenliste`**

> Karls Frage dahinter: *„Ist es möglich, Wachstumsthemen zu identifizieren, bevor sie
> an der Börse komplett angekommen sind?"* — C0 baut den ersten Schritt: **welche
> Themen überhaupt untersucht werden**, und zwar so, dass die Auswahl im Rückblick
> nicht manipulierbar ist.

---

## 1 · Was hier gebaut wurde, in Karls Sprache

Wer eine Liste großer Trendthemen aus dem Gedächtnis aufschreibt, schreibt
**Gewinner** auf — und lernt daraus zwangsläufig „früh rein lohnt immer". Das ist
Überlebens-Selektion und wertlos. Deshalb entsteht die Themenliste aus einer
**mechanischen Regel**, die vor der ersten Messung eingefroren wurde:

1. Drei datierte Fachpresse-Register liefern das **Kandidaten-Vokabular** — Wörter,
   die zu ihrer Zeit als kommende Technologie galten, ohne dass irgendjemand wusste,
   welche davon später etwas werden.
2. Für jedes dieser Wörter wird gezählt, **wie viele verschiedene US-Firmen** es in
   ihrem Jahresbericht (Formular 10-K) verwenden — Jahr für Jahr.
   *Firmen, nicht Dokumente:* „blockchain" hatte 2018 zwar 232 Dokument-Treffer, aber
   nur rund 101 verschiedene Firmen. Wer Dokumente zählt, zählt Vielschreiber doppelt.
3. Ein **Thema** ist ein Wort, das in einem Jahr sprunghaft in vielen Jahresberichten
   auftaucht, nachdem es drei Jahre zuvor kaum vorkam.

Die Regel steht in `protocol/strang-c/C0-regel.md` und ist per Prüfsumme versiegelt.

---

## 2 · Das Register — woher die Kandidaten kommen

| Quelle | Was | Jahrgänge geholt | Titel |
| --- | --- | --- | --- |
| **A** | Gartner „Top 10 Strategic Technology Trends" | 6 (2015–2020) | 60 |
| **B** | Gartner „Hype Cycle for Emerging Technologies" (Grafik) | 2 (2015, 2016) | 71 |
| **C** | MIT Technology Review „10 Breakthrough Technologies" | 23 (2001–2024) | 230 |
| | **Summe** | **31 Jahrgänge** | **361** |

Daraus **345 Suchphrasen** nach der mechanischen Zerlegungsregel (kleinschreiben,
Klammerzusätze streichen, an `/`, `&`, ` and `, `,` trennen, rein alphabetische
Kürzel bis 3 Zeichen verwerfen). Keine Synonyme, keine Aliase, keine Stoppliste.

### Register-Lücken — geloggt, nicht überbrückt

| Quelle | Fehlende Jahrgänge | Grund |
| --- | --- | --- |
| A | 2008–2014 | Die Mitteilungen lagen unter `gartner.com/it/page.jsp?id=NNNN` — **kein Titel in der Adresse**. Mechanisch nicht auffindbar; sie über Motor-Erinnerung zu rekonstruieren wäre genau der verbotene Weg. |
| A | 2021–2024 | Snapshot fehlt (404) bzw. gartner.com drosselte den Abruf. |
| B | 2005–2013, 2017–2024 | Keine Mitteilung „Gartners \<Jahr\> Hype Cycle for Emerging Technologies" im Wayback-Index unter dem heutigen Adressmuster. |
| B | 2014 | Mitteilung archiviert, **aber ohne Grafik** im Schnappschuss. Ohne Grafik keine Transkription — Prosa-Extraktion ist nach Regel verboten. |
| C | 2002 | Diese Ausgabe existiert nicht (die Reihe setzte 2002 aus). |

**Was das für das Ergebnis heißt, ehrlich:** Der frühe Teil des Registers ruht fast
allein auf Quelle C. Für Spike-Jahre vor 2015 ist das Kandidaten-Vokabular schmaler,
als die Regel es vorsah. Das ist eine Grenze der Datenlage, keine Auswahl-Entscheidung
— aber sie gehört in jede spätere Interpretation.

### Zwei Korrekturen an den Vorgaben des Entscheids

- **„Der direkte Abruf bei gartner.com antwortet 403" trifft nicht zu.** Gemessen am
  19.08.2026: HTTP **200** für die Jahrgänge 2018 und 2024. Erst nach vielen schnellen
  Anfragen kommt 403 — das ist eine **Drossel**, keine Sperre. Quelle A nutzt deshalb
  den Live-Weg mit dem Archiv als Rückfall; drei Sekunden Abstand statt einer anderen
  Kennung (eine Sperre umgehen wäre nach R7 verboten).
- **Für Quelle B ist es umgekehrt.** Gegenstand ist dort die **Grafik eines bestimmten
  Jahres**; Gartner hat die alten Seiten seither neu gerendert und trägt sie nicht mehr.
  Ein Zwischenlauf mit Live-Vorrang hat genau deshalb die 2015er Grafik verloren, die
  vorher da war. Quelle B holt jetzt zuerst den zeitgenössischen Schnappschuss.

### Doppel-Transkription der Grafiken

| Jahrgang | Einträge | Diff der zwei Lesungen | Prüfsumme des Bildes |
| --- | --- | --- | --- |
| 2015 | 37 | **leer** | `0d272489…` |
| 2016 | 34 | **leer** | `512db7c9…` |

Die 2015er Lesung wurde **wiederholt**, nachdem sich herausstellte, dass die zuerst
gelesene Bilddatei eine andere Kodierung desselben Bildes war als die schließlich
versiegelte. Eine Transkription, die nicht an den versiegelten Bytes hängt, ist kein
Beleg — auch dann nicht, wenn das Bild dasselbe zeigt.

---

## 3 · FREEZE 1 — die Reihenfolge ist die Methodik

| | |
| --- | --- |
| Umfasst | Regeltext · Rohbytes-Manifest · Vokabular · **das Skript selbst** |
| **FREEZE 1** (`c0-freeze1-2026-08-19`) | Bündel `193081aa…` · angemeldet 20:51:28Z · **Server-Bestätigung 20:51:48Z** · Zugriff ab 21:16:22Z |
| **FREEZE 1b** (`c0-freeze1b-2026-08-19`) | Bündel `1c13f5e1…` · angemeldet 22:36:27Z · **Server-Bestätigung 22:36:43Z** · Zugriff ab 22:44:27Z |

**Warum es zwei Regelstände gibt — offen, weil ein Prüfer das sehen muss.** Der
Zähllauf blieb an Allerweltswörtern wie „things" hängen: EDGAR zählt oberhalb einer
internen Grenze nicht mehr exakt aus und meldet nur eine untere Schranke. Mein Leser
hielt dort an — fail-closed gedacht, aber am falschen Ort, denn die Regel kennt den
Fall längst („mehr als 5.000 Dokument-Treffer"). Der Abbruch war also kein Schutz,
sondern ein Loch.

Der Unterschied zwischen beiden Ständen ist **eine Datei und darin eine Lesefunktion**.
Nachgemessen und in der Anmeldung ausgeschrieben: **Regeltext, Register-Manifest und
Vokabular tragen in beiden Ständen dieselbe Prüfsumme.** Kein Schwellenwert, kein
Faktor, keine Phrase wurde angefasst. Gültig ist FREEZE 1b.

**Warum das Skript mit ins Siegel gehört:** Schwelle 20, Faktor 3, Zielband und Leiter
sind Konstanten *im Programm*; die Regeldatei daneben ist Prosa und wird von keinem
Rechenschritt gelesen. Ohne den Skript-Hash hätte jemand nach Sichtung der Zählungen
die Schwelle auf 18 setzen und neu ableiten können, ohne dass ein Wächter anschlägt —
genau der Fall, den C0 ausschließen soll. (Befund des Silent-Failure-Reviews.)

---

## 4 · Der Zählstand

| | |
| --- | --- |
| Dokument-Screen | 345 Phrasen × 22 Jahre = **7.590 Abfragen** |
| Exakte Firmen-Auszählung | **2.225 Paare** (1.385 nach Screen + 840 zur Lückenprüfung) |
| Versiegelte EDGAR-Antworten | rund 57 MB, jede unter ihrer Prüfsumme abgelegt |
| Filer-Zeilen in den 24 Themen-Listen | **1.571** (CIK, Name, Accession, Filing-Datum) |

**Nicht berechenbar, ausgewiesen statt verschwiegen:** 73 Phrase-Jahre über fünf
Allerweltswörtern (`advanced`, `infrastructure`, `privacy`, `things`, `trust`) liegen
über der Deckelgrenze; EDGAR gibt dort keine vollständige Trefferliste heraus, `D` ist
unbekannt und das Jahr kann kein Aufnahmejahr sein. Betroffen sind ausschließlich
Wörter, die als eigenständiges Thema ohnehin nichts bedeuten.

---

## 5 · Die Themenliste

**24 regel-erzeugte Themen + 2 Mandats-Einträge.**

| Aufnahmejahr | Firmen (D) | Thema |
| --- | --- | --- |
| 2004 | 395 | transparency |
| 2008 | 72 | solar power |
| 2010 | 318 | cloud |
| 2014 | 25 | **3d printing** *(Pflicht-Verwechsler 3D-Druck)* |
| 2014 | 50 | internet of things *(mit „the internet of things" zusammengelegt)* |
| 2014 | 24 | software-defined networking |
| 2014 | 34 | wearables |
| 2015 | 23 | **additive manufacturing** *(Pflicht-Verwechsler 3D-Druck)* |
| 2015 | 24 | apple pay |
| 2015 | 21 | augmented reality |
| 2015 | 44 | machine learning |
| 2016 | 36 | connected home |
| 2016 | 38 | virtual reality |
| 2017 | 42 | autonomous vehicles |
| 2017 | 24 | **blockchain** *(Pflicht-Verwechsler Blockchain)* |
| 2018 | 70 | cryptocurrencies |
| 2018 | 27 | deep learning |
| 2019 | 30 | natural language processing |
| 2021 | 28 | **green hydrogen** *(Pflicht-Verwechsler Wasserstoff)* |
| 2021 | 24 | quantum computing |
| 2021 | 30 | reimagined |
| 2022 | 25 | advanced machine learning |
| 2022 | 25 | digital twin |
| 2022 | 27 | proof of stake |
| — | — | `MANDAT` **Metaverse** |
| — | — | `MANDAT` **Cannabis** |

Eine einzige Zusammenlegung: „internet of things" + „the internet of things",
Spike-Abstand 0 Jahre, Firmen-Überlappung 0,76.

**Was die Liste über sich selbst sagt:** Sie enthält Gewinner (cloud, machine learning,
autonomous vehicles) und Verwechsler (3d printing, blockchain, green hydrogen)
**nebeneinander** — und sie enthält Wörter wie `transparency` und `reimagined`, die gar
kein Thema sind, sondern Sprachmoden in Jahresberichten. Das ist kein Fehler der Regel,
sondern ihr Preis: Eine Regel, die Floskeln zuverlässig aussortieren würde, müsste
urteilen, wovon ein Wort handelt — und genau dieses Urteil ist im Rückblick nicht
manipulationsfrei zu haben. Die Floskeln bleiben drin und dienen als eingebaute
Negativ-Kontrolle: Wenn die späteren Marker sie nicht von `cloud` trennen, taugen die
Marker nichts.

---

## 6 · Die fünf Pflicht-Verwechsler — Erwartung gegen Messung

| Verwechsler | Planer erwartete | Gemessen | Verdikt |
| --- | --- | --- | --- |
| 3D-Druck | selbst erzeugt, 2014, D=25 | **selbst erzeugt, 2014, D=25** | **bestätigt, auf die Firma genau** |
| Wasserstoff | wahrscheinlich, „green hydrogen" 2021, D=28 | **selbst erzeugt, 2021, D=28** | **bestätigt, auf die Firma genau** |
| Blockchain | selbst erzeugt 2017/18 | **selbst erzeugt, 2017, D=24** | **bestätigt** |
| Cannabis | strukturell nie | **nicht erzeugt → `MANDAT`** | **bestätigt** |
| Metaverse | selbst erzeugt, 2022, D=54 | **nicht erzeugt → `MANDAT`** | **widerlegt** |

**Der Metaverse-Befund ist der interessante.** Er scheitert nicht an der Zählung,
sondern eine Stufe früher: **das Wort „metaverse" steht in keinem der 361
Register-Titel.** Der Planer hat den Zählstand geprüft — und der hätte gereicht —, aber
nicht, ob das Wort überhaupt im Kandidaten-Vokabular vorkommt. Die drei Register haben
das Thema in ihren Jahreslisten nie geführt; in den Jahrgängen, in denen es hätte
auftauchen müssen (Gartner 2021–2024), liegen unsere Register-Lücken.

Damit gilt: **Cannabis fehlt aus einem strukturellen Grund** (kein Tech-Register führt
es), **Metaverse aus einem Abdeckungsgrund** (die einschlägigen Jahrgänge sind Lücken).
Die Gründe sind verschieden, beide sind ein Befund über die Regel und kein Fehler in
ihr. Geheilt wird beides gleich: als `MANDAT`-Zeile, unlöschbar markiert, und jede
spätere Marker-Auswertung läuft **einmal mit und einmal ohne** die Mandats-Themen.

---

## 7 · Die Leiter musste nicht greifen

Zielband 15–25, Handlungsband 12–30. Die Basisregel (Schwelle 20, Faktor 3) liefert
**24 Themen** — mitten im Zielband. **Null Leiter-Schritte.** Der Endstand ist die
Startregel; an Schwelle und Faktor wurde nichts bewegt.

---

## 8 · Wächter, Sabotage, Reproduktion

### Der Screen war eine Annahme — jetzt ist er eine Messung

Der Dokument-Screen sortiert ein Jahr aus, wenn es weniger als 5 Treffer hat. Dahinter
stand die Annahme, eine 10-K-Einreichung trage höchstens vier Firmennummern. Die Regel
verlangt, diese Reserve nachzumessen — **und die Messung widerlegt sie:** bis zu **67
CIKs auf einer einzigen Einreichung** (Mit-Registranten), 125 von 1.385 Auszählungen
über vier.

Also wurde nachgezählt statt gehofft: alle 654 aussortierten Spike-Jahre samt
Basisjahren, **840 zusätzliche Auszählungen**. Ergebnis: das höchste `D` unter den
Aussortierten ist **4** — keines kommt der Schwelle 20 nahe. Die Themenliste ist nach
der Nachzählung **Zeile für Zeile dieselbe**. Kein Thema ging verloren.

### Sabotage-Protokoll

| Eingriff | Erwartung | Ergebnis |
| --- | --- | --- |
| Thema `transparency` → `transparency-SABOTAGE` umbenannt | Prüfskript **rot** | **rot**, Exit 1, nennt die Datei und beide Prüfsummen |
| danach zurückgesetzt | Prüfskript **grün** | **grün**, Exit 0 |
| Hash-Vergleich im Prüfer entfernt | Meta-Test **rot** | **rot**: `W2` und `W3` fallen, 11/14 statt 14/14 |
| danach zurückgesetzt | Skript wieder am Siegel | Prüfsumme `3652bb14…` **identisch**, 14/14 grün |

Damit ist beides gezeigt: Der Wächter **fängt** die Manipulation, und er ist **der
Grund**, warum sie gefangen wird — ohne ihn läuft dieselbe Manipulation durch.

### Reproduktion — gegen die Siegel, nie gegen den lebenden Index

| Prüfung | Ergebnis |
| --- | --- |
| Vokabular aus den versiegelten Register-Bytes neu abgeleitet | **identisch** |
| 2.225 Auszählungen aus den versiegelten EDGAR-Antworten neu gerechnet | **0 Abweichungen**, auch in der Vollständigkeit je Trefferseite |
| Themenliste + Leiter-Log + 24 Filer-Listen komplett neu abgeleitet | **26 von 26 Dateien inhaltsgleich** (ohne das Feld `erzeugtAm`) |

---

## 9 · Prüfungszahlen und Siegel

| | vorher | nachher |
| --- | --- | --- |
| Studien-Prüfungen | 125 grün / 0 rot | **139 grün / 0 rot** (14 neue C0-Prüfungen) |
| Rechen-Selbsttest im Skript | — | **30 Prüfungen**, jede in beide Richtungen |

Zwei rote Prüfungen wurden im Lauf gefunden und geheilt: der Freeze-Test prüfte den
ersetzten statt den gültigen Regelstand, und der R16-Wächter hat diesem Bericht zu
Recht den Folgefragen-Block abverlangt.

**Siegel:** FREEZE 1b `1c13f5e1…` · FREEZE 2 `502d52a5…` · Zugriffs-Register 15 Einträge,
Kette gültig.

---

## 10 · Was NICHT gemessen werden konnte — offene Prüfschritte, kein Restrisiko

1. **Register-Abdeckung vor 2015 (Quelle A) und fast durchgehend (Quelle B).** Die
   Gartner-Mitteilungen 2008–2014 liegen unter Adressen ohne Titel; sie mechanisch zu
   finden hieße, tausende Archiv-Seiten abzurufen. *Offener Prüfschritt: ein separat
   angemeldeter Lauf, der den Wayback-Index dieser Jahre seitenweise abklappert.*
2. **Quelle A 2021–2024.** Hier war gartner.com gedrosselt, nicht gesperrt. *Offener
   Prüfschritt: derselbe Abruf mit mehreren Stunden Abstand, in einem neuen Freeze.*
3. **Die 73 gedeckelten Phrase-Jahre.** EDGAR gibt oberhalb seiner Grenze keine
   vollständige Liste heraus. *Offener Prüfschritt: dieselben Abfragen quartalsweise
   statt jährlich stellen und die Jahresmenge aus vier kleineren zusammensetzen.*
4. **Schreibvarianten.** Die Volltextsuche matcht nur die exakte Phrase; „3-D printing"
   entgeht der Zählung von „3d printing". Das trifft Gewinner und Flops gleichermaßen
   und bleibt bewusst unkorrigiert — eine Varianten-Tabelle wäre genau die
   Synonym-Liste, die die Regel verbietet.
5. **Nicht-US-Firmen.** EDGAR sieht nur, wer in den USA einreicht. Ein Thema, das
   überwiegend von europäischen oder asiatischen Anbietern getragen wurde, erscheint zu
   klein. *Kein Gratis-Prüfschritt in Sicht — gehört als Pflichtsatz in jeden späteren
   C-Bericht.*

---

## 11 · Neue Fragen und Hypothesen (R16)

- **H-C0-1:** Die Liste enthält Sprachmoden (`transparency`, `reimagined`) neben echten
  Themen. **Hypothese:** Substanz-Marker (zahlende Kunden, Investitionen der Abnehmer,
  Auftragsbestände) trennen Sprachmoden schärfer von Themen als Aufmerksamkeits-Marker.
  Falsifizierbar in C-c: Trennen sie `reimagined` nicht von `cloud`, taugen sie nichts.
- **H-C0-2:** Die Aufnahmejahre häufen sich in 2014–2018 (13 von 24). **Frage:** Ist das
  eine Eigenschaft der Welt oder unseres Registers? Prüfbar, indem man die
  Jahres-Verteilung der Register-Titel gegen die der Aufnahmejahre hält.
- **H-C0-3:** Mehrere Begriffe desselben Sachverhalts blieben getrennt (`3d printing` /
  `additive manufacturing`; `machine learning` / `advanced machine learning` / `deep
  learning`). Die Zusammenlegungsregel hat nur einmal gegriffen. **Frage:** Ist die
  Jaccard-Schwelle 0,5 zu streng, oder sind das wirklich verschiedene Firmenkreise? Am
  vorhandenen Datenbestand ohne neue Abrufe beantwortbar.
- **VORSCHLAG C0-N1:** Register-Nachzug für Gartner 2008–2014 über den seitenweisen
  Wayback-Index, als eigener Freeze mit eigener Anmeldung. Zeitschätzung: 1 Tag.
- **VORSCHLAG C0-N2:** Quartalsweise Zählung für die 73 gedeckelten Phrase-Jahre, um die
  Deckelgrenze zu unterlaufen. Zeitschätzung: 1 Tag.
