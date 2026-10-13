# T196 — `timeseries.revenueQEnds` und das `FIELD_REGISTRY`: die Frage ist beantwortbar, die Alternative der Zeile ist es nicht

**Stand:** 2026-09-19 · **Lane D des Daylaufs** · **Messbasis:** `board-history/2026-09-19` (16 Board-Dateien,
9.643 PIT-Zeilen) und der Quelltext auf `main` `f05833d57e` · **Art:** Entscheidungsvorlage, kein Bau.
Keine Datei unter `src/scoring/` ist angefasst worden.

---

## AUF EINEN BLICK

**Beide Hörner der Zeile sind falsch. `revenueQEnds` gehört NICHT ins `FIELD_REGISTRY`, und das
Register beschreibt trotzdem genau das, was es zu beschreiben behauptet — es behauptet nämlich
nie, das Verzeichnis der Scoring-Eingänge zu sein. Ein „stillschweigender Sonderfall" ist der
Zustand ebenfalls nicht: seit dem 03.08.2026 hat das Feld ein eigenes, exportiertes Tor
(`periodEnds()`), und die versiegelte GQS-00-Spezifikation führt es ausdrücklich als
Eingangszeiger.**

- **Was wirklich offen ist,** und zwar als Einziges: der Modulkopf von `snapshot.js:10` behauptet
  seit dem 03.08. etwas Unwahres (`norm()` sei das *einzige* Tor), und **genau ein** Rohzugriff
  lebt noch daneben — `lamps.js:657/658`.
- **Gemessen:** 8.850 von 9.643 PIT-Zeilen (91,8 %) tragen `revenueQEnds`; **0** davon haben eine
  von `revenueQ` abweichende Länge, **0** ein kalendarisch unmögliches Datum, **0** einen Eintrag
  ohne ISO-Form, 8.619 vier brauchbare Enden.
- **Folge:** ein Umzug von `lamps.js` auf `periodEnds()` wäre auf dem heutigen Substrat
  wirkungsgleich (0 Fälle in allen **drei** unterscheidenden Bedingungen) — aber nicht folgenlos
  für künftige Daten, und er fasst eine unter GQS-00 versiegelte Datei an. Deshalb Vorlage, kein Fix.
- **Sprungmarken:** §1 Befund · §2 Warum Horn 1 fällt · §3 Warum Horn 2 fällt · §4 Was übrig
  bleibt · §5 Messung · §6 Drei Optionen mit Preis · §7 Empfehlung und Kipp-Bedingung ·
  §8 Duell-Akte (Blind-Kritik des zweiten Motors)

---

## §1 Der Befund in einem Satz

Das `FIELD_REGISTRY` ist ein **Format-Register für `norm()`** — es sagt, in welcher der drei
Yahoo-Speicherformen eine **Zahlenreihe** liegt. `revenueQEnds` ist keine Zahlenreihe, sondern
eine ISO-Datumsreihe, und hat seit der F-4-Runde einen eigenen typisierten Leser im selben Modul.
Die Zeile T196 wurde am 23.08. geschrieben, ihre Antwort lag am 03.08. schon im Repo; die
Codex-Korrektur vom 29.08. („mechanische Aufnahme würde das Feld durch `toFinite()` zu `null`
machen") hat die richtige Hälfte gesehen und die zweite Hälfte nicht mitgeliefert.

## §2 Horn 1 — „dann gehört es hinein" fällt, und zwar zweifach

**(a) Mechanisch.** `norm()` mappt jeden Eintrag durch `toFinite()` (`snapshot.js:75-77`):
`(typeof x === 'number' && Number.isFinite(x)) ? x : null`. Ein Eintrag `"2026-06-30"` ist ein
String → `null`. Der `value`-Zweig (`snapshot.js:100`) liest `entry.value` nur bei einem Objekt und
reicht einen String direkt an `toFinite()` weiter — das Ergebnis ist dasselbe `null`, der Weg dorthin
ein anderer. Eine Aufnahme ins Register macht das Feld nicht lesbar, sondern
**unlesbar** — und zwar still, weil `norm()` bei Formfehlern keine Ausnahme wirft, sondern die
dokumentierte `null`-Lücke liefert.

**(b) Vertraglich.** Der Registerkopf sagt selbst, worüber er spricht (`snapshot.js:28-30`):
*„Feld-Format-Register … [container, format]; format: 'value' = [{value:N}], 'scalar' = [N],
'multikey' = [{k:N,…}]"* — drei Formen, alle numerisch. Und `snapshot.js:54-57` hält bereits in
anderer Sache ausdrücklich fest: *„Das FIELD_REGISTRY beschreibt ausschliesslich das
SPEICHERFORMAT (['annual','scalar']) fuer norm(); es steuert keine Umrechnung."* Ein Register, das
nur Speicherformen für ein numerisches Tor führt, hat für ein Datumsfeld keinen zutreffenden
Eintrag — die Aufnahme wäre eine Falschaussage, kein Eintrag.

## §3 Horn 2 — „oder das Register beschreibt nicht mehr, was es behauptet" fällt ebenfalls

Das Horn unterstellt, `FIELD_REGISTRY` sei **das Verzeichnis der Scoring-Eingänge**. Das ist es
nicht, und es gibt bereits ein anderes Artefakt, das diese Rolle wahrnimmt — ein versiegeltes:

| Artefakt | Was es über `revenueQEnds` sagt |
|---|---|
| `protocol/gqs-00/1.1.0/formula-registry.json:64,78,105` | `"$.timeseries.revenueQEnds"` als **Eingangszeiger** dreier Achsen (`revGrowthLevel`, `revAcceleration`, `ruleOfX`) |
| `scripts/gqs00-freeze.js:71,79,95` | derselbe Zeiger im Erzeuger, samt `periodRule` („period-end match around 365 days (+/-15 days); position 4 only when period ends are absent") |
| `protocol/gqs-00/1.1.0/golden-fixtures.json` / `score-traces.json` | 25 bzw. 97 Vorkommen — das Feld ist Teil der eingefrorenen Belegkette |
| `src/scoring/snapshot.js:266-274` | `periodEnds(snapshot, field)`, exportiert (`:332-338`), mit eigener Round-Trip-Datumsprüfung |

**Damit ist die Prämisse der Zeile widerlegt:** das Feld ist nicht undokumentiert, nicht
unversiegelt und kein Sonderfall — es ist an drei Stellen benannt, nur eben nicht in dem Register,
das die Zeile dafür hielt. Die Beobachtung vom 23.08. stammte aus dem Proxy-Lauf der
`lib/gelesene-felder.js` auf `mess/lineal-gegenprobe-20260823`; dieser Zweig liegt bis heute nicht
auf `main` (beide Dateien fehlen dort, geprüft), die F-4-Reparatur dagegen schon.

## §4 Was von T196 übrig bleibt — und es ist etwas

Drei Reste, alle klein, alle echt:

1. **Der Modulkopf lügt.** `snapshot.js:10`: *„`norm()` ist das EINZIGE Tor zu snapshot.annual.* /
   snapshot.timeseries.*"* und `:12-14`: *„Keine Achse / kein Router / keine Lampe greift je direkt
   auf ein Rohfeld zu."* Seit dem 03.08. gibt es ein zweites Tor (`periodEnds`), und seit dem
   29.07. greift genau eine Lampe direkt zu.
2. **Der eine Rohzugriff.** Repo-weit gemessen (Suche über `src/`, alles außer `snapshot.js`
   selbst): **1 Treffer**, `lamps.js:657/658` — `s.timeseries.revenueQEnds.slice(0, 4)` im
   Einmalertrag-Kadenz-Wächter. Er ist im Quelltext ausführlich begründet (*„Die Enden werden
   DIREKT gelesen, nicht ueber norm(): es sind ISO-Datums-Strings, und norm() ist auf Zahlenserien
   gebaut"*) — die Begründung war am 29.07. vollständig richtig und ist seit dem 03.08. um die
   Hälfte veraltet, weil `periodEnds()` genau diese Lücke schließen sollte.
3. **Keine Zugriffs-Regel — wohl aber ein Siegel.** Hier hat die Blind-Kritik meinen ersten Entwurf
   korrigiert (§8/E2): `protocol/gqs-00/1.1.0/formula-registry.json` nagelt **31 Scoring-Dateien am
   Quelltext-Hash** fest, `scripts/gqs00-freeze.js:603-609` prüft das, `tests/scoring/gqs00-freeze.test.js`
   läuft in der blockierenden Spur (`scripts/test-gate.js:81`). Ein zweiter Rohzugriff macht das Gate
   also sehr wohl rot — aber nur, weil er die Datei ÜBERHAUPT ändert, nicht weil er ein Rohzugriff ist.
   Nach der nächsten Versiegelung wäre er mitversiegelt. Was fehlt, ist eine Regel über die ZUGRIFFSART,
   die eine Neu-Versiegelung überlebt.

## §5 Die Messung

`board-history/2026-09-19`, 16 Board-Dateien, beide Kohorten-Spuren, `pit`-Blöcke:

| Größe | Wert |
|---|---|
| Board-Zeilen gesamt | 9.643 |
| davon ohne PIT-Block (ungemessen) | 0 |
| PIT-Zeilen | 9.643 |
| davon mit nicht-leerem `revenueQEnds` | 8.850 (91,8 %) |
| davon Länge ≠ `revenueQ` | **0** |
| davon mit vier brauchbaren Enden (was `lamps.js` verlangt) | 8.619 |
| davon mit weniger als vier | 231 |
| kalendarisch unmögliche Daten (Round-Trip-Probe) | **0** |
| Einträge ohne ISO-Form (Duell-Einwand E1) | **0** |

`buildPit` (`scripts/write-board-history.js:476-489`) übernimmt die Enden-Reihe unverändert
(`validEnds` nullt nur eine Reihe ohne jeden Eintrag, es trimmt nicht) und packt `revenueQ` durch
`seriesValues` (`:436-440`), das `[{value:N}]` auf `[N]` abbildet — **Länge und Positionen bleiben
erhalten**, und genau die gehen in die Messung ein. Die Zahlen sind damit ein treuer Stellvertreter
für den Snapshot-Zustand. **Grenze, ehrlich:** `board-history` ist
die gefilterte Board-Population, nicht das Voll-Universum; lokale `snapshots/` liegen nicht vor
(gitignored, nur `_manifest.json`). Die Null-Befunde sind damit für die Board-Population belegt und
für den Rest des Universums nur nahegelegt.

**Warum diese drei Nullen zählen:** sie sind exakt die Bedingungen, in denen sich `periodEnds()`
und der Rohzugriff unterscheiden. Alle drei sind am lebenden Objekt nachgestellt (reine
Speicherproben, kein Schreibvorgang):

| Fall | Rohzugriff `lamps.js:657` | nach Umzug auf `periodEnds()` | heute im Bestand |
|---|---|---|---|
| Enden-Reihe **länger** als die Wert-Reihe, mit Halbjahres-Lücke (`['2026-03-31','2025-12-31','2025-06-30','2025-03-31','2024-12-31']` zu vier Werten) | `null` — Kadenz gebrochen, Zeile **nicht bewertbar** | alle Enden `null` → Kadenzprüfung **übersprungen** → Lampe `true` | 0 Zeilen |
| kalendarisch unmögliches Datum (`2025-02-30`) | `null` (Round-Trip scheitert erst in der Lampe) | Eintrag genullt → Prüfung übersprungen → Lampe `true` | 0 Zeilen |
| Eintrag ohne ISO-Form (`'garbage'` an Position 0) | `null` — `Date.parse` scheitert, Zeile **nicht bewertbar** | Eintrag genullt → Prüfung übersprungen → Lampe `true` | 0 Zeilen |

Die dritte Zeile ist der Fund der Blind-Kritik (§8/E1); mein erster Entwurf kannte nur zwei
Bedingungen und die erste Fassung des Zählskripts hätte einen solchen Eintrag sogar als
„brauchbares Ende" verbucht. Beides ist korrigiert, die Null steht jetzt auf dem breiteren Zähler.

**Die Richtung ist in allen drei Fällen dieselbe und sie ist unbequem:** der Rohzugriff erklärt die
Zeile für nicht bewertbar, `periodEnds()` schaltet den Kadenz-Wächter still ab und lässt die Lampe
brennen. Der sauberere Weg ist im Ausfall der schweigsamere — und die Lampe ist seit dem
16.08.2026 folgenreich (bei Brennen fallen fünf Achsen der Zeile weg).

## §6 Drei Optionen mit Preisschild

Der Wächter, der in A und B vorkommt, ist derselbe und hat nach der Blind-Kritik (§8/E3) eine
**namentliche Ausnahme**: er verbietet Rohzugriffe auf `snapshot.timeseries.*` in `src/`, kennt
aber genau eine erlaubte Stelle — `src/scoring/lamps.js` — und wird rot, sobald eine **zweite**
entsteht ODER die erlaubte verschwindet (dann ist die Ausnahme tot und gehört gelöscht). Ohne
diese Ausnahme wäre B nach seiner eigenen Spezifikation sofort rot.

| | Was | Preis | Wirkung |
|---|---|---|---|
| **A** | Kopf von `snapshot.js` korrigiert (zwei Tore benannt), `lamps.js:657` auf `periodEnds()` umgezogen **plus ausdrückliche Regel für den Ausfall** (Enden nicht lesbar ⇒ Zeile nicht bewertbar, nicht: Lampe an), dazu der Wächter oben ohne Ausnahme | zwei Dateien unter `src/scoring/` → **GQS-00-Neuversiegelung** (beide sind unter den 31 gehashten Dateien), Golden-Fixtures und Score-Traces müssen gegengelaufen werden; Verhaltens-Regel neu zu entscheiden (§5) | räumt alle drei Reste ab |
| **B** | Nur Doku: Kopf korrigiert, Registerkommentar nennt `periodEnds` als Schwester-Tor, die `lamps.js`-Begründung um „seit 03.08. gibt es `periodEnds`; bewusst nicht benutzt, weil der Umzug den Ausfall still macht" ergänzt; Wächter mit der Ausnahme | Kommentar-Änderung an zwei versiegelten Dateien → formal ebenfalls Neuversiegelung, inhaltlich nullwirksam (Scores unverändert, Fixtures laufen durch) | Rest 1 und 3 weg, Rest 2 bleibt begründet und benannt stehen |
| **C** | `revenueQEnds` ins `FIELD_REGISTRY` | — | **widerlegt**, §2: über `norm()` wäre das Feld nur noch als `null`-Reihe lesbar. Präzisierung nach §8/E4: die Aufnahme allein ändert am heutigen Verhalten **nichts** (der Rohzugriff liest weiter am Register vorbei) — sie richtet erst dann Schaden an, wenn ein Konsument dem Register glaubt und `norm()` benutzt. Ein Registereintrag, der nur schadet, sobald jemand ihm folgt, ist der schlechteste der drei Wege |

## §7 Empfehlung, Zuständigkeit, Kipp-Bedingung

**Empfehlung: B, mit A als Folgepunkt, sobald der Ausfall geregelt ist** (Vertrauen ~75 %; der
zweite Motor kommt unabhängig auf B mit 95 %). Begründung: der einzige materielle Gewinn von A ist
Einheitlichkeit, sein materieller Verlust ist ein Wächter, der im Ausfall künftig schweigt statt zu
prüfen — und zwar in drei belegten Fällen, nicht in zweien. Solange die Ausfall-Regel nicht
mitentschieden ist, ist A ein Rückschritt mit sauberem Anstrich. B nimmt die unwahre Kopfzeile und
die fehlende Zugriffsregel weg, also genau das, was T196 mit „nicht stillschweigend als Sonderfall
führen" meint, ohne Verhalten anzufassen.

**Der stärkste Angriff gegen B** (vom zweiten Motor, §8/E2, von mir nachgerechnet und angenommen):
B begründet sich zum Teil mit einer Lücke, die es so nicht gibt — das GQS-00-Siegel macht jede
Änderung an `lamps.js` rot, auch einen zweiten Rohzugriff. Er hält trotzdem nicht als Argument
GEGEN B: das Siegel schützt den Byte-Stand, nicht die Zugriffsart; nach der nächsten
Neuversiegelung wäre ein dann vorhandener zweiter Rohzugriff mitversiegelt. Die Regel, die B
hinzufügt, ist die einzige, die eine Versiegelung überlebt.

**Zuständigkeit:** beide Optionen fassen `src/scoring/` an und lösen damit eine Neuversiegelung
unter GQS-00 aus. Diese Lane hat dort Schreibverbot; die Ausführung gehört an den Siegelweg
(Rat/Karl-Freigabe), nicht an einen Executor.

**Kipp-Bedingung für die Empfehlung:** taucht im nächsten Voll-Pull auch nur **eine** Zeile mit
`revenueQEnds.length !== revenueQ.length`, einem Datum, das die Round-Trip-Probe reißt, oder einem
Eintrag ohne ISO-Form auf, dann ist der Rohzugriff nicht mehr wirkungsgleich, sondern trifft eine
eigene, ungeprüfte Entscheidung — dann kippt die Empfehlung auf A, und die Ausfall-Regel wird
zur Vorbedingung statt zur Zugabe. Gemessen wird das mit `node scripts/t196-enden-zensus.js`.

**Der Haken von T196 gehört erst gesetzt, wenn eine der Optionen ausgeführt ist.** Beantwortet ist
mit diesem Bericht die Frage, nicht die Aufgabe.

## §8 Duell-Akte — Blind-Kritik des zweiten Motors

Klasse MITTEL, Duell-Lane §4d: Codex (`gpt-6-astra`, `model_reasoning_effort=xhigh`, `--sandbox
read-only`, kein Lock) hat den fertigen Entwurf zerlegt. Brief und Antwort liegen unter
`~/.codex/delegation-locks/t196-duell-brief-20260919.md` bzw. `out-t196-duell-20260919.md`.
Sieben Einwände, **fünf angenommen, zwei präzisiert, keiner zurückgewiesen**; jeder vor der
Übernahme selbst reproduziert.

| Einwand | Schwere | Urteil | Folge im Bericht |
|---|---|---|---|
| E1 dritter Unterschied: Einträge ohne ISO-Form | MITTEL | **angenommen**, im Speicher reproduziert (`'garbage'` → roh `null`, nach Umzug Lampe `true`) | §5 Tabelle dritte Zeile; Zählskript um `formatFehler` erweitert, Null neu gemessen |
| E2 das GQS-00-Siegel macht einen zweiten Rohzugriff sehr wohl rot | MITTEL | **angenommen**, am Registerinhalt geprüft (31 gehashte Dateien, `lamps.js` darunter) | §4 Rest 3 umgeschrieben, §7 als stärkster Angriff geführt |
| E3 der B-Wächter widerspricht dem beibehaltenen Rohzugriff | MITTEL | **angenommen** | §6 Vorspann: namentliche Ausnahme plus Tod-der-Ausnahme-Klausel |
| E4 Registeraufnahme allein schaltet nichts ab | KLEIN | **angenommen als Präzisierung** | §6 Zeile C |
| E5 `norm()` liest bei einem String kein `entry.value` | KLEIN | **angenommen** | §2 (a) |
| E6 Zeilennummer `gqs00-freeze.js:76` statt `:71` | KLEIN | **angenommen**, eigener Lesefehler | §3 Tabelle |
| E7 `buildPit` kopiert `revenueQ` nicht unverändert (`seriesValues`) | KLEIN | **angenommen als Präzisierung** — Länge und Positionen bleiben, und nur die gehen in die Messung | §5 |

Der zweite Motor kommt unabhängig auf **Empfehlung B, Vertrauen 95 %**, mit derselben Begründung
(Umzug verschlechtert die Behandlung fehlerhafter Daten) und derselben Auflage (ausdrückliche
Fehlerregel als Vorbedingung für A). **Rest-Dissens: keiner.**

## Anhang — Reproduktion der Messung

Das Zählskript liegt als `scripts/t196-enden-zensus.js` bei (LLM-frei, liest nur `board-history/`):

```
node scripts/t196-enden-zensus.js
```

Wächter: `tests/t196-enden-zensus.test.js` (5 Prüfungen, blockierende Spur; einmal absichtlich
gebrochen — Round-Trip-Probe auf `return true` gesetzt → rot).
