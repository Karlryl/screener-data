**Ergebnis: Die Vorbedingung "erster Vollpull durch" traegt auf dem LOKALEN Substrat NICHT — 58,2 % der lokalen Snapshots sind 31–60 Tage alt. Die Fussabdruck-Basis wird heute NICHT neu geschrieben. Konfidenz 90 %.**

# T197: Vorbedingung gemessen, Fixture nicht angefasst

AUF EINEN BLICK: Der Auftrag war ausdruecklich bedingt ("ONLY if the precondition holds — measure it
first"). Gemessen wurde beides: die CI-Population und der lokale Snapshot-Bestand. Sie widersprechen
einander deutlich, und das Fixture haengt am lokalen Bestand.

## Messung (22.09.2026, `meta.fundamentalsAsOf`, Stichtag 2026-09-22)

| Alter | CI-Population (Lauf 35700832192) | lokaler Bestand `snapshots/` |
| --- | --- | --- |
| Dateien gesamt | 16.091 | 15.040 |
| ohne `fundamentalsAsOf` | 0 | 0 |
| 0–7 Tage | 1.120 (7,0 %) | 16 (0,1 %) |
| 8–30 Tage | 14.967 (93,0 %) | 6.275 (41,7 %) |
| **31–60 Tage** | **3 (0,02 %)** | **8.746 (58,2 %)** |
| 61–90 Tage | 1 | 3 |
| > 90 Tage | 0 | 0 |

## Lesart

- **CI ist frisch:** 99,98 % juenger als 30 Tage. Das deckt sich mit T326 (beide Veraltungs-Definitionen
  0,02 % auf der CI-Population) und widerlegt die Brief-Praemisse "1–3 Monate alt" **fuer die CI-Seite**.
- **Lokal ist halb veraltet:** 58,2 % ueber 30 Tage. Das deckt sich mit dem Selektor-Befund vom 19.09.
  (58 % der Snapshots mit Fundamentaldaten > 30 Tage) und mit T331 (Vollpulls laufen in Wellen).
- Beide Zahlen sind richtig; sie messen verschiedene Substrate. Der Unterschied ist der Kern des Falls.

## Entscheidung

`node scripts/fussabdruck-basis.js --schreiben` wuerde die Basis aus dem **lokalen** Bestand schreiben.
Auf einem zu 58 % halbjahresalten Substrat wuerde das Fixture genau diese Mischung einfrieren und als
Referenz zementieren — ein Fixture, das den Zustand seiner Quelle nicht kennt, ist als Vergleichsmass
wertlos. **Deshalb heute kein Schreiblauf, kein Vintage, keine Datei angefasst.**

Zwei gangbare Wege, beide ausserhalb dieses Auftrags:
1. Fixture nach dem naechsten lokalen Vollpull schreiben (T331: naechste Welle kreuzt die 30-Tage-Marke
   um den 25.09.) — dann ist die Vorbedingung echt erfuellt.
2. Fixture aus einer CI-abgeleiteten Population schreiben (dort ist sie heute schon erfuellt) — das ist
   aber eine Substratsaenderung und damit eine Methodik-Frage, keine Mechanik.

**Warnung aus der eigenen Historie (F5885):** am 19.09. wurden Aktionen auf einem lokalen Snapshot-Befund
angeordnet, waehrend die CI korrekt war. Derselbe Substratsunterschied liegt hier wieder vor, nur mit
umgekehrten Vorzeichen. Deshalb nennt dieser Bericht bei jeder Zahl ihr Substrat.
