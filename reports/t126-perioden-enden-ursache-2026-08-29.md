# T126 — der erste Verifikationsschritt ist beantwortet, und er kehrt die Annahme um

**Stand:** 2026-08-29 · **Datenbasis:** 15.040 Snapshots aus dem CI-Artefakt des Laufs `33244450690`
**Anlass:** T134 misst, dass Jahres-Perioden-Enden nur zu 6,9 % befüllt sind
(`reports/jahresreihen-alter-2026-08-29.md`). T126 verlangt als ERSTEN Schritt die Verifikation,
*„dass Jahreszeilen bei Yahoo überhaupt ein `endDate` führen (im Report als ~93 % markiert,
nicht selbst belegt)"*.

---

## AUF EINEN BLICK

**Die ~93-%-Annahme ist nicht falsch — sie beschreibt nur die falsche Sache. Die Enden fehlen
nicht, weil Yahoo sie nicht liefert, sondern weil der Code sie bewusst verwirft, sobald ein
anderes Bundle die Jahresreihe gewinnt.**

- Die Enden entstehen ausschließlich aus **quoteSummary**-Zeilen (`pull-yahoo.js:1968-1970`,
  `isHist … _isoDay(_y(r,'endDate'))`).
- Gewinnt später **FTS** (fundamentalsTimeSeries) die Jahresreihe, setzt
  `_applyAnnualIncomeWinner` die Enden auf `null` — `_alignEnds(null, werte)` liefert
  `new Array(n).fill(null)` (`:1276-1280`, `:1303-1305`).
- **Das ist kein Bug, sondern eine bewusste Sicherheitsentscheidung.** Der Kommentar sagt es
  wörtlich: *„Eine zufällig gleiche Länge würde `_alignEnds` austricksen und ein FALSCHES Jahr
  an einen fremden Wert heften — ein stiller Datenfehler, schlimmer als gar kein Datum."*
- **Die gemessenen 6,9 % sind damit nichts anderes als der Anteil der Snapshots, bei denen
  quoteSummary die Jahresreihe gewonnen hat.** Bei den übrigen ~93 % gewinnt FTS — und FTS
  reicht seine Perioden heute nicht mit.

## §1 Der Beleg, Zeile für Zeile

| Ort | Was dort passiert |
|---|---|
| `pull-yahoo.js:1968-1970` | Enden werden aus `isHist` (quoteSummary) gebildet: `_isoDay(_y(r,'endDate'))`, index-aligned zur jeweiligen Wertereihe |
| `pull-yahoo.js:1303-1305` | `annual.annualRevEnds = _alignEnds(winnerIsQS ? vorher.rev : null, annual.annualRev)` — **`null`, sobald nicht QS gewinnt** |
| `pull-yahoo.js:1276-1280` | `_alignEnds(null, values)` → `new Array(n).fill(null)` — daher `[null,null,null]` statt eines fehlenden Feldes |

Das erklärt auch die Form, in der T134 die Lücke vorfindet: **das Feld ist vorhanden und trägt
eine längengleiche Null-Reihe**, nicht etwa gar nichts. Anwesenheit ohne Inhalt ist hier also
die *korrekte* Ausgabe des bestehenden Entwurfs, kein Versehen.

## §2 Was das für T126 bedeutet

T126 beschreibt den Bau als *„`_arr` in `pull-yahoo.js` um ein additives Geschwister-Feld
ergänzen"*. **Das trifft die Stelle nicht mehr** — das Geschwister-Feld existiert bereits und
wird korrekt befüllt; es wird nur anschließend verworfen.

**Der Code benennt den richtigen Ort selbst** (`:1288-1290`):

> „(Upgrade-Pfad, bewusst nicht hier: FTS kennt seine eigenen Perioden — wer sie mitführen
> will, baut sie im FTS-Mapper, statt die QS-Enden weiterzureichen.)"

**Der Bau gehört also in den FTS-Mapper**, dorthin, wo `ftsAnnualRev` & Geschwister entstehen:
FTS-eigene Perioden mitschreiben und beim Gewinner-Tausch mitgeben, statt die fremden QS-Enden
weiterzureichen (was der jetzige Code aus gutem Grund verweigert).

**Erwartbare Wirkung:** die Abdeckung der Jahres-Enden stiege von 6,9 % auf die FTS-Abdeckung
der Jahresreihen — also auf die Größenordnung, in der heute überhaupt Jahreswerte vorliegen.
Erst dann trägt die Altersmessung aus T134 über den ganzen Bestand.

## §3 Was NICHT belegt ist

- **Ob FTS in seiner Antwort tatsächlich verwertbare Perioden je Jahreszeile führt.** Das ist
  die verbleibende Vorprüfung von T126, und sie braucht eine **echte FTS-Antwort** — also einen
  Netzabruf. Hier bewusst nicht gefahren (Karl-Stop: kostenpflichtige/neue Abrufe), und die
  lokalen Snapshots tragen nur das Ergebnis, nicht die Rohantwort.
- **Ob der Tausch häufiger zugunsten von FTS ausgeht als 93:7.** Die 6,9 % sind gemessen, die
  Zuordnung „= QS hat gewonnen" folgt aus dem Code, nicht aus einem Marker im Snapshot. Ein
  Beleg-Feld dafür (welches Bundle gewann) existiert nicht — wäre aber die billigste Härtung,
  wenn jemand die Frage künftig ohne Code-Lesen beantworten will.

## §4 Empfehlung

1. **T126 umschreiben:** nicht „additives Geschwister-Feld ergänzen", sondern **„FTS-eigene
   Perioden im FTS-Mapper mitführen"** — der Code nennt diesen Pfad selbst als Upgrade.
2. **Vorher**, mit einem einzigen Netzabruf gegen einen bekannten Ticker: belegen, dass die
   FTS-Antwort Perioden je Jahreszeile trägt. Trägt sie es nicht, fällt T126 wie vorgesehen auf
   den SEC-Weg zurück — und *diese* Entscheidung ist dann datengestützt statt geschätzt.
3. **T134 bleibt bis dahin offen**, mit der heute gemessenen Teilmenge als Zwischenstand.
