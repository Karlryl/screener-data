# Zählwerk: Jahres-Ausreisser-Wächter

**Handgepflegt vom Orchestrator. Das Skript schreibt diese Datei NICHT** — `scripts/watch-annual-spikes.js`
hat keinen Schreibpfad im Tageslauf (JA-12, ENTSCHIED 12:40 vom 29.08.: der CI-Job hat bewusst keinen
Commit-Schritt). Die Zahlen unten werden aus dem CI-Log abgelesen und hier von Hand nachgetragen. Wer sie
automatisieren will, braucht zuerst einen Beschluss über ein Schreibrecht — nicht einen Patch an dieser Stelle.

**Wozu:** JA-11 verlangt, dass die Kipp-Bedingung **K1** aus dem Log *abgelesen* statt neu verhandelt wird.
Diese Datei ist die Ablesestelle. Die vier Zählvarianten stehen seit dem Umsetzungs-PR (JA-1..JA-7) in jedem
Lauf im Log als eine Zeile: `Zaehlwerk: roh N · naiver Set-Key N · zwei Relationen N · zwei Relationen ohne Sperren N (erlaubt 5)`.

---

## 1 — Die NEU-Serie unter der ALTEN Zählung (Funde, vor dem Umsetzungs-PR)

Das ist die Reihe, die zum Gericht geführt hat: gezählt in **Funden**, Ausschlüsse noch **im** Budget.

| Datum | NEU (alte Zählung) | Budget | Stand |
| --- | --- | --- | --- |
| 2026-08-30 | 4 | 5 | grün, aber 4 von 5 Plätzen von der eigenen Ausschluss-Liste belegt |
| 2026-09-01 | 7 | 5 | rot (Anlasslauf `33493908237`) |
| 2026-09-02 | 11 | 5 | rot |

## 2 — Die 11 Funde vom 02.09., nachgespielt unter der NEUEN Zählung

Zwei Lesarten, weil die eine Voraussetzung **nicht bewiesen** ist: ob `HMT.BO` und `HMT.NS` denselben
`fxRateApplied` tragen (Beweisgrenze §1.2 Nr. 2 des Protokolls — beide Snapshots liegen lokal nicht vor).
Lesart A nimmt sie als byte-gleich an, Lesart B als FX-getrennt. **Der Beschluss trägt in beiden.**

| Lesart | roh | naiver Set-Key | zwei Relationen | zwei Relationen ohne Sperren | Budget |
| --- | --- | --- | --- | --- | --- |
| **A** — HMT-Zwillinge byte-gleich | 11 | 9 | 8 | **6** | 5 |
| **B** — HMT-Zwillinge FX-getrennt | 11 | 10 | 9 | **7** | 5 |

Gezählt wird am Tor die **letzte** Spalte (Ereignisse, ohne Sperren — JA-1). Gedruckt werden unverändert
alle 11 Funde.

## 3 — Die Leseregel für K1, wörtlich aus §7 des Gerichtsprotokolls

> | **K1** | Über die **fünf** Tageslaufe nach der nächsten frischen Verankerung kommen **echte** neue Ereignisse (ohne Ausschlüsse, ohne Drift-Wiederholungen, nach Ereignissen gezählt) mit **> 3/Tag** an | Nicht das Budget ist das Problem, sondern die Grundrate. Dann bleiben nur Kadenz (Option 3, **mit** Zwangs-Quittung) oder höhere Schwelle (Option 2) — beide zu ihrem benannten Preis, beide zurück ans Gericht. Ablesbar direkt aus JA-11 |

**Wie das praktisch gelesen wird:** abgelesen wird die Spalte *zwei Relationen ohne Sperren*, und zwar erst
über die fünf Läufe **nach** der nächsten frischen Verankerung — vorher misst die Reihe den Altbestand, nicht
die Grundrate. Liegt der Schnitt dieser fünf über 3/Tag, ist die Sache eine Gerichtsfrage und **keine**
Schwellen-Anpassung an dieser Stelle. Eine Verankerung bleibt an **RA8** gebunden (Pflicht-Kontrolllauf, flagfrei).

## 4 — Messreihe nach der nächsten Verankerung (K1-Fenster, hier eintragen)

Noch leer: unter diesem Beschluss wird **nicht** neu verankert (JA-12). Die fünf Zeilen entstehen erst nach
einer beschlossenen Verankerung.

| Lauf | Datum | roh | naiver Set-Key | zwei Relationen | ohne Sperren | Ausschluss-Liste (Größe) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | — | — | — | — | — | — |
| 2 | — | — | — | — | — | — |
| 3 | — | — | — | — | — | — |
| 4 | — | — | — | — | — | — |
| 5 | — | — | — | — | — | — |

---

**Quelle:** `_COURT-JAHRES-AUSREISSER-2026-09-02.md` (§5 JA-11, §7 K1), ratifiziert 2026-09-02T06:42:56Z.
**Verwandt:** `data-health/annual-spikes-baseline.json` (Bestand + Ausschluss-Liste), `scripts/watch-annual-spikes.js`.
