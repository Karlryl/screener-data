# T140 — "dieselben Zahlen unter einem anderen Datum": ueber 29 Vintage-Paare nicht vorhanden

**Datum:** 2026-09-19 · **Lane:** D-T140 (Daylauf 19.09.) · **Branch:** `lane-d/T140`
**Werkzeug:** `scripts/t140-perioden-enden-gegenprobe.js` · **Rohbefund:** `reports/t140-perioden-enden-gegenprobe-2026-09-19.json`
**Waechter:** `tests/t140-perioden-enden-gegenprobe.test.js` (10 Pruefungen, vier Sabotagen rot gesehen)
**Gegenprobe:** zweiter Motor (Codex), Auftrag kippen — Befund in §8

## AUF EINEN BLICK

**Die Kipp-Bedingung von T140 ist ueber 29 benachbarte Vintage-Paare und 208.983
Zeilenvergleiche NULL mal erfuellt — es gibt keine Zeile, die eine inhaltlich belegte
Umsatz- oder Bruttogewinnreihe unveraendert unter einem neuen Perioden-Ende traegt.**
Die von T140 vermutete Erscheinung — *dieselben Zahlen unter einem anderen Datum* — ist
damit **nicht vorhanden**; was bleibt, ist Feldeinfuehrung und Quartals-Rollover.

**Was daraus NICHT folgt** (Einwand des zweiten Motors, angenommen): "kein
Ausrichtungsfehler" ist eine staerkere Aussage als die Messung traegt. Die Kipp-Bedingung
verlangt **byte-identische** Werte; eine Fehlausrichtung, bei der die Enden wandern und
*mindestens ein* Wert revidiert wird, faellt in "Rollover" und bleibt unsichtbar. Am
Synthetik-Fall belegt: `[100,90,80]` -> `[101,90,80]` bei einem Quartal Datumsversatz
ergibt 0 Treffer. Der Befund lautet also praezise: **die Kipp-Bedingung haelt, die
Abwesenheit eines Ausrichtungsfehlers ist damit nicht bewiesen.**

- Die Messebene existiert doch: `board-history/<datum>/<board>.json`, Block
  `cohort.<track>[].pit`. Der Versuch vom 31.08. mass `findash-export/v1` — dort reisen
  die Perioden-Enden nicht mit, deshalb dort null Treffer auf eine Frage, die dort gar
  nicht gestellt werden kann.
- **Die Originalzahlen reproduzieren sich EXAKT**, nicht nur ungefaehr: Paar
  2026-08-07 -> 2026-08-09 mit track-gebundenem Schluessel und ohne das survival-Board
  ergibt **8.313 gemeinsame Zeilen, 729 geaenderte `revenueQEnds`, 493 geaenderte
  `revenueQ`** — die drei Zahlen des Items. Damit ist die Messebene des Ursprungsbefunds
  identifiziert (`--track-gebunden --ohne-survival`).
- **723 scheinbare Treffer sind inhaltslose Reihen** (durchgehend 0/null), die mit dem
  Quartalsfenster mitwandern — Klasse "Anwesenheit statt Inhalt" wie T134/T142, nicht
  Neu-Etikettierung. Getrennt gezaehlt, sonst haetten sie die Kipp-Bedingung 723 mal
  falsch ausgeloest.
- Nebenbefund mit Zahl, ohne Bau: im Vintage 2026-09-18 tragen **1.655 von 8.818 Zeilen
  (18,8 %)**, die `pitCoverage.grossProfitQEnds` als gedeckt zaehlt, eine
  `grossProfitQ`-Reihe ohne jeden Inhalt (1.339 reine 0-Reihen + 316 ohne Werte).

## 1 · Der Auftrag, woertlich

> "729 Zeilen mit veraenderten Perioden-Enddaten, aber nur 493 mit veraenderten
> Umsatzwerten — mindestens 236 Zeilen tragen dieselben Zahlen unter einem anderen
> Datum. Entweder legitime Neu-Etikettierung durch den Provider oder ein
> Ausrichtungsfehler. Beruehrt T126/T134 (Jahresreihen-Frische)."

Die Antwort vom 28.08. (Executor-2) hat die Frage am Artefakt beantwortet — kein Defekt,
327 echte Faelle, alle `null -> Array` — und eine **Kipp-Bedingung** hinterlassen:

> "ein `Array -> Array` mit geaendertem Datum und identischen Werten — aktuell 0 von 729."

Dieser Lauf misst genau diese Bedingung, und zwar nicht mehr an einem Paar, sondern an
allen 29, die das Archiv hergibt.

## 2 · Die Messebene — der Punkt, an dem der 31.08. scheiterte

`board-history/<datum>/<board>.json` traegt je Zeile unter `pit`:
`revenueQ` + `revenueQEnds` und `grossProfitQ` + `grossProfitQEnds`, jede Reihe mit
**ihrem eigenen** Ends-Array. Das ist die 8.3k-Zeilen-Ebene des Ursprungsbefunds
(Vintage 2026-08-07: 8.763 Zeilen, davon 7.529 mit `revenueQEnds`).

`findash-export/v1` traegt diese Felder nicht. Der Vermerk vom 31.08.
("auf der veroeffentlichten Ebene gibt es die Felder gar nicht") war fuer den
findash-Export richtig und fuer die Frage die falsche Ebene — dieselbe Falle, die der
Vermerk selbst benennt: **erst die Messebene, dann die Zahl.**

## 3 · Die Klassen, und warum diese

Verglichen werden nur Zeilen, die in **beiden** Staenden vorkommen (Schluessel
`board|ticker`). Je Reihe und Paar:

| Klasse | Bedeutung |
| --- | --- |
| `nullToArr` | Enden gab es vorher gar nicht -> Feldeinfuehrung/Nachzug, kein Befund |
| `arrToNull` | Enden verschwinden -> Gewinnerwechsel/Abdeckungsverlust |
| `arrArr` | Enden geaendert, beide Arrays -> **der einzige Kandidatenraum fuer T140** |
| `arrArr` / `kipp` | Werte byte-identisch UND Reihe nicht durchgehend 0/null -> **der Befund** |
| `arrArr` / `kippZero` | Werte byte-identisch, aber die ganze Reihe ist 0/null -> inhaltslos |
| `arrArr` / Rest | Werte aendern sich mit -> normaler Quartals-Rollover |

Die Trennung `kipp` / `kippZero` ist nicht kosmetisch: ohne sie meldet der Zaehler
**723 Treffer**, und jeder einzelne davon ist eine `[0,0,0,0]`-Reihe, die mit dem
rollenden Datumsfenster mitlaeuft (Beispiel `consumer-discretionary|8919.T`,
2026-08-07 -> 2026-08-09: Enden `2026-03-31…2025-06-30` -> `2026-06-30…2025-09-30`,
Werte beide Male `[0,0,0,0]`). Das ist keine Neu-Etikettierung von Zahlen, sondern das
Fehlen von Zahlen.

## 4 · Die Zahlen

**Gesamt ueber 29 Paare, 208.983 Zeilenvergleiche** (Default: alle Boards, Schluessel
`board|ticker`):

| Reihe | Enden geaendert | Werte geaendert | null->arr | arr->null | arr->arr | **kipp** | (inhaltslos) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenueQ` | 5.182 | 10.070 | 2.102 | 66 | 3.014 | **0** | 38 |
| `grossProfitQ` | 5.314 | 7.302 | 2.244 | 66 | 3.004 | **0** | 685 |

**Das Paar des Ursprungsbefunds, 2026-08-07 -> 2026-08-09**, in allen vier
Schluessel-/Umfangs-Varianten:

| Variante | gemeinsam | `revenueQEnds` ge. | `revenueQ` ge. | kipp |
| --- | ---: | ---: | ---: | ---: |
| ungebunden, mit survival (Default) | 8.412 | 763 | 521 | 0 |
| track-gebunden, mit survival | 8.406 | 757 | 518 | 0 |
| ungebunden, ohne survival | 8.319 | 735 | 496 | 0 |
| **track-gebunden, ohne survival** | **8.313** | **729** | **493** | **0** |

Die letzte Zeile ist **Zeichen fuer Zeichen die Zahlentripel des Items**. Der
Ursprungsbefund wurde also track-gebunden und ohne das survival-Board gemessen; die
Messebene ist damit nicht nur plausibel, sondern identifiziert. Von den 729 sind
**614 `null -> Array`** und **115 `Array -> Array`**, davon **0** mit erfuellter
Kipp-Bedingung.

Die "mindestens 236" waren — wie schon am 28.08. gezeigt — eine Differenz zweier nicht
geschachtelter Mengen und beschreiben keine eigene Zeilenklasse. Der Gegenmotor hat die
echte Zahl unabhaengig nachgezaehlt: **330 Zeilen mit geaenderten Enden bei unveraendertem
Umsatz** (track-gebunden 327) — und **alle** bekommen erstmals ueberhaupt ein Datum.
"Mindestens 236" ist damit eine gueltige Untergrenze, aber kein Beleg fuer die Umbenennung
bereits datierter Werte.

**Die `null -> Array`-Welle laeuft aus:** 2.102 der 5.182 Datumsaenderungen sind
Feldeinfuehrung, und sie konzentrieren sich auf Juli bis Mitte August. Ab 2026-08-16 sind
es einstellige Zahlen — der Nachzug ist durch, und was seitdem an Datumsaenderungen
bleibt, ist fast ausschliesslich `Array -> Array` mit mitlaufenden Werten, also Rollover.

## 5 · Die offene Teilfrage des Items

Der Vermerk vom 31.08. fragte: *"decken sich die 236 Zeilen mit QS<->FTS-Gewinnerwechseln?"*
Die Frage hat sich auf dieser Ebene erledigt, und zwar in beide Richtungen:

1. Die 236 sind keine Menge, sondern eine Differenz (28.08.). Der echte Kandidatenraum am
   Ursprungspaar sind die 115 `Array -> Array`-Zeilen.
2. Ein QS<->FTS-Gewinnerwechsel setzt die Jahres-Enden per `_applyAnnualIncomeWinner` hart
   auf `null` (`pull-yahoo.js`) — er erzeugt also die Klasse `arrToNull`, nicht "gleiche
   Zahlen unter neuem Datum". Diese Klasse ist ueber alle 29 Paare **63 mal** belegt und
   damit sichtbar, aber sie ist nicht der Befund, den T140 vermutete.

## 6 · Nebenbefund (gemessen, NICHT gebaut)

Beim Trennen der inhaltslosen Reihen faellt eine Zahl an, die nicht zum Auftrag gehoert
und deshalb hier nur berichtet wird:

- Vintage **2026-09-18**: 8.818 Zeilen tragen ein `grossProfitQEnds`-Array und zaehlen
  damit in `pitCoverage.grossProfitQEnds`. **1.655 davon (18,8 %)** haben eine
  `grossProfitQ`-Reihe ohne jeden Inhalt — aufgeteilt in **1.339 reine 0-Reihen** und
  **316 Reihen ohne Werte** (`null`/leer). Gemischte Reihen (teils 0, teils Zahl) gibt es
  **0**: es ist alles-oder-nichts. Bei `revenueQ` sind es 41.
- **Was es NICHT ist:** kein Achsen-Defekt. `gpGrowth` liest `annualGP`
  (`src/scoring/axes.js:223`), nicht die Quartalsreihe. Die Hypothese "1.279 Zeilen
  bekommen ein gpGrowth-Perzentil aus einer Null-Reihe" wurde am Code geprueft und ist
  **widerlegt**; der Gegenmotor hat es unabhaengig bestaetigt (`gpGrowth` liefert in
  beiden Varianten denselben Wert).
- **Was es sehr wohl beruehrt — Fund des Gegenmotors, von mir am Code nachvollzogen:**
  die Quartals-GP-Reihe haengt an einem **Ranking-Ausschluss**. `lamps.js:214` liest
  `grossProfitQ`, `lamps.js:231` prueft daraus die Bruttomarge, und `score.js:378`
  uebernimmt die Warnung als Ausschlussgrund. Die ausgefuehrte synthetische Gegenprobe:
  mit `grossProfitQ = [140,60,60,60,60]` ergibt sich **Warnung = true, Ausschluss = true**;
  dieselbe Zeile mit fuenf Nullen ergibt **false/false**. Der Abhaengigkeitspfad ist damit
  **nachgewiesen** — eine reale Fehlplatzierung dagegen **nicht**: dafuer braeuchte es die
  vollen Snapshots (der PIT-Block fuehrt kein `opIncQ`). Das ist der Punkt, an dem ein
  eigener Inbox-Eintrag anzusetzen hat.
- **Wo es ausserdem haengt:** `pit.revenueQ + pit.grossProfitQ` ist der
  Identitaets-Fingerabdruck der Doppelgaenger-Probe
  (`scripts/probe-dedup-fingerprint.js:84`, `scripts/filter-snapshot-merge.js:582`).
  Dessen Begruendung lautet woertlich: "Beide, weil eine einzelne Reihe zufaellig
  uebereinstimmen kann … beide zusammen nicht." Fuer die 18,8 % ist die zweite Haelfte
  eine Konstante — der Fingerabdruck degeneriert dort auf `revenueQ` allein. Das ist eine
  **Abschwaechung der dokumentierten Trennschaerfe, kein belegter Fehlbefund**; die
  Pflicht-Auflage `istBelastbar()` haengt ohnehin an `revenueQ`.

## 7 · Geltungsbereich, ehrlich

- Gemessen wird die **veroeffentlichte Vintage-Ebene**, nicht der Snapshot-Eingang. Eine
  Fehlausrichtung, die schon vor `buildPit` passiert und beide Felder konsistent
  mitverschiebt, ist auf dieser Ebene unsichtbar.
- 29 Paare decken 2026-07-14 bis 2026-09-18 ab. Aussagen ueber frueher tragen nicht.
- `JSON.stringify`-Gleichheit ist ein **hartes** Mass: eine FX-Neuumrechnung aendert die
  Werte und faellt damit in "Rollover", nicht in "Kipp". Der Befund "0 Kipp" ist dadurch
  konservativ in der sicheren Richtung — er kann Treffer verpassen, aber keine erfinden.

## 8 · Gegenprobe durch den zweiten Motor

Der Lauf ist gegen einen zweiten Motor gefahren worden (Codex, `gpt-6-astra`, read-only,
Auftrag ausdruecklich **kippen statt bestaetigen**; Brief
`~\.codex\delegation-locks\sd-T140-duell-20260919.md`, Artefakte unter
`%TEMP%	140-codex\`). Er hat einen **eigenen** Zaehler geschrieben und erst danach
meinen Code gelesen. Ergebnis:

| Behauptung | Verdikt | Folge |
| --- | --- | --- |
| B1 Messebene ist der PIT-Block | haelt | — |
| B2 735/496 am Ursprungspaar | haelt | + die exakte Reproduktion 8.313/729/493 |
| B3 620 `null->Array`, 115 `Array->Array` | haelt | — |
| B4 Kipp-Bedingung 0 ueber alle Paare | haelt | auch mit FX-Rueckrechnung und Toleranz 1e-9 |
| B5 "kein Ausrichtungsfehler" | **unklar** | Aussage abgeschwaecht, s. AUF EINEN BLICK |
| B6 1.573 von 8.714 | **kippt** | Zahl korrigiert und aufgeteilt, s. §6 |

**Drei Korrekturen sind in diesen Bericht und ins Werkzeug eingeflossen:**

1. **Ein Defekt im Messwerkzeug.** Meine erste Fassung fuehrte eine Namensliste
   `['calibration.json','regime.json','survival.json']` mit der Begruendung "tragen kein
   cohort". Fuer `survival.json` ist das **falsch** — die Datei hat eine Kohorte, und die
   Liste nahm 24 Boards still aus der Messung, ohne dass eine Zahl verdaechtig ausgesehen
   haette. Die Liste ist ersatzlos entfernt (das Kriterium ist jetzt die Sache selbst:
   hat die Datei ein `cohort`), und ein Waechter pinnt genau das. Alle Zahlen dieses
   Berichts sind danach neu erhoben.
2. **B5 abgeschwaecht.** Die Kipp-Bedingung kann eine Fehlausrichtung mit gleichzeitiger
   Wertrevision nicht sehen — am Synthetik-Fall belegt. "Kein Ausrichtungsfehler" ist
   deshalb als Aussage zurueckgenommen; der Bericht behauptet nur noch die Abwesenheit
   der konkreten Erscheinung, die T140 beschrieb.
3. **B6 korrigiert** (1.339 + 316 statt pauschal 1.573) und um den Fund erweitert, der
   der wertvollste des Duells ist: der `lamps.js` -> `score.js`-Ausschlusspfad (§6).

Ein Einwand des Gegenmotors ist **nicht** uebernommen: die Beobachtung, dass die
*woertliche* Kipp-Bedingung des 28.08. (ohne Inhalts-Filter) sehr wohl Treffer hat
(Beispiel `utilities|003816.SZ`, 25.08. -> 28.08., Umsatz bleibt `[0,0,0,0]`). Das ist
richtig, aendert aber nichts: eine Reihe aus Nullen traegt keine "Zahlen", die unter einem
neuen Datum wiederauftauchen koennten. Die Verschaerfung ist im Bericht offengelegt und
beide Zahlen stehen nebeneinander — wer die woertliche Lesart will, liest die Spalte
"inhaltslos".

## 9 · Eigenbefund am Messwerkzeug (Selbst-Review, silent-failure-Brille)

Zwei Dinge sind beim Gegenlesen des eigenen Diffs aufgefallen und behoben:

1. **Das Skript konnte still "0 Treffer" melden, ohne etwas verglichen zu haben.**
   Ein Vintage-Paar ohne gemeinsame Zeilen (falscher Pfad, leeres Verzeichnis, geaendertes
   Schluessel-Schema) haette exakt dieselbe gruene Zeile erzeugt wie 208.983 tatsaechlich
   verglichene. Bei einem Werkzeug, dessen Ergebnis eine **negative** Aussage ist, ist das
   die teuerste Fehlerklasse ueberhaupt — dieselbe wie "Skip != Pass" (T147). Jetzt:
   `::error::` + Exit 1, sobald ein Paar 0 gemeinsame Zeilen hat; Exit 1 gibt es
   ausschliesslich dafuer, ein KIPP-Treffer bleibt Exit 0 (Messwerkzeug, kein Tor).
2. **Eine Sabotage, die nicht ankam, sah aus wie ein Beleg.** Der erste Versuch, den neuen
   Waechter zu brechen, blieb gruen — nicht weil der Waechter hielt, sondern weil die
   Testpruefung durch einen fehlgeschlagenen Text-Ersatz nie in der Datei gelandet war.
   Seitdem prueft die Sabotage per Assertion, dass ihr Muster ueberhaupt getroffen hat
   (Lektion L38, zweite Haelfte). Danach: vier Sabotagen, vier Mal rot.
