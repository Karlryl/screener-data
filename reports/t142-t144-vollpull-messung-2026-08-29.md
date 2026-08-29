# T142 und T144 — die beiden Fragen, die auf den vollen Pull warteten

**Stand:** 2026-08-29 · **Datenbasis:** `snapshots/` aus dem CI-Artefakt des Laufs `33244450690`
(15.040 lesbare Dateien; die alten Messungen liefen gegen 4.769 lokale Altbestände)

---

## AUF EINEN BLICK

Beide Punkte waren seit dem 23.08. mit derselben Begründung geparkt: *„erst nach dem ersten
vollen Pull messbar"*. Der Pull ist da. **Das Ergebnis ist gegensätzlich:**

- **T142 — bestätigter Defekt.** Die drei Ausschüttungs-Reihen sind **0 von 15.040** belegt.
  T142 hatte genau diesen Fall vorab als Kriterium festgelegt: *„Ist die Belegung danach immer
  noch 0, ist es dann einer [ein Defekt]."* Die Bedingung ist eingetreten.
- **T144 — erledigt.** **0 von 15.040** Snapshots ohne Marktwert. Die ursprünglichen
  „91 von 4.769" waren ein Artefakt des alten lokalen Bestands; im echten Universum fällt
  niemand still durch.

---

## §1 T142 — Ausschüttungs-Reihen: Feld da, Wert nie

| Reihe | mit Wert | vorhanden, aber leer | Feld fehlt |
|---|---:|---:|---:|
| `annualRepurchase` | **0 (0,0 %)** | 14.075 | 965 |
| `annualDividendsPaid` | **0 (0,0 %)** | 14.075 | 965 |
| `annualNetCommonStockIssuance` | **0 (0,0 %)** | 14.075 | 965 |

**Warum das jetzt ein Befund ist und am 23.08. keiner war:** damals waren alle lokalen
Snapshots älter als Juli, die Felder kamen erst mit Karls Mandat vom 03.08. — eine Null war
also erwartbar. Dieser Bestand stammt aus dem Lauf vom **29.08.**, also deutlich nach der
Einführung. Die Reihen werden angelegt und bleiben leer.

**Dieselbe Gestalt wie bei T134** (Jahres-Perioden-Enden, `reports/jahresreihen-alter-2026-08-29.md`):
ein Feld, das existiert und nichts enthält. Eine Anwesenheits-Prüfung meldet für 14.075 Dateien
„Feld da". Es sind zwei verschiedene Reihen mit demselben Muster — das legt eine gemeinsame
Ursache im Schreibpfad nahe, ist aber **nicht** bewiesen und gehört gemessen, nicht vermutet.

**Der bestehende Test bleibt zu Recht grün:** `tests/scoring/f1-ausschuettungsfelder.test.js`
prüft die Verdrahtung synthetisch, nicht die Belegung im echten Bestand. Er ist nicht kaputt —
er beantwortet eine andere Frage. Genau deshalb stand T142 überhaupt in der Liste.

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

1. **T142 an die Queue:** der Schreibpfad der drei Reihen gehört nachgesehen — warum wird das
   Feld angelegt und nie befüllt. Die Nähe zum T134-Muster ist ein Hinweis, kein Beleg.
2. **T144 schließen** mit dieser Messung als Beleg.
3. **Für künftige Messungen:** beide Fragen wären mit dem alten lokalen Bestand falsch
   beantwortet worden — T144 falsch-positiv (91 Ausfälle, die es nicht gibt), T142 falsch-negativ
   (Null wäre als „erwartbar" durchgegangen). Wer gegen `snapshots/` misst, muss sagen, aus
   welchem Lauf der Bestand stammt.
