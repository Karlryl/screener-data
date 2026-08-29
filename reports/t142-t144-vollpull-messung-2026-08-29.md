# T142 und T144 — die beiden Fragen, die auf den vollen Pull warteten

> ## ⛔ KORREKTUR (29.08., wenige Minuten nach der ersten Fassung)
> **Die erste Fassung dieses Berichts behauptete, die Ausschüttungs-Reihen seien
> „0 von 15.040 belegt" und T142 damit ein bestätigter Defekt. Das war FALSCH — und
> zwar aus demselben Grund, den derselbe Bericht eine Seite weiter unten anprangert:
> eine falsch verdrahtete Messebene.**
>
> Die Reihen enthalten **rohe Zahlen** (`[-45709000000, …]`), keine `{value: …}`-Objekte.
> Meine Messung las `x.value`, fand `undefined` und zählte jeden echten Wert als leer.
>
> **Korrekt gemessen sind die Reihen gefüllt:**
> `annualRepurchase` **48,10 %** · `annualDividendsPaid` **78,48 %** ·
> `annualNetCommonStockIssuance` **62,63 %**.
>
> **T142 ist damit KEIN Defekt**, sondern positiv beantwortet: nach dem vollen Pull sind
> die Felder belegt. §1 unten ist entsprechend ersetzt. Was als kleinerer Befund übrig
> bleibt, steht in §1b.
>
> Der Commit `Tag 1049` trug die falsche Fassung; `Tag 1050` korrigiert sie.

**Stand:** 2026-08-29 · **Datenbasis:** `snapshots/` aus dem CI-Artefakt des Laufs `33244450690`
(15.040 lesbare Dateien; die alten Messungen liefen gegen 4.769 lokale Altbestände)

---

## AUF EINEN BLICK

Beide Punkte waren seit dem 23.08. mit derselben Begründung geparkt: *„erst nach dem ersten
vollen Pull messbar"*. Der Pull ist da. **Das Ergebnis ist gegensätzlich:**

- **T142 — kein Defekt, positiv beantwortet.** Die drei Ausschüttungs-Reihen sind belegt
  (48,1 % / 78,5 % / 62,6 %). T142s vorab festgelegte Bedingung („Belegung immer noch 0")
  ist **nicht** eingetreten. Ein kleinerer Nebenbefund bleibt: die Schreib-Wache prüft
  Länge statt Inhalt und lässt reine `null`-Reihen ins Schema (§1b).
- **T144 — erledigt.** **0 von 15.040** Snapshots ohne Marktwert. Die ursprünglichen
  „91 von 4.769" waren ein Artefakt des alten lokalen Bestands; im echten Universum fällt
  niemand still durch.

---

## §1 T142 — Ausschüttungs-Reihen: belegt, kein Defekt

| Reihe | mit echtem Wert | nur `null`-Einträge | Feld fehlt |
|---|---:|---:|---:|
| `annualRepurchase` | **7.234 (48,10 %)** | 6.841 | 965 |
| `annualDividendsPaid` | **11.803 (78,48 %)** | 2.272 | 965 |
| `annualNetCommonStockIssuance` | **9.420 (62,63 %)** | 4.655 | 965 |

**T142s vorab festgelegtes Kriterium lautete:** *„Ist die Belegung danach immer noch 0, ist es
dann einer [ein Defekt]."* Die Belegung ist **nicht** 0 — die Bedingung ist **nicht**
eingetreten. Der Punkt ist positiv beantwortet: nach dem ersten vollen Pull mit den neuen
Feldern kommen die Werte an, so wie es beim Mandat vom 03.08. gedacht war.

Die Höhe der Quoten ist plausibel und braucht keine Erklärung durch einen Defekt: nicht jede
Firma kauft Aktien zurück (48 %) oder zahlt Dividende (78 %). Eine Null bei einer Firma ohne
Rückkaufprogramm ist die richtige Antwort, keine Lücke.

## §1b Was als kleinerer Befund bleibt: die Schreib-Wache zählt Länge, nicht Inhalt

`pull-yahoo.js:3514-3516` schreibt die drei Reihen unter der Bedingung
`if ((ftsAnnualRepurchase || []).length > 0)`. Der Kommentar daneben nennt die Absicht:
*„nur setzen wenn nicht leer, damit ein alter FTS-Cache kein leeres Feld ins Schema schreibt."*

**Die Wache hält das nicht ein.** Ein Array `[null, null, null]` hat `length === 3` und läuft
durch — gemessen in 6.841 Fällen bei `annualRepurchase`. Das Feld landet dann im Schema und
enthält nichts.

Das ist **exakt die Klasse, die F-NY-001 an anderer Stelle beseitigt hat** — der Befund steht
sogar zwölf Zeilen weiter unten in derselben Datei: *„nulls were wrapped as {value:null}, so
length-based ‚computable' checks saw N entries that could be entirely empty."* Dieselbe
Längen-statt-Inhalt-Prüfung, nur an einer anderen Reihe.

**Wirkung heute: gering** — die Verbraucher lesen über `norm()`/`presentValues()`, die
`null`-Einträge korrekt überspringen. Der Schaden ist nicht falsches Rechnen, sondern eine
Anwesenheit, die nach Daten aussieht. Eine Heilung wäre einzeilig
(`.some(v => Number.isFinite(v))` statt `.length > 0`), berührt aber den Schreibpfad des
Tageslaufs und gehört deshalb als eigener, geprüfter Bau gefahren — nicht nebenbei.

## §2 T144 — Marktwert: kein einziger Ausfall

**0 von 15.040** Snapshots ohne brauchbaren Marktwert (Feld fehlt: 0 · Wert null/0/NaN: 0).

Damit ist die offene Frage beantwortet: es gibt heute keine Zeilen, für die weder Größenklasse
noch Kohorten-Zuteilung berechenbar wäre — die Alternative *„zählen sie als ausgeschlossen oder
fallen sie still durch?"* ist gegenstandslos. Die „91 von 4.769" vom 23.08. stammten aus dem
lokalen Altbestand, der laut `.gitignore:55` ausdrücklich *„Schutt alter Läufe"* ist.

**Selbstkorrektur, protokolliert:** die erste Messung dieses Punkts meldete *100 %* ohne
Marktwert. Das war die Messung, nicht die Wirklichkeit — sie las `meta.marketCap` und
`metrics.marketCap`, während das Feld auf der **obersten** Ebene als `marketCap: {value, source,
confidence}` liegt. Aufgefallen ist es nur, weil 100 % unglaubwürdig war: die Boards tragen
sichtbar Größenklassen. **Die Messebene gehört zur Messung** — ein falsch verdrahteter Zähler
hätte hier einen Totalausfall gemeldet, den es nie gab.

## §3 Was folgt

1. **T142 schließen** — die vorab festgelegte Defekt-Bedingung ist nicht eingetreten.
   Als eigener, kleiner Punkt bleibt die Schreib-Wache aus §1b (Länge statt Inhalt).
2. **T144 schließen** mit dieser Messung als Beleg.
3. **T134 bleibt offen** und ist von beidem unberührt: dort sind die Perioden-Enden echte
   Datums-Strings, die Messebene war korrekt, und der Befund (6,9 % befüllt, ~35 % vorhanden
   und leer) steht — nachgeprüft, nachdem der T142-Fehler auffiel.
4. **Für künftige Messungen — die eigentliche Lehre dieses Berichts:** *beide* Fehlmessungen
   von heute waren Messebenen-Fehler, nicht Datenfehler.
   - T144 las `meta.marketCap`, das Feld liegt auf oberster Ebene → gemeldet: 100 % Ausfall,
     tatsächlich: 0.
   - T142 las `x.value`, die Reihen tragen rohe Zahlen → gemeldet: 0 % belegt, tatsächlich:
     48–78 %.
   Beide Male hätte ein Blick auf **eine einzige echte Zeile** vor dem Zählen genügt. Wer über
   einen Bestand aggregiert, druckt zuerst ein Beispiel — und wer ein Ergebnis von 0 % oder
   100 % bekommt, misst zuerst sein Messgerät nach.
   Dazu bleibt der ursprüngliche Punkt: mit dem alten lokalen Bestand wären beide Fragen
   ebenfalls falsch beantwortet worden. Wer gegen `snapshots/` misst, muss sagen, aus welchem
   Lauf der Bestand stammt.
