# T134 — Altersverteilung der Jahresreihen: messbar, aber nur auf 6,9 % des Bestands

**Stand:** 2026-08-29 · **Datenbasis:** `snapshots/` aus dem CI-Artefakt des Laufs `33244450690` (15.044 lesbare Dateien)
**Messskript:** `scripts/probe-jahresreihen-alter.js` (rein lesend)

> **Korrektur (Tag 1052), gemeldet vom Orchestrator:** die erste Fassung des Messskripts
> filterte mit `!f.startsWith('_')` statt mit dem zentralen Prädikat `isMetadataSnapshot`.
> Dadurch fielen **4 echte Snapshots** mit reserviertem Namen (z. B. `_CON.json` — CON ist
> unter Windows ein Gerätename) still heraus, und der blockierende Wächter
> `tests/p1-welle8-metadata-filter.test.js` wurde auf `main` rot. Beides ist behoben; die
> Zahlen unten stehen mit dem korrekten Prädikat (Nenner 15.044 statt 15.040), die
> Kernaussage — 1.043 befüllte Jahres-Enden — ist unverändert.

---

## AUF EINEN BLICK

**T134 bleibt blockiert — aber ab jetzt aus einem präzisen, gemessenen Grund statt aus „der volle Pull fehlt".**
Der volle Pull ist gelaufen. Die Jahres-Perioden-Enden sind trotzdem fast überall leer.

- **Nur 1.043 von 15.044 Snapshots (6,9 %)** tragen in `annual.annualRevEnds` tatsächlich Datumswerte.
- **Weitere 5.238 (34,8 %) tragen das Feld, aber LEER** — und genau das ist die Falle: eine
  Anwesenheits-Prüfung („hat der Snapshot `annualRevEnds`?") meldet für diese Dateien „ja".
  Die im Masterplan notierten „~39 % der Snapshots" beschreiben die **Anwesenheit**, nicht den Inhalt.
- Der Rest (~58 %) hat das Feld gar nicht.
- **Zum Vergleich:** die QUARTALS-Enden sind breit gefüllt — `timeseries.revenueQEnds` trägt bei
  **13.916 (92,5 %)** echte Daten. Das Problem sitzt ausschließlich in der Jahresschicht.

---

## §1 Was gemessen wurde

Je Snapshot das **jüngste** Perioden-Ende über die drei Kernreihen (`annualRev`, `annualOpInc`,
`annualNetIncome`), gelesen an BEIDEN Orten (`annual.<reihe>Ends` und `timeseries.<reihe>Ends`),
und der Abstand zum Stichtag 2026-08-29.

## §2 Feld-Inventar — Anwesenheit gegen Inhalt

| Feld | mit Datum | vorhanden, aber leer |
|---|---:|---:|
| `timeseries.revenueQEnds` | 13.916 (92,5 %) | 1.121 (7,5 %) |
| `timeseries.grossProfitQEnds` | 13.916 (92,5 %) | 1.121 (7,5 %) |
| `timeseries.opIncQEnds` | 11.001 (73,1 %) | 3.202 (21,3 %) |
| **`annual.annualRevEnds`** | **1.043 (6,9 %)** | **5.238 (34,8 %)** |
| **`annual.annualGPEnds`** | **1.043 (6,9 %)** | **5.238 (34,8 %)** |
| **`annual.annualOpIncEnds`** | **859 (5,7 %)** | **5.422 (36,1 %)** |

**Das Verhältnis ist die Aussage:** bei den Jahresreihen ist das leere Feld **fünfmal häufiger**
als das gefüllte. Wer auf Anwesenheit prüft, misst 41,7 % Abdeckung — tatsächlich sind es 6,9 %.

## §3 Die Altersverteilung, soweit heute messbar

⚠️ **Nicht repräsentativ.** Die folgenden Zahlen gelten für die 1.043 Snapshots mit befüllten
Jahres-Enden. Ob diese Teilmenge zufällig ist oder systematisch (z. B. nur bestimmte Quellen
oder Regionen), ist **nicht geprüft** — und genau deshalb trägt T134 die Messung noch nicht.

| Kennzahl | Tage | Jahre |
|---|---:|---:|
| Minimum | 60 | 0,16 |
| p10 | 151 | 0,41 |
| **Median** | **241** | **0,66** |
| p75 | 241 | 0,66 |
| p90 | 302 | 0,83 |
| p99 | 4.169 | 11,41 |
| Maximum | 8.642 | **23,66** |

**Anteil über Schwelle:** älter als 1 Jahr **8,1 %** · über 1,5 Jahre 4,8 % · über 2 Jahre 3,5 % ·
über 3 Jahre **3,0 %**.

**Zwei Beobachtungen:**
1. **Der Normalfall ist unauffällig.** Median 241 Tage, p90 bei 302 Tagen — das ist der erwartete
   Abstand zwischen Geschäftsjahresende und laufendem Datum. 77,2 % der jüngsten Enden liegen im
   Monat **2025-12**, weitere 8,4 % in 2026-03: das übliche Bild aus Kalenderjahr-Abschlüssen plus
   März-Geschäftsjahren.
2. **Der Schwanz ist es nicht.** 3,0 % der Zeilen tragen als **jüngste** Jahreszahl einen Wert,
   der über drei Jahre alt ist, im Extremfall **23,7 Jahre**. Für eine Zeile, die heute bewertet
   wird, heißt das: ihre Jahresreihe beschreibt eine andere Firma als die von heute. Das ist die
   Datengrundlage, die T127/J-C angefordert hat — und sie sagt, dass die Frage berechtigt ist.

## §4 Was jetzt zu tun ist

1. **Zuerst die Befüllung klären, nicht die Verteilung.** Solange 93 % der Jahresreihen kein
   Perioden-Ende tragen, ist jede Altersaussage eine Aussage über eine unbekannte Teilmenge.
2. **Anwesenheit ist hier kein Beleg.** Jede Prüfung, die `annualRevEnds` per `in`/`hasOwnProperty`
   abfragt, hält 41,7 % für abgedeckt. Ein Zähler auf **befüllte** Einträge gehört dorthin, wo heute
   die Anwesenheit steht.
3. **Der bekannte Lese-Ort-Bruch bleibt daneben bestehen:** `periodEnds()` liest
   `snapshot.timeseries.*Ends`, geschrieben wird nach `annual.annual*Ends` (Masterplan 28.08.).
   Diese Probe liest bewusst **beide** Orte — der niedrige Wert ist also nicht die Folge des
   Lese-Ort-Bruchs, sondern liegt darunter.
