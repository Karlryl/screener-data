# C1 — Die eingefrorene Zeitleisten-Regel für Strang C

**Gegenstand:** Für jedes der 26 C0-Themen eine Zeitleiste aus datierten, abrufbaren
Quellen. Beantwortet wird ausschließlich die **Ereignis-Seite** von Karls Frage
(„Wann war das Thema erkennbar?"). Die **Kurs-Seite ist nicht Gegenstand von C1** und
wird von C1 nicht berührt — kein Kurs, keine Rendite, kein Marktwert, kein Volumen.

Diese Datei wird **vor der ersten Messung** eingefroren (FREEZE 1, zusammen mit
`scripts/studie-c1.py`).

> **Zweiter Regelstand (FREEZE 1b), offen als Ersetzung angemeldet.** Nach FREEZE 1 und
> **vor** dem Ereignis- und Führungslauf haben zwei unabhängige Code-Reviews vier
> Stellen gefunden, an denen das Werkzeug still etwas anderes tat, als hier steht:
> (1) das Kontextfenster suchte die Phrase **ohne Wortgrenzen** und hätte `cloud` in
> `cloudy` gefunden — ein Beleg, der aussieht wie ein Beleg; (2) „Dokument nicht
> erreichbar" und „Phrase nicht enthalten" waren derselbe leere Wert; (3) aus einem
> **gedeckelten** EDGAR-Jahr wurden „früheste" Nennungen gezogen, obwohl die Quelle
> dort keine vollständige, datumssortierte Liste herausgibt; (4) der Kandidaten-Deckel
> griff **vor** der Zulässigkeitsprüfung und konnte einen gültigen Anker durch
> Datenmüll verdrängen. **Kein Schwellenwert, kein Zeitraum, keine Sonde und keine
> Fenstergröße wurde angefasst** — die Parameter des Abschnitts 2 bis 5 sind in beiden
> Ständen identisch. Die Verbreitungskurve war zu diesem Zeitpunkt bereits im Lauf; sie
> ist von keiner der vier Stellen berührt. Nachgemessen statt behauptet: von den
> geänderten Funktionen ruft `kurve` **eine einzige** auf — `themen()`, und dort kam
> nur eine zusätzliche Abbruchbedingung dazu (zwei Themen dürfen nicht denselben
> Dateinamen ergeben). Die von `themen()` zurückgegebene Liste ist in beiden Ständen
> **byte-gleich**; der Nachweis steht im C1-Bericht.

> **Dritter Regelstand (FREEZE 1c), ebenfalls offen angemeldet.** Der C0-Anker ist beim
> ersten Lauf **rot geworden** — und zwar zu Recht: für `transparency` zählte C0 im
> Aufnahmejahr 2004 genau 395 Firmen, C1 einen Tag später 394. Die Ursache wurde
> byte-genau gefunden, nicht vermutet: **EDGARs Volltextindex lebt.** Beide Läufe
> melden dieselben 446 Treffer, aber der heutige Index liefert nur noch 445 Dokumente
> aus; verschwunden ist `0001047469-04-006934:a2129092zex-13.htm` (IBMs Anhang 13 zum
> 2003er Jahresbericht) — das einzige Dokument, das IBM in diese Zählung brachte.
>
> Die erste Fassung des Ankers verlangte, dass eine **lebende** Quelle sich zwischen
> zwei Läufen nicht ändert. Das ist keine Eigenschaft, die es zu prüfen gäbe, sondern
> eine, die die Quelle nicht hat — der Wächter wäre von jetzt an dauerhaft rot, ohne je
> etwas über die Methodik auszusagen. Er wird deshalb **nicht abgeschwächt, sondern
> geteilt und verschärft** (Abschnitt 2). Der Sabotage-Fall, für den er gebaut wurde —
> eine Zeitleiste, die C0s Firmenzahl nicht reproduziert —, fliegt in der neuen Fassung
> weiterhin auf; zusätzlich fliegt jetzt auch eine **unerklärte** Abweichung auf, die
> die alte Fassung mit einer Toleranz verschluckt hätte. Gültig ist FREEZE 1c.

---

## 0 · Die SACHE, die diese Regel schützt

Zwei Wege würden C1 wertlos machen, und beide sind bequem:

1. **Rückblick-Wissen.** Wer weiß, dass KI groß wurde und 3D-Druck nicht, sucht bei
   KI gründlicher. Der Unterschied, den er später misst, ist dann sein eigener
   Suchaufwand. **Gegenmaßnahme:** Für alle 26 Themen läuft *dieselbe geschlossene
   Sondenliste* mit *derselben Abfrageform* und *derselben Ankerregel*. Es gibt
   keinen Handgriff, der nur bei einem Thema stattfindet. Kein Ereignis wird von Hand
   nachgetragen, auch kein „allgemein bekanntes".
2. **Motor-Erinnerung als Quelle.** Ein Datum, das aus dem Gedächtnis stammt, sieht
   in einer Tabelle genauso aus wie ein belegtes. **Gegenmaßnahme:** Jedes Datum in
   der Ausgabe trägt die SHA-256-Prüfsumme der Rohantwort, aus der es stammt; ein
   Datum ohne diese Prüfsumme ist ein Wächter-Abbruch, kein Schönheitsfehler. Wo
   keine Sonde ein Datum liefert, steht **NICHT BELEGBAR** — nie eine Schätzung.

---

## 1 · Die Themenmenge (unverändert aus C0)

Alle 26 Einträge aus `protocol/strang-c/C0-themenliste.json`, ohne Zusatz und ohne
Streichung — einschließlich der beiden Sprachmoden `transparency` und `reimagined`
und einschließlich der beiden `MANDAT`-Themen.

**Suchphrasen je Thema:**

- `REGEL`-Themen: das Feld `begriffe` aus C0 (bei der einzigen Zusammenlegung sind
  das zwei Phrasen). Die **Leitphrase** ist der Themenname — sie trägt die Zahlenreihe,
  weil C0 sein `D` ebenfalls aus der Leitphrase gebildet hat (`zusammenlegen()`
  übernimmt `spikes[name]["D"]`). Die Vereinigungsreihe über alle Begriffe wird
  zusätzlich ausgewiesen, ersetzt aber nie die Leitphrasen-Reihe.
- `MANDAT`-Themen: der kleingeschriebene Themenname (`metaverse`, `cannabis`).
  Andere Ableitung gibt es nicht; eine Synonymliste wäre genau das Urteil, das C0
  verboten hat.

---

## 2 · Die Verbreitungskurve (Karls „wann wurde es größer")

`D(Phrase, Jahr)` = **Zahl eindeutiger SEC-Firmennummern (CIK)**, die im Kalenderjahr
mindestens ein Formular 10-K eingereicht haben, dessen Volltext die exakte Phrase
enthält. Gezählt wird **mit demselben Code wie C0** — die Funktionen
`edgar_hole`, `treffer_gesamt`, `filer_aus` und `exakt_zaehlen` werden aus
`scripts/studie-c0.py` **importiert, nicht nachgebaut**. Eine nachgebaute Zählung
wäre eine zweite Wahrheit.

- **Zeitraum:** 2001–2025. 2001 ist die Untergrenze der EDGAR-Volltextsuche; 2026 ist
  unvollständig und bleibt draußen. Jede Reihe, deren erstes Jahr 2001 ist und dort
  schon `D>0` hat, gilt als **linkszensiert** und wird so gekennzeichnet.
- **Deckelung:** Meldet EDGAR oberhalb seiner internen Grenze nur eine untere Schranke,
  ist `D` für dieses Jahr **NICHT BERECHENBAR** (`gedeckelt: true`) — nie geschätzt,
  nie durch das Vorjahr ersetzt.
- **Anker gegen C0 — zweistufig, beide Stufen ohne Toleranz.**
  - **Stufe 1, Methoden-Identität:** Derselbe Zähl-Code muss aus **C0s versiegelten
    Rohantworten** für (Leitphrase, Aufnahmejahr) *genau* die Firmenmenge von C0s
    versiegelter Filer-Liste herausrechnen, und deren Größe muss `D` aus
    `C0-themenliste.json` sein. Das ist die Sache, die der Wächter schützt: dass C0 und
    C1 dasselbe messen. Abweichung ⇒ rot.
  - **Stufe 2, Live-Abweichung mit Erklärungspflicht:** Weicht die **heutige** Zahl von
    C0s Zahl ab, muss die Differenz byte-genau aufgehen — welche Dokument-Kennungen im
    einen Siegel stehen und im anderen nicht, und dass genau daraus die Firmendifferenz
    folgt. Eine Abweichung **ohne** diese Erklärung ⇒ rot. Ein Toleranzband gibt es
    nicht: es würde jede künftige stille Zähl-Drift durchwinken.
- **Linkszensur ist dreiwertig.** Ist `D(2001)` gedeckelt, heißt das **nicht**
  „nicht zensiert", sondern „nicht bestimmbar" (`null`).

---

## 3 · Die Beschleunigungs-Punkte (rein deskriptiv)

Alle vier Größen benutzen denselben Dreijahres-Abstand wie C0 (`BASIS_ABSTAND = 3`),
damit C0 und C1 dieselbe Sprache sprechen. Gerechnet wird nur über Jahre, deren `D`
berechenbar ist; ein gedeckeltes Jahr unterbricht die Rechnung, statt sie zu füllen.

| Größe | Definition |
| --- | --- |
| `verzehnfachung` | frühestes Jahr `y` mit `D(y) >= 10 * max(1, D(y-3))` |
| `letzteVerdopplung` | spätestes Jahr `y` mit `D(y) >= 2 * max(1, D(y-3))` |
| `hoehepunkt` | Jahr mit dem größten `D` (bei Gleichstand das frühere) |
| `kipppunkt` | frühestes Jahr `y > hoehepunkt` mit `D(y) <= 0,5 * D(hoehepunkt)` |

Fehlt eine Größe, steht `null` — das heißt „im beobachteten Fenster nicht eingetreten",
nicht „kommt nie".

---

## 4 · Die Ereignis-Sonden (Karls „wann kam es auf")

Fünf Sonden, geschlossene Liste, **alle 26 Themen durchlaufen alle fünf**. Jede Sonde
liefert null bis fünf datierte Kandidaten; jeder Kandidat trägt die Prüfsumme seiner
Rohantwort. Alle fünf Quellen sind ohne Zahlung, Konto oder Trial erreichbar (R7).

| # | Sonde | Ebene | Datum | Trefferregel | Untergrenze der Quelle |
| --- | --- | --- | --- | --- | --- |
| P1 | OpenAlex-API | **fachlich** | `publication_date` | exakte Phrase im **Titel**, Typ nicht `paratext` | — |
| P2 | Crossref-API | **fachlich** | frühester `published`-Datumsteil | exakte Phrase im **Titel**, Typ Aufsatz/Konferenzbeitrag | — |
| P3 | Wikipedia-API | **öffentlich** | Zeitstempel der **ersten Version** | Lemma stimmt (Groß-/Kleinschreibung egal) mit der Phrase überein | 2001 |
| P4 | EDGAR-Volltext | **öffentlich** | `file_date` des frühesten 10-K | exakte Phrase im Volltext | 2001 |
| | | | *entfällt (fail-closed), wenn das früheste Jahr mit Nennungen **gedeckelt** ist — dort gibt EDGAR keine vollständige, datumssortierte Liste heraus, „das früheste 10-K" wäre eine Behauptung über eine Liste, die niemand ganz sehen kann* | | |
| P5 | Federal Register | **öffentlich** | `publication_date` | exakte Phrase (Anführungszeichen-Suche) | 1994 |

**Warum diese Zweiteilung:** Ein Forschungsdurchbruch, über den außerhalb der
Fachwelt niemand schrieb, ist etwas anderes als ein Vorgang, den jeder sehen konnte.
Der **Abstand** zwischen beiden Ebenen ist selbst ein Ergebnis und wird je Thema
ausgewiesen.

**Ankerregel.**
`ankerFachlich = min(P1, P2)` · `ankerOeffentlich = min(P3, P4, P5)`.
Liefert eine Ebene keinen einzigen zulässigen Kandidaten, lautet ihr Anker
**NICHT BELEGBAR**. Alle Kandidaten bleiben in der Ausgabe stehen, auch die
späteren — die Wahl ist damit nachprüfbar statt behauptet.

**Der Kandidaten-Deckel greift NACH der Zulässigkeit.** Je Sonde werden bis zu fünf
ankerfähige **und** bis zu fünf nicht ankerfähige Kandidaten behalten, beide nach
Datum aufsteigend. Andernfalls könnten fünf kaputte Metadatensätze einen gültigen
Anker verdrängen — und ob ein Thema davon getroffen wird, hängt an der zufälligen
Datenqualität seiner Quellen, wäre also Ungleichbehandlung.

**Zulässigkeits-Ausschlüsse (fail-closed, für alle Themen gleich):**

1. **Weiterleitung auf ein anderes Lemma (P3).** Zeigt die Phrase auf einen Artikel
   mit anderem Titel (`additive manufacturing` → `3D printing`), gehört das Datum dem
   Zielartikel, nicht der Phrase. Der Kandidat wird **notiert und als
   `weiterleitungAufAnderesLemma` markiert, ist aber nicht ankerfähig.**
2. **Unplausible Metadaten (P1, P2).** Crossref führt Datensätze mit Jahr `0` oder
   ohne Ablage-Zeitstempel. Kandidaten mit Jahr < 1900 sind **nicht ankerfähig**, bei
   Crossref zusätzlich solche ohne `created`-Zeitstempel; sie werden notiert.
   **Scheingenauigkeit bei P1:** OpenAlex setzt reine Jahresangaben auf den 1. Januar.
   Das Jahr steht deshalb als eigenes Feld daneben — ein `2012-01-01` aus OpenAlex kann
   „irgendwann 2012" heißen.
3. **Randlage an der Quellen-Untergrenze.** Fällt ein Anker auf das Startjahr seiner
   Quelle, wird er als `linkszensiert` markiert: Das wahre Ereignis kann älter sein,
   die Quelle kann es nur nicht sehen. Der Anker bleibt gültig, die Marke steht dabei.

---

## 5 · Die Führungsfrage (Karls Vorläufer zur NVIDIA-Frage)

Je Thema die **acht frühesten 10-K-Nennungen**, sortiert nach (`file_date`, `cik`,
`adsh`). Für jede wird das Dokument bei der SEC geholt, die Phrase **an Wortgrenzen**
im Text gesucht (dieselbe Regel wie bei den Titel-Sonden) und ein **Kontextfenster von
±400 Zeichen** gespeichert. Nennungen, die aus einem **gedeckelten** Jahr stammen,
bleiben in der Liste — sonst verschwiegen wir die einzigen Namen, die es für dieses
Jahr gibt — und tragen die Marke `ausGedeckeltemJahr`.

**Rollenregel — mechanisch, in dieser Reihenfolge:**

1. `RISIKOTEIL`, wenn die letzte Abschnitts-Überschrift vor der Fundstelle
   `Item 1A` (Risikofaktoren) ist.
2. sonst die **Signalfamilie mit den meisten Treffern** im Kontextfenster:
   - `ANBIETER`: `our <phrase>`, `we offer/provide/sell/develop/market/design/launch`,
     `our products/solutions/platform/offerings/services`
   - `ANWENDER`: `we use/utilize/deploy/adopt/implement/rely on`, `our use of`
3. bei Gleichstand oder null Treffern: `ERWAEHNUNG`.

Die Signalzahlen stehen mit in der Ausgabe. **Diese Einordnung ist eine grobe
Kontext-Marke, kein Urteil über das Geschäftsmodell** — sie sagt, in welchem
Zusammenhang das Wort stand, mehr nicht. Ist das Dokument nicht abrufbar oder die
Phrase im Text nicht auffindbar, steht `NICHT BELEGBAR` — **mit unterschiedlichem
Grund**: „Index nicht abrufbar", „Index listet kein prüfbares Dokument", „keines der
Dokumente war abrufbar" und „Phrase nicht gefunden" sind vier verschiedene Sachverhalte
und werden nie zu einem zusammengezogen. Ein leeres Fenster wird nie als `ERWAEHNUNG`
gebucht.

**Bekannte Lücke, offen gelassen statt repariert:** Filings, die ihre Abschnitts-
Überschrift nur optisch (fett, größer) statt mit Satzzeichen abtrennen, sind aus reinem
Text nicht erkennbar. Dort bleibt `abschnitt` leer und die Rolle fällt auf die
Signalfamilien zurück.

**Kurs-Sperre:** Aus den Filing-Dokumenten wird ausschließlich das Kontextfenster um
die Themenphrase entnommen. Kein Kurs-, Rendite-, Marktwert- oder Volumenwert wird
gelesen, abgeleitet oder gespeichert.

---

## 6 · Rohbytes, Wiederaufnahme, Deckel

- Jede Rohantwort wird vor der Verarbeitung byte-genau unter ihrem SHA-256 versiegelt
  (R7), Ablage unter `$EARLY_DETECTION_DATA_ROOT/strang-c/`.
- Alle Langläufe schreiben JSONL zeilenweise und sind nach Absturz wiederaufnehmbar
  (R15c). Eine halbe Schlusszeile wird verworfen und protokolliert; eine beschädigte
  Zeile mittendrin hält an.
- R14: jede Nicht-Rohdaten-Datei unter 200 KB. Führungs-Fenster und Ereignis-Kandidaten
  liegen deshalb je Thema in einer eigenen Datei unter
  `protocol/strang-c/c1-fuehrung/` bzw. `protocol/strang-c/c1-kandidaten/`. Gekürzt
  wird nichts — eine unsichtbar gekürzte Kandidatenliste wäre genau die verdeckte
  Auswahl, die C1 ausschließt.
- R14c: Python-Standardbibliothek. Kein absoluter Pfad im Code (R12a).

---

## 7 · Geprüfte und verworfene Quellen (R17-Vermerk)

| Geprüft | Ergebnis |
| --- | --- |
| arXiv-API | antwortet nach dem ersten Abruf dauerhaft HTTP 429, auch bei 30 s Abstand. Eine Sonde, die je nach Tageszeit Kandidaten liefert oder nicht, erzeugt genau die Ungleichbehandlung zwischen Themen, die C1 ausschließt — **verworfen**. Zweiter Grund: arXiv deckt Physik/Informatik ab, nicht Chemie, Medizin, Energietechnik. |
| USPTO Open Data / PTAB-API | liefert ohne Schlüssel nur die Portal-HTML-Seite — **nicht tragfähig** |
| GDELT-Dokument-API | Volltext erst ab 2017; würde alte Themen systematisch benachteiligen — **nicht uniform, verworfen** |
| Google Books Ngrams | keine Programmschnittstelle, Datenende 2019 — **verworfen** |
| Presse-Archive mit Bezahlschranke | R7 verbietet Zahlung/Konto — **nicht angefasst** |

Die Sondierung lief mit der **neutralen Phrase `widget`**, die zu keinem der 26 Themen
gehört, damit kein Thema durch die Vorprüfung einen Vorsprung bekommt.

---

## 8 · Was C1 nicht kann

- **Kein Produktstart-Kanal.** Es gibt keine freie, uniforme, datierte Quelle für
  Produktankündigungen. Ein Produktstart taucht in C1 nur auf, wenn ihn eine der fünf
  Sonden ohnehin sieht. Das ist eine Lücke der Quellenlage, keine Auswahl.
- **Kein Nicht-US-Blick.** EDGAR und Federal Register sehen nur die USA.
- **Kein Kaliber-Urteil.** C1 datiert und zählt; ob ein Thema groß war, entscheidet C1
  nicht und darf es nicht.
