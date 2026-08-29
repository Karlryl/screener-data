# E4h — Serienende-Diagnose der 10-Q-Weiterfiler (Prüffenster 2017–2019)

**Lauf-ID** `e4h-serienende-pruefung-2026-08-29` · **Fenster** `pruefung` ·
**Variante** S-G · **Panelrand** 2020-12-31 · **Perzentil** 95
**Register-Eintrag** `381fd9e08651fd0410b4adc98a941300e8d0a3827070105fa70f60f417ec7c17`
(18. Eintrag, `count_only_probe_authorized`, main-first vor dem Zugriff angemeldet,
verkettet auf den E4g-v2-Eintrag `4183c341…`)
**Auftrag** ENTSCHIED 32.4 (orchestrator-2026-08-29.md) · **Vorlauf** E4g (PR #94)
**Maschinen-Ausgabe** `reports/studie/E4h-serienende-diagnose-2026-08-29.json`
**Freigabe-Beleg** `reports/studie/E4h-freigabe-pruefung-2026-08-29.json`

> **Dieser Bericht entscheidet NICHTS.** Die Regel „≥ 13 der 25 → Definitions-
> Artefakt → R15b-Pfad; < 13 → R15a" steht VORAB eingefroren in ENTSCHIED 32.4,
> geschrieben vor Kenntnis dieser Zahlen, ohne Grauzone. Sie wird vom
> Orchestrator angewandt, nicht hier.

---

## 0. OFFENLEGUNG ZUERST — ein Widerspruch im Eintragstext, den ich auflösen musste

Der Register-Eintrag verlangt **beides**:

1. den **Bit-Anker 25/192** — die Population muss exakt reproduziert werden, und
2. **„`fakt.value` wird ausdrücklich NICHT gelesen"**.

Beides zugleich ist wörtlich nicht erfüllbar: Die Population *ist* das Ergebnis
der Signal- und Reiferechnung, und die läuft über `scripts/studie-basisraten.py`,
das `fakt.value` liest. Ohne Wertlesung gibt es keine 25 und keine 192 — der
Pflicht-Selbstcheck des Eintrags wäre unerfüllbar.

**So ist es gebaut, und so ist es gemeint (Lesart offengelegt, nicht stillschweigend gewählt):**

| Teil | liest | Autorisierung |
| --- | --- | --- |
| Populations-Rekonstruktion (25/192) | `fakt.value`, unverändert über die importierte E4a/E2-Strecke | ENTSCHIED 17 / E4g-v2 — **dieselbe Datei, dasselbe verbrauchte Fenster** |
| **E4h-SONDE** | ausschließlich `adsh, tag, version, uom, ddate, qtrs` | dieser Eintrag |

Die ORCHESTRATOR-ANTWORT begründet den Scope selbst so: „eine Metadaten-Lesung
ist echte Teilmenge der bereits autorisierten Wertlesung". Eine Lesart, die den
eigenen Pflicht-Selbstcheck des Eintrags unmöglich macht, kann nicht gemeint
sein.

**Die Wert-Schranke der Sonde ist mechanisch, nicht behauptet:**
`pruefe_sondenabfrage()` hält jede SQL gegen eine Spalten-Allowlist und bricht
ab, sobald `value` vorkommt — in der Spaltenliste *oder* in der WHERE-Klausel.
Der Selbsttest belegt, dass die Wache **auf dem echten Lesepfad sitzt** (nicht
nur existiert): `lies_fakt_metadaten` läuft gegen ein Fixture, und danach wird
die Abfrage geprüft, die dabei *wirklich* durch die Wache lief. Ein Textscan über
die Datei könnte das nicht leisten — er stünde in seinem eigenen Suchraum, weil
die Sabotage-Fixtures die verbotene Spalte absichtlich als Zeichenkette
enthalten. Der Bericht weist die gelesenen Spalten im JSON-Feld `sondenSpalten`
aus; ein Weglassen fliegt in der Ergebnis-Sperre auf.

**Falls der Orchestrator diese Auflösung nicht teilt, ist der Lauf zu verwerfen.**
Deshalb steht die Offenlegung hier ganz oben und nicht in einer Fußnote.

---

## 1. Selbst-Check (Bit-Anker, im Register-Eintragstext gehasht) — BESTANDEN

| Größe | Soll (committet) | Ist (dieser Lauf) |
| --- | --- | --- |
| S-G Signal-Weiterfiler (10-Q) | 25 | **25** |
| S-G Kontrollpool-Weiterfiler (10-Q) | 192 | **192** |
| S-G Signal-Fallzahl (2. Anker) | 326 | **326** |
| S-G Kontrollpool-Fallzahl (2. Anker) | 4285 | **4285** |

Die Populations-Logik ist **byte-gleich** zu E4gs Sonde 2 (`letzte_form`); der
Anker sitzt VOR dem Sonden-Lesepfad, eine falsche Population käme gar nicht erst
bis zur Sonde. Die Selbsttest-Sabotagen 24 / 26 / 191 / „25 bei Fallzahl 327"
feuern nachweislich.

Gelesen: ausschließlich `panel/panel-validierung.sqlite`. Geschrieben:
ausschließlich der eigene Zwischenstand unter `arbeit/`. Siegel unberührt.
**Unabhängige Wiederholung:** Der Lauf wurde ein zweites Mal aus demselben Panel
gefahren — Population und Metadaten-Menge identisch (200.397 Metadatenzeilen für
217 Firmen). Determinismus bestätigt.

---

## 2. Die exakte Operationalisierung von „nutzbar" (Offenlegungspflicht)

Eine Alternativ-Serie gilt für eine Firma genau dann als **nutzbar**, wenn es
**einen** Schlüssel `(tag, uom, version)` gibt, der **alle vier** Bedingungen
erfüllt:

1. Er kommt in Einreichungen vor, die **nach** dem Signal angenommen wurden
   (`accepted(Bericht) > accepted(Signal)`) — kein Vorgriff (R11).
2. Er weicht auf **mindestens einer** der drei Achsen von der gewählten Serie ab
   (Konzept `tag`, Einheit `uom`, Track `version`).
3. Er trägt `qtrs = '1'` — echte **Quartals**fakten, keine Jahreswerte.
4. Er deckt **mindestens 4 verschiedene** Bilanzstichtage `ddate > ddate(Signal)`
   innerhalb des Panelfensters ab.

**Die Schwelle 4 ist NICHT frei gewählt.** Sie ist wörtlich die eingefrorene
Reifebedingung `REIFE_QUARTALE` aus `scripts/studie-basisraten.py`. Die Frage
lautet ja genau: *wäre diese Firma unter einer korrigierten Konstruktionsregel
reif geworden?* Jede andere Zahl wäre eine neue Schwelle und damit eine
Methodikänderung — und, bei freier Wahl, exakt die verbotene Schwellensuche.
Es wurde **eine** Fassung gerechnet; es gibt keine zweite Variante.

**Achsen-Einordnung je Firma:** Liegen mehrere qualifizierende Schlüssel vor,
zählt der mit den **wenigsten** abweichenden Achsen — der konservativste, der
gewählten Serie nächste. Gleichstand wird deterministisch aufgelöst (erst nach
Zahl der Achsen, dann nach fester Achsen-Reihenfolge Konzept < Unit < Track).
Das schiebt die Zahlen systematisch zu „nur eine Achse" statt zu „mehrere" —
also **gegen** den Eindruck eines breiten Konstruktionsfehlers.

**Woher die drei Achsen kommen (gelesen, nicht geraten):** Die Serien-Konstruktion
gruppiert nach `(tag, uom)` und filtert `version` nur (`STANDARD_VERSION_RE`),
sie schlüsselt nicht danach. Der **gewählte Track** wird deshalb aus den
Metadaten der Quartale **vor** dem Signal gelesen: alle Taxonomie-Fassungen,
unter denen die gewählte Kennung in dieser Einheit bis zum Signal gemeldet wurde.
Konzept und Unit stehen direkt an der Signal-Basis. Die Sonde filtert bewusst
**weder** nach `ALLE_TAGS` **noch** nach `STANDARD_VERSION_RE` — die Frage ist ja
gerade, was *außerhalb* der eingefrorenen Quellenliste liegt; ein Vorfilter würde
die Antwort in die bequeme Richtung schieben.

**Zwei getrennte Abdeckungs-Achsen (bewusst nicht derselbe Zähler):**
`ddate_abgedeckt` fragt, ob die Firma nach dem Signal überhaupt vier verschiedene
Bilanzstichtage trägt (jede Periodenlänge); `qtrs_abgedeckt` fragt, ob darunter
vier **Quartals**stichtage sind. Eine Firma, die in ihren 10-Q nur noch
Jahreswerte meldet, deckt die erste Achse und reißt die zweite. Beide aus einem
gemeinsamen Vorfilter zu rechnen hätte diesen Fall unsichtbar gemacht — der
Selbsttest hält die Unterscheidung an einem eigenen Fixture fest.

---

## 3. Signalarm — die 25 Weiterfiler

| Feld | Wert |
| --- | --- |
| `nenner_alternativpruefung` | **25** |
| `fallzahl` (2. Anker) | 326 |
| `gewaehlte_serie_endet` | 1 |
| `quartalsfakten_im_filing_vorhanden` | 25 |
| `ddate_abgedeckt` (≥ 4 Stichtage nach dem Signal, jede Periodenlänge) | **4** |
| `qtrs_abgedeckt` (≥ 4 QUARTALS-Stichtage nach dem Signal) | **4** |
| **`mit_nutzbarer_alternativserie`** | **4** |
| `ohne_nutzbare_alternativserie` | 21 |
| `alternativ_nur_anderes_konzept` | 1 |
| `alternativ_nur_andere_unit` | 0 |
| `alternativ_nur_anderer_track` | 0 |
| `alternativ_mehrere_achsen` | 3 |

### Der Befund, der die Zahl erklärt: die Decke liegt bei 4, und die Sonde erreicht sie exakt

`mit_nutzbarer_alternativserie` (4) **ist gleich** `qtrs_abgedeckt` (4). Das heißt:
**jede einzelne Firma, die nach ihrem Signal überhaupt vier Quartals-Stichtage
trägt, hat auch eine nutzbare Alternativ-Serie.** Die Sonde verliert keine Firma
an der Konzept-, Unit- oder Track-Frage — sie schöpft die vorhandene Datenlage
vollständig aus.

Die bindende Schranke ist also **nicht** die Serien-Konstruktion, sondern die
Datenlage: **21 der 25 Firmen tragen im Panel nach ihrem Signal gar keine vier
Quartals-Stichtage** — unter *keinem* Konzept, *keiner* Einheit, *keinem* Track.
Sie reichen 10-Q ein (`quartalsfakten_im_filing_vorhanden` = 25/25, d. h. alle 25
melden nach dem Signal weiterhin Quartalsfakten), aber die Zahl der neuen
Quartals-Stichtage reißt ab, bevor vier zusammenkommen.

Das deckt sich exakt mit E4a: dort sind 24 dieser 25 Firmen Klasse (c) — „1 bis 3
Folgequartale". E4h zeigt, dass diese 1–3 auch dann 1–3 bleiben, wenn man
sämtliche Konzepte, Einheiten und Taxonomie-Fassungen zulässt. Der Verlust ist
damit **keine Frage der gewählten Kennung**.

Eine Gegenprobe intern gefahren (nur Konsole, nicht Teil der Ausgabe): die
Verteilung der Quartals-Stichtage nach dem Signal fällt **glatt** ab, ohne Klippe
bei null. Ein Filterfehler hätte eine Klippe erzeugt; ein glatter Abfall ist eine
Dateneigenschaft.

## 4. Kontrollpool — die 192 Weiterfiler (Gegenprobe, gleicher Code)

| Feld | Wert |
| --- | --- |
| `nenner_alternativpruefung` | **192** |
| `fallzahl` (2. Anker) | 4285 |
| `gewaehlte_serie_endet` | 8 |
| `quartalsfakten_im_filing_vorhanden` | 192 |
| `ddate_abgedeckt` | 38 |
| `qtrs_abgedeckt` | 26 |
| **`mit_nutzbarer_alternativserie`** | **23** |
| `ohne_nutzbare_alternativserie` | 169 |
| `alternativ_nur_anderes_konzept` | 4 |
| `alternativ_nur_andere_unit` | 0 |
| `alternativ_nur_anderer_track` | 0 |
| `alternativ_mehrere_achsen` | 19 |

Derselbe Mechanismus, dieselbe Größenordnung: 23 von 192 (12,0 %) gegen 4 von 25
(16,0 %) im Signalarm. Der Kontrollpool bestätigt damit, dass die Klasse **nicht**
signal-spezifisch ist — was gegen einen Konstruktionsfehler spricht, der
ausgerechnet die Signalfirmen träfe.

Hier zeigen die beiden Abdeckungs-Achsen ihren Nutzen: `ddate_abgedeckt` = 38,
`qtrs_abgedeckt` = 26. **12 Firmen tragen vier Stichtage, aber keine vier
QUARTALS-Stichtage** — sie melden nach dem Signal nur noch Jahreswerte in ihren
Einreichungen. Wären beide Zähler aus einem gemeinsamen Vorfilter gerechnet
worden, wäre genau dieser Fall unsichtbar geblieben. Im Signalarm existiert er
nicht (38→26 im Kontrollpool, 4→4 im Signalarm).

Auffallend auf beiden Seiten: **Unit und Track tragen NULL Firmen allein.** Wo
eine Alternative existiert, unterscheidet sie sich am Konzept (allein oder in
Kombination). Die Hypothesen „Einheitenwechsel" und „Taxonomie-Wechsel" als
eigenständige Verlustursache sind damit auf dieser Population **leer**.

## 5. Neue Fragen und Hypothesen (R16)

Offene Fragen, die dieser Lauf AUFGEWORFEN, aber nicht beantwortet hat. Keine
davon ist hier entschieden.

1. **Warum reißt die Quartals-Meldung ab, obwohl die Firma 10-Q einreicht?**
   21 von 25 tragen nach dem Signal weniger als vier Quartals-Stichtage, bei
   laufender 10-Q-Kadenz. Hypothese: nicht die Firma und nicht die Kennung, sondern
   die **Panel-Befüllung** endet — etwa weil die SEC-Datensätze je Filing nur eine
   Teilmenge der Fakten führen. Das wäre eine Eigenschaft der Datenquelle, nicht
   der Studie, und prüfbar nur gegen eine zweite Quelle.
2. **Ist das Prüffenster schlicht zu kurz?** Vier Folgequartale ab einem Signal,
   das bis 2019-12-31 feuern darf, gegen eine Panel-Kante 2020-12-31 — dieselbe
   Geometrie-Enge, die schon E4gs Kantenprobe strukturell feuerunfähig machte
   (ENTSCHIED 32.2). Beide Diagnosen stoßen an denselben Bandzuschnitt.
3. **Warum tragen Unit und Track null Firmen allein?** Entweder gibt es diese
   Wechsel in dieser Population nicht, oder sie treten nur gemeinsam mit einem
   Konzeptwechsel auf (19 der 23 Kontroll-Treffer liegen auf mehreren Achsen).
   Die Zahlen unterscheiden das nicht.
4. **Ist `gewaehlte_serie_endet` = 1 von 25 der eigentliche Hinweis?** Nur EINE
   Firma bricht wirklich ab; 24 laufen weiter, nur zu kurz. „Serienende" ist damit
   der falsche Name für die dominante Klasse — es ist ein Serien-VERKÜRZEN.

## 6. Was dieser Lauf nicht getan hat

Keine Entscheidung, keine Korrektur, keine neue Serien-Konstruktion, keine
Schwellen- oder Reifeänderung, keine neue Präregistrierung, kein Ledger-Append,
kein Siegel-Kontakt, kein anderes Fenster, kein Endtest, keine Firmen-Kennung,
keine `adsh`-/`cik`-/Namenswerte, keine Konzept- oder Unit-Listen, keine
Wertangaben, keine Naht-ID des Brücken-Artefakts. `e4d-freeze` ist unberührt
(E4h ist Diagnose, keine Korrektur — gleiche Klasse wie E4g). Der Lauf startete
aus einem frischen Worktree von `origin/main` (Post-#95-Stand, 18-Einträge-Kette),
damit Erzeuger UND Verbraucher an die gültige Registerkette binden; der
Studienzweig bekommt den main-Ledger nicht.
