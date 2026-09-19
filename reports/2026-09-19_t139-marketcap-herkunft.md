# T139 — Herkunft des Marktwerts gegen die Kursfelder, auf der richtigen Messebene

**Datum:** 2026-09-19 (Daylauf, Lane D) · **Branch:** `lane-d/T139`
**Artefakte:** `scripts/t139-marketcap-herkunft.js` · `tests/t139-marketcap-herkunft.test.js`
· `reports/2026-09-19_t139-marketcap-herkunft.json`
**Auftragsfrage (woertlich aus der Inbox):** *„7.226 von 8.313 Zeilen (86,9 %) unterscheiden
sich in `marketCap` und in sonst gar nichts … Fuer die Achsen folgenlos (`axes.js` liest kein
Kursfeld, nachgeprueft), fuer die Kohortenzuteilung ueber `mcapKlasse` nicht. Herkunft des
Marktwerts gegen die Kursfelder pruefen."*

## Ergebnis in einem Satz

**Die Frage ist beantwortet, und zwar auf der Ebene, auf der der Befund entstand: `marketCap`
ist ein Anbieter-Wert, der unabhaengig von den gespeicherten Kursfeldern erneuert wird — die
86,9 % sind erwartbar, nicht defekt.** Das Kohorten-Risiko ist beziffert: **57 von 7.226
Zeilen (0,79 %) wechseln die Groessenklasse.** Der einzige Rest, der eine Entscheidung
braucht, ist die Innen-Inkonsistenz der PIT-Zeile — und die laeuft bereits als **T160**.

## 1. Die Messebene war der ganze Streit

T139 ist zweimal an der Messebene gescheitert, nicht an der Rechnung:

| Versuch | Ebene | Ergebnis |
| --- | --- | --- |
| 31.08. (Nacht-Lane) | `findash-export/v1`, 1.796 gemeinsame Zeilen | Ursprungszahl **nicht** reproduzierbar; Schluss: „CI-Artefakte vom 07./09.08. beschaffen" |
| 28.08. (Executor-2) | `board-history`, `pit`-Block | Zahlen reproduziert |
| **19.09. (hier)** | `board-history`, `pit`-Block, unabhaengig nachgerechnet | **Zahlen exakt reproduziert** |

**Der als naechster Schritt notierte Beschaffungs-Auftrag ist damit gegenstandslos:** die
Vintages `board-history/2026-08-07` und `2026-08-09` liegen im Repo, tragen 8.763 bzw. 8.866
Zeilen und sind genau die 8.313-Zeilen-Ebene des Ursprungsbefunds. Der findash-Export fuehrt
nur die veroeffentlichte Top-N-Auswahl und keine Perioden-Enden — wer dort misst, misst die
falsche Ebene. Kein CI-Artefakt wird gebraucht.

## 2. Gemessen (unabhaengig nachgerechnet, nicht uebernommen)

`node scripts/t139-marketcap-herkunft.js --a 2026-08-07 --b 2026-08-09`
Schluessel je Zeile: `sektor|kohorte|ticker`.

| Groesse | Wert | Gegen den Ursprungsbefund |
| --- | ---: | --- |
| gemeinsame Zeilen | **8.313** | = 8.313 ✔ |
| pit-Diff enthaelt NUR `marketCap` | **7.226 (86,9 %)** | = 7.226 ✔ |
| `marketCap` bewegt sich ueberhaupt | 8.238 (99,1 %) | — |
| `marketCap` bewegt, `fetchedAt` byte-identisch | 7.226 | — |
| `marketCap` bewegt, alle Kursfelder byte-identisch | 7.231 | — |
| **Klassenwechsel `mcapKlasse` unter den 7.226** | **57 (0,79 %)** | = 57 ✔ (28.08.) |
| Klassenwechsel ueber alle 8.238 bewegten Zeilen | 76 (0,92 %) | neu |
| Verhaeltnis `marketCap_neu / marketCap_alt` | min **0,377** · max **3,173** | = 0,38 / 3,17 ✔ |

Drei unabhaengig gemessene Groessen (7.226 · 57 · 0,38/3,17) treffen die Zahlen vom 28.08.
exakt. Das ist die Gegenprobe, die T139 gefehlt hat.

## 3. Herkunft — die eigentliche Auftragsfrage, am Code

- `write-board-history.js:515` — `marketCap: val(snap.marketCap)`: der Wert kommt **von der
  obersten Snapshot-Ebene**, also so, wie der Anbieter ihn meldet. Er wird **nicht** aus
  `priceSales`, `evSales` oder einer Aktienzahl gerechnet; `sharesOutstanding` geht nirgends ein.
- `priceSales` traegt seinen **eigenen** Zeitstempel `priceSalesAsOf` (`write-board-history.js:508`),
  und der Kommentar dort benennt den Widerspruch bereits: er kann Wochen **vor** `meta.fetchedAt` liegen.
- Der Kurs-only-Schnellpfad in `pull-yahoo.js` erneuert `marketCap`, laesst `metrics.*` und
  `meta.fetchedAt` stehen. Im eingefrorenen Vintage ist das strukturell unsichtbar.

Die Kette vollstaendig (Gegenpruefung): `pull-yahoo.js:2112` uebernimmt
`summaryDetail.marketCap` (ersatzweise `price.marketCap`), der Kurs-only-Schnellpfad setzt
`existing.marketCap.value = q.marketCap * tradingAggFactor` (`:3387`) — also Anbieter-Wert,
**lokal FX-skaliert**, aber nicht aus gespeicherten Bewertungskennzahlen gerechnet.

**Damit ist die Praemisse des Befunds schief, nicht der Befund falsch:** ein Marktwert, der
sich ohne Bewegung der gespeicherten Kursfelder aendert, ist bei einem Anbieter-Wert der
Normalfall. **Praezise gesagt:** der Code zeigt den Mechanismus, der die 86,9 % erzeugt — er
ist keine Einzelfall-Rekonstruktion aller 7.226 Aenderungen. Fuer die Frage „defekt oder
nicht" reicht das: es braucht keinen Defekt, um die Zahl zu erklaeren.

**Gegenprobe zur Achsen-Aussage:** `grep -E 'marketCap|priceSales|price|evSales|beta'
src/scoring/axes.js` → **0 Treffer**. Die Achsen sind von der Bewegung nicht beruehrt; die
Aussage im Befund haelt.

## 4. Was an der Zeile ausserdem nicht stimmt — und wo es hingehoert

Zwei Praezisierungen, beide belegt:

1. **„und in sonst gar nichts" gilt nur fuer den `pit`-Block.** Auf ZEILEN-Ebene sind von den
   7.226 nur **2** wirklich sonst unveraendert — `rank`, `score` und `axisBreakdown` wandern
   mit, weil das ganze Board neu rangiert. (Der 28.08.-Lauf zaehlte 7; der Unterschied ist die
   Schluesseldefinition, nicht ein Widerspruch: hier `sektor|kohorte|ticker`, dort Ticker allein.)
2. **Die Zeile ist innen inkonsistent:** tagesfrischer `marketCap` neben wochenaltem
   `priceSales`, Spanne bis Faktor 3,17. Wirkung auf die Boards ist klein (0,79 %
   Klassenwechsel), auf `scripts/rank-ic.js:566-577` aber gross — dort geht `log(pit.marketCap)`
   als **stetige** §7-Groessenkontrolle ein, also die ganze Verteilung, nicht nur die Klasse.
   **Das ist T160 und bleibt dort** (Weiche, kein stiller Fix): entweder beide Felder aus
   derselben Quelle stempeln, oder `fetchedAt` je Feld fuehren, oder die Groessenkontrolle auf
   ein Feld legen, dessen Alter bekannt ist.

**Nebenbefund, unaufgefordert, weil er auf derselben Messung liegt:** die weiteren bewegten
pit-Felder zaehlen sich als `revenueQEnds` **729** und `revenueQ` **493** — exakt die beiden
Zahlen aus **T140**. Auch T140 lebt also auf dieser Ebene und ist dort messbar; der
31.08.-Vermerk „Messebene fehlt" ist fuer T140 ebenso ueberholt.

## 5. Codex-Gegenpruefung (read-only, Auftrag *kippen*) — vier Verdikte, drei Nachbesserungen

Ein zweiter Motor (gpt-6-astra, effort medium, read-only, ohne Schreibrecht) hat die vier
Kernaussagen adversarial geprueft. Verdikte: **A1 UMZURAHMEN · A2 CONFIRMED · A3 CONFIRMED ·
A4 UMZURAHMEN**. Er hat die Zahlen mit einem **eigenen** Differ (`Object.hasOwn` +
`util.isDeepStrictEqual` statt `JSON.stringify`) unabhaengig nachgerechnet und kam auf
dieselben 8.313 / 7.226 / 57 / 2. Drei seiner Funde waren echt, alle drei reproduziert und
behoben:

**(1) Der Waechter ueberlebte zwei Mutationen.** Reproduziert: `nurMcap` als
`!dPit.includes('priceSales')` umdefiniert → Zaehlung faelschlich 7.247, **Waechter blieb
gruen**; Zeilen-Diff ganz weggelassen (`dRest = []`) → `nurMcapUndZeileSonstIdentisch` von 2
auf 7.226, **Waechter blieb gruen**. Ursache: die Fixtures kannten nur ein mitbewegtes
Kursfeld und pruefen die Zeilen-Ebene gar nicht. Behoben: eine Fixture-Zeile, in der ein
NICHT-Kursfeld (`fetchedAt`) mitwandert, und eine mit wanderndem `rank`. **Beide Mutationen
sind jetzt rot** (zusammen mit der Kursfeld-Blindheit: 3 von 3).

**(2) `JSON.stringify` als Vergleichsmass war zu schwach.** Reproduziert:
`pitDiff({x: null}, {})` → `[]`, ebenso `-0` gegen `0` und `NaN` gegen `null` — drei Wege, auf
denen ungleiche Bloecke als gleich durchgehen; umgekehrt erzeugt eine geaenderte
Schluesselreihenfolge Scheindifferenzen. In diesen Vintages macht es **keinen** Unterschied
(nach der Haertung: unveraendert 8.313 / 7.226 / 57) — aber eine Zaehlung, die auf Gleichheit
besteht, darf die Gleichheit nicht der Serialisierung ueberlassen. Jetzt Anwesenheits-Test +
`isDeepStrictEqual`, vier neue Waechter-Erwartungen.

**(3) `survival.json`** — **`survival.json`
traegt echte Kohorten-Zeilen** (97 am 07.08., 103 am 09.08., mit vollem `pit`-Block) — die
Pre-Revenue-/Biotech-Spur, die nie auf Wachstum gescort wird. Sie stand in der
Ausschlussliste neben `calibration.json`/`regime.json`, die gar keinen `cohort`-Block haben.
Das war ein **stiller** Ausschluss.

**Nicht uebernommen, aber notiert** (Praezisierungen ohne Fehler in der Sache): `mcapKlasse`
wird hier aus `pit.marketCap` **nachgerechnet**, nicht als gespeichertes Feld beobachtet — und
ein Klassenwechsel ist **nicht** identisch mit einem Wechsel der Scoring-Kohorte, die ueber
das gelernte `mcapBand` laeuft (die fuenf findash-Reiter haengen an `mcapKlasse`). Ausserdem:
`pit` fuehrt nicht alle Score-Eingaenge (`annualRev`, `annualGP`, `annualFCF`, `opIncQ`,
Bilanzreihen fehlen) — pit-Gleichheit ist also **nicht** Eingangs-Gleichheit. Beides steht
unter „Grenzen".

Jetzt ist es eine sichtbare Weiche (`--mit-survival`), und die Ausgabe fuehrt sie als
`survivalEnthalten` mit. Beide Zahlen:

| Geltungsbereich | gemeinsam | nur `marketCap` | Klassenwechsel |
| --- | ---: | ---: | ---: |
| 13 Sektor-Boards (Default, = Ursprungsbefund) | 8.313 | 7.226 | 57 |
| + `survival.json` | 8.406 | 7.272 | 58 |

**Die Quote aendert sich nicht (86,9 % vs. 86,5 %), die Aussage bleibt.** Der Default bleibt
der engere Bereich, weil nur er mit der Zahl des Ursprungsbefunds vergleichbar ist — aber die
Zahl traegt ihren Geltungsbereich ab jetzt bei sich.

### Zweiter Lauf: Code-Review (stille Fehler + JavaScript)

Derselbe Motor, zweiter Brief, auf den fertigen Commit: **sieben reproduzierte Befunde, einer
hoch.** Gemeinsamer Kern: **Abwesenheit sah aus wie Stabilitaet.** In den Vintages 07./09.08.
aendert keiner davon eine Zahl — nachgemessen: `paareOhnePit` 0, `mcapUnbrauchbar` 0,
`kaputteEintraege` 0, `paareOhneKursfeld` 0, und alle Ergebnisse (8.313 / 7.226 / 57 /
0,377–3,173) stehen unveraendert. Gehaertet wurde trotzdem, weil genau diese Klasse in diesem
Repo schon zweimal eine Aussage gekippt hat:

| Befund | Fall | Behandlung |
| --- | --- | --- |
| **hoch:** fehlende Felder galten als unveraendert | Zeile ohne `pit`; `marketCap` auf beiden Seiten abwesend | eigene Zaehler `paareOhnePit` / `mcapUnbrauchbar`, aus jeder Quote heraus; `pruefeErgebnis` wirft |
| kaputte Kohorten-Liste still uebersprungen | `cohort.profitable` ist ein Objekt statt Array | `kaputteEintraege` gezaehlt, `pruefeErgebnis` wirft |
| doppelter Schluessel still ueberschrieben | zweimal derselbe Ticker in Sektor+Kohorte | `ladeVintage` **wirft** — sonst haengt das Ergebnis an der Zeilenreihenfolge |
| `null`-Marktwert wurde Klassenwechsel + Verhaeltnis 0 | `1e9 → null` | Brauchbarkeit VOR jeder Zaehlung geprueft |
| Quote mit Nenner 0 wurde als „0 %" ausgegeben | keine bewegte Zeile | Quote ist dann `null` = nicht bestimmbar |
| zwei Mutationen ueberlebten die Tests | Verhaeltnis `ma/mb` statt `mb/ma`; `pruefeErgebnis`-Aufruf aus `main()` entfernt | Verhaeltniswert wird geprueft; neue CLI-Pruefung misst den **Prozess-Exit** (`T139_BOARD_ROOT`) |
| endliche Eingaben, unendlicher Quotient | `1e-308 → 1e308` | `Number.isFinite(q)` am Quotienten |

## 6. Waechter

`tests/t139-marketcap-herkunft.test.js`, 10 Pruefungen, hermetisch (Temp-Vintages, kein
Substrat, kein Netz). Gepinnt wird die Sache: die Klassenschwelle wird aus
`src/scoring/score.js` **importiert** statt nachgebaut (F1334), der Zaehler muss „nur
`marketCap` bewegt" von „ein Kursfeld bewegt sich mit" in **beide** Richtungen trennen, und
der Klassen-Kipp haengt am Wert, nicht an der Bewegung. Pruefung 6 pinnt die
Survival-Weiche in beide Richtungen, damit der Ausschluss nie wieder still wird.

Dazu eine Wache gegen die Hausform der stillen Panne: **0 gemeinsame Zeilen = Exit 1**, nicht
„0 von 0 ok" (`pruefeErgebnis()`, als eigene Funktion, damit der Waechter die Regel prueft und
kein Textmuster).

**Neun Sabotagen gefahren, alle neun rot** (Exit 1, danach zurueckgesetzt, wieder gruen):
Kursfeld-Liste geleert · `nurMcap` als „`priceSales` steht still" umdefiniert · Zeilen-Diff
weggelassen · Null-Wache entschaerft · Verhaeltnis umgedreht · `pruefeErgebnis`-Aufruf aus
`main()` entfernt · Duplikat-Wache entschaerft · Kaputt-Zaehler entschaerft ·
Brauchbarkeits-Pruefung entschaerft. **Vier davon ueberlebten eine fruehere Fassung** — sie
sind der Grund fuer die Haertungen aus Abschnitt 5.

## 7. Grenzen, ehrlich

- Gemessen an **einem** Vintage-Paar (07.08.→09.08.), weil das Paar des Ursprungsbefunds ist.
  Das Skript nimmt `--a`/`--b` fuer jedes andere Paar.
- **Der Schluessel `sektor|kohorte|ticker` ist enger als „derselbe Ticker":** 8.319 Ticker
  kommen in beiden Vintages vor, **6** davon wechseln Sektor oder Kohorte und fallen aus dem
  Paar-Vergleich. Fuer die Frage „aendert sich an DERSELBEN Zeile nur der Marktwert" ist das
  richtig — eine Zeile, die die Kohorte gewechselt hat, ist keine unveraenderte Zeile.
- **`pit` ist nicht der ganze Score-Eingang:** `annualRev`, `annualGP`, `annualFCF`, `opIncQ`
  und die Bilanzreihen stehen nicht im Block. „Nur `marketCap` bewegt sich" gilt fuer den
  PIT-Ausschnitt, nicht fuer die Scoring-Eingabe als Ganzes.
- `mcapKlasse` steht nicht im Vintage; der Klassenwechsel wird aus `pit.marketCap` mit der
  Produktionsschwelle **gerechnet**. Faende der Export die Klasse je aus einem anderen
  Marktwert, waere die Zahl anders — `score.js:1323` (`e.mcapKlasse = mcapKlasseOf(e.marketCap)`)
  und `write-board-history.js:515` (`val(snap.marketCap)`) lesen aber dieselbe Quelle.
- `src/scoring/**` wurde ausschliesslich **gelesen**, keine Zeile geaendert.

## 8. Folge fuer die Inbox

T139 ist als **beantwortet** zu haken: Auftragsfrage am Code beantwortet, Zahlen unabhaengig
reproduziert, Kohorten-Risiko beziffert, Beschaffungs-Auftrag gegenstandslos. Der verbleibende
Entscheidungsbedarf liegt vollstaendig in **T160**. Die Inbox-Datei selbst wird von dieser
Lane nicht angefasst (nur T205 editiert sie).
