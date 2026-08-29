# C0 — Die eingefrorene Themen-Auswahlregel für Strang C

**Status:** eingefroren mit FREEZE 1. Ab dem Freeze wird an dieser Datei nichts mehr
geändert. Jede spätere Änderung ist ein neuer Regelstand mit eigenem Hash und macht
alle danach abgeleiteten Ergebnisse ungültig.

**Zweck in einem Satz:** Die Liste der Themen, die Strang C untersucht, entsteht aus
einer mechanischen Regel über datierte externe Register — nicht aus der Erinnerung
eines Motors und nicht aus dem Rückblick. Wer die Liste aus der Erinnerung baut,
bekommt nur Gewinner und lernt „früh rein lohnt immer" (Überlebens-Selektion).

---

## 1 · Register — das Kandidaten-Vokabular

Drei Quellen. Alle datiert, alle gratis, alle ohne Konto abrufbar.

**Quelle A — Gartner „Top 10 Strategic Technology Trends"**
Jahrgänge 2008–2024. Genommen werden die zehn Listen-Überschriften je Pressemitteilung,
wörtlich. Abruf über `gartner.com/newsroom` bzw. den Wayback-Snapshot (der direkte
Abruf antwortet 403, über Wayback lesbar). Der Snapshot-Zeitstempel ist die Datierung.

**Quelle B — Gartner „Hype Cycle for Emerging Technologies"**
Frühester per Wayback abrufbarer Jahrgang bis 2024. Genommen werden **alle Einträge
der Grafik**, transkribiert im **Doppel-Verfahren**: zwei unabhängige Transkriptionen
desselben versiegelten Bildes, der Diff muss leer sein. Jahrgänge ohne abrufbare
Grafik sind eine **dokumentierte Lücke**, keine Prosa-Extraktion.

*Form der Transkription:* die Beschriftungen wörtlich, eine je Zeile, **alphabetisch
sortiert**. Die Sortierung ist eine reine Form-Normierung — sie nimmt der Prüfung die
Abhängigkeit davon, in welcher Reihenfolge ein Leser die Kurve abgeht, und lässt die
inhaltliche Prüfung (welche Beschriftungen stehen auf der Grafik) unberührt.
Ein nichtleerer Diff heißt: **Jahrgang bleibt Lücke**, nicht „eine der beiden Lesungen
auswählen".

**Quelle C — MIT Technology Review „10 Breakthrough Technologies"**
Jahrgänge 2001–2024. Genommen werden die zehn Listen-Titel je Jahresseite, wörtlich.
Live und gratis unter `technologyreview.com/10-breakthrough-technologies/JJJJ/`.

Nicht abrufbare Jahrgänge werden als **Lücke geloggt, nie ersetzt**.

---

## 2 · Begriff → Suchphrase (mechanisch, ohne Urteil)

Für jeden Register-Titel, in dieser Reihenfolge:

1. Titel **wörtlich** übernehmen (HTML-Entitäten auflösen, Leerraum normalisieren).
2. **Kleinschreiben.**
3. **Klammerzusätze streichen** — alles in `(…)` und `[…]` inklusive Klammern.
4. An `/`, `&`, ` and `, `,` in **Teilphrasen zerlegen**.
5. Jede Teilphrase trimmen; **rein alphabetische Teilphrasen mit ≤ 3 Zeichen
   verwerfen** („ai", „and" fallen raus — „5g" bleibt, weil nicht rein alphabetisch).
6. Leere Teilphrasen verwerfen, Duplikate über alle Quellen und Jahrgänge
   zusammenführen (Herkunft bleibt je Phrase vermerkt).

**Verboten:** Synonym-Tabelle, Alias-Tabelle, semantische Stoppliste,
Varianten-Erzeugung, Umschreiben von Titeln. Marketing-Floskeln fallen über null
Treffer von selbst heraus.

**Bekannte, hingenommene Folge:** Die EDGAR-Volltextsuche matcht nur die exakte
Phrase. Schreibvarianten wie „3-D printing" gegen „3D printing" entgehen der Zählung.
Das trifft Gewinner und Flops gleichermaßen und bleibt **unkorrigiert dokumentiert**.

---

## 3 · Zählgröße

`D(Begriff, j)` = Zahl **eindeutiger CIKs** (SEC-Firmennummern) mit mindestens einem
Filing der Root-Form 10-K im Kalender-**Einreichungsjahr** `j`, dessen Volltext die
exakte Phrase enthält.

Abfrage: EDGAR-Volltextsuche, `forms=10-K`, Phrase in Anführungszeichen,
`startdt=j-01-01`, `enddt=j-12-31`.

⚠ **Die Trefferzahlen der Volltextsuche zählen Dokumente, nicht Firmen.** Gezählt
werden **eindeutige CIKs**, niemals rohe Trefferzahlen. (Live gemessen: „blockchain"
2018 hat 232 Dokument-Treffer, aber nur rund 101 eindeutige CIKs.)

Bei **mehr als 5.000 Dokument-Treffern** gilt `D ≥ Schwelle` automatisch (die
Volltextsuche gibt oberhalb dieses Fensters keine vollständige Trefferliste heraus).
**Die Wachstumsbedingung ist für ein solches Jahr NICHT BERECHENBAR** — `D(t)` selbst
ist unbekannt, und ein geschätzter Wert wäre genau die Stelle, an der die Auswahl den
Daten folgen würde statt der Regel. Ein gedeckeltes Jahr **fällt deshalb als
Aufnahmejahr aus** und wird im Lauf-Report namentlich ausgewiesen.

**Zweistufig, aus Höflichkeit gegenüber der SEC:** erst ein Dokument-Treffer-Screen
(eine Abfrage je Begriff und Jahr), dann die CIK-Auszählung nur für Screen-Passierer
und deren Basisjahre. Der Screen lässt ein Jahr passieren, wenn die Dokument-Treffer
mindestens `ceil(Schwelle/4)` betragen; die Sicherheitsreserve Faktor 4 wird an den
tatsächlich ausgezählten Antworten nachgemessen (maximale Zahl CIKs je Treffer) und
im Lauf-Report ausgewiesen. Höchstens rund **10 Anfragen pro Sekunde**.

---

## 4 · Spike-Kriterium

Aufnahmejahr `t` = **frühestes** Jahr in **2004–2022** mit

- `D(t) ≥ 20` **und**
- `D(t) ≥ 3 × (D(t−3) + 1)`

Ein Begriff ohne solches Jahr kommt nicht in die Themenliste.

---

## 5 · Zusammenlegung

Zwei Begriffe werden **ein Thema**, wenn

- ihr Spike-Abstand ≤ 2 Jahre beträgt **und**
- die Jaccard-Überlappung ihrer Spike-Jahr-CIK-Mengen ≥ 0,5 ist.

Name des Themas: der **früher spikende** Begriff (bei gleichem Jahr: der
alphabetisch erste — feste Regel, damit das Ergebnis nicht von der Reihenfolge des
Laufs abhängt). Nah-Duplikate unterhalb dieser Schwellen bleiben **getrennte Zeilen**.

---

## 6 · Nachjustier-Leiter — eingefroren, nur zählstand-getriggert

Zielband **15–25** regel-generierte Themen. **Gehandelt wird nur außerhalb von 12–30.**
Jeder Schritt wird geloggt.

- Bei **> 30** Themen: erst Wachstumsfaktor `3 → 4 → 5`, dann Schwelle `20 → 30`.
- Bei **< 10** Themen: erst Schwelle `20 → 15`, dann Faktor `3 → 2,5`.

Die Leiter wird **schrittweise** durchlaufen und **hält an**, sobald der Zählstand im
Band 12–30 liegt.

⛔ **NIE mitglieds-getriggert.** Ausgelöst wird ausschließlich von der **Anzahl** der
Themen, nie davon, welche Themen drin oder draußen sind. Wer die Leiter zieht, weil
ein bestimmtes Thema fehlt, hat die Regel gebrochen.

**Versagt auch die Leiter**, ist „Registerklasse zu schmal" der **Befund des Laufs** —
die Regel wird berichtet, nicht gebogen.

---

## 7 · Kalibrier-Offenlegung (wörtlich, Pflichtbestandteil der Regel)

Schwelle **20** und Faktor **3** sind an den **Verwechslern** geeicht:

| Eichpunkt | Zählstand |
| --- | --- |
| 3D-Druck 2014 | 25 CIKs |
| Green Hydrogen 2021 | 28 CIKs |
| Metaverse 2022 | 54 CIKs |
| Cloud 2011 (Vergleich) | 233 Treffer |
| Cannabis 2014 (Vergleich) | ≥ 48 CIKs |

**Eichung an Flops ist Aufmerksamkeits-Sensitivität, keine Überlebens-Auswahl.**
An Gewinnern wurde nichts geeicht.

---

## 8 · Pflicht-Verwechsler und Mandats-Einträge

Pflicht-Verwechsler (Negativ-Kontrollen) sind: **3D-Druck, Metaverse, Wasserstoff,
Cannabis, Blockchain.**

Soweit die Regel sie **nicht selbst erzeugt**, kommen sie als `MANDAT`-gekennzeichnete
Einträge in die Liste — unlöschbar markiert. **Jede spätere Marker-Auswertung läuft
einmal mit und einmal ohne Mandats-Themen.**

**Das Cannabis-Nein ist ein Befund über die Regel, kein Fehler:** Die Registerklasse
„Tech-Fachpresse" begrenzt das Themenuniversum auf Technologie. Nicht-Tech-Manien
kann sie prinzipiell nicht liefern.

**Wann gilt ein Verwechsler als „von der Regel selbst erzeugt"?** Nur dafür — und für
nichts anderes — existiert die folgende, hier mit eingefrorene Kern-Wortliste. Sie
**wählt kein Thema aus und schließt keines aus**; sie entscheidet ausschließlich, ob
zu einem bereits regel-erzeugten Thema zusätzlich noch eine `MANDAT`-Zeile angelegt
wird. Ein regel-erzeugtes Thema, dessen Begriff einen dieser Kerne enthält, zählt als
selbst erzeugt:

| Pflicht-Verwechsler | Kerne (Teilzeichenkette im Begriff) |
| --- | --- |
| 3D-Druck | `3d printing`, `3-d printing`, `additive manufacturing`, `3d print` |
| Metaverse | `metaverse` |
| Wasserstoff | `hydrogen`, `green hydrogen`, `hydrogen economy`, `fuel cell` |
| Cannabis | `cannabis`, `marijuana` |
| Blockchain | `blockchain`, `distributed ledger` |

Im Zweifel entsteht **zusätzlich** eine `MANDAT`-Zeile — nie ein Thema weniger.

---

## 9 · Verbotene Merkmale

In Auswahl, Schwellen, Leiter und Zusammenlegung dürfen **nie** vorkommen:

- Kurse, Renditen, Volatilität
- Marktkapitalisierung
- Index- oder ETF-Zugehörigkeit, Index-/ETF-Volumina
- spätere Bekanntheit oder „Kaliber" — **auch kein LLM-Urteil „ist das ein echtes Thema?"**
- Motor-Erinnerung („KI fehlt, ergänz es")
- Analystenratings
- retrospektive Presse

Ebenso verboten: **Vokabular-Edits nach Sichtung der Zählungen** (einziger
Anpassungsweg ist die eingefrorene Leiter) und jede Synonym-/Aliastabelle.

---

## 10 · Reihenfolge — die Freeze-Punkte sind die Methodik

1. Register ziehen und versiegeln (R7): Rohbytes + Hash je Jahrgang.
2. Vokabular mechanisch extrahieren.
3. **FREEZE 1** — Regeltext + Rohbytes-Manifest + Vokabular hashen, Hash ins
   Zugriffs-Register, pushen, Server-Bestätigung abwarten. **Vor der ersten
   EDGAR-Zählung.** Geht der Push nicht, ist der Zähllauf blockiert.
4. Zähllauf (Screen, dann CIK-Auszählung). Jede Antwort versiegeln.
5. Spike-Erkennung, Zusammenlegung, ggf. Leiter.
6. Mandats-Ergänzung der fehlenden Pflicht-Verwechsler.
7. **FREEZE 2** — Themenliste + vollständige Filer-Listen je Thema + Query-Log +
   Leiter-Log, SHA-256 über das Bündel, Hash ins Register.

Die Filer-Listen sind Pflicht: eine spätere Etappe leitet daraus Korb-Mitgliedschaften
**jährlich neu** ab, ohne eine neue Auswahl-Entscheidung zu treffen.

**Reproduktion** läuft gegen die **versiegelten Rohantworten**, nicht gegen den
lebenden EDGAR-Index. EDGAR ist ein lebender Dienst; eine spätere Neuabfrage ist eine
Robustheitsnotiz, nie ein Korrekturkanal.
