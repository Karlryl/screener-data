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
| Bündel-SHA-256 | `193081aa124a52c1e05e127985c8e69ee41b211514d9983dba6784bf906652ff` |
| Umfasst | Regeltext · Rohbytes-Manifest · Vokabular · **das Skript selbst** |
| Anmeldung im Zugriffs-Register | `c0-freeze1-2026-08-19`, Art `C0_REGELFREEZE` |
| Angemeldet um | 2026-08-19T20:51:28Z |
| **Server-Bestätigung (GitHub-Uhr)** | 2026-08-19T20:51:48Z |
| Erster erlaubter Zugriff | 2026-08-19T21:16:22Z |

**Warum das Skript mit ins Siegel gehört:** Schwelle 20, Faktor 3, Zielband und Leiter
sind Konstanten *im Programm*; die Regeldatei daneben ist Prosa und wird von keinem
Rechenschritt gelesen. Ohne den Skript-Hash hätte jemand nach Sichtung der Zählungen
die Schwelle auf 18 setzen und neu ableiten können, ohne dass ein Wächter anschlägt —
genau der Fall, den C0 ausschließen soll. (Befund des Silent-Failure-Reviews.)

---

*Abschnitte 4 bis 8 — Zählstand, Themenliste, Verwechsler, Leiter, Sabotage-Protokoll
und Reproduktion — folgen nach dem Zähllauf.*
