# F-4 Rang-Verschiebungen (2026-08-03)

Snapshot-Baum: `C:\Users\Anwender\AppData\Local\Temp\claude\C--Users-Anwender-Market-Structure-research\63b76ff5-0232-46b4-bda8-a3e0019da336\scratchpad\ci-shards-0803` — 12543 Snapshots.
Toleranz: 15 Tage (src/scoring/snapshot.js).
Vorher = dieselbe Engine mit entfernten Perioden-Enden (Positionsregel i+4).
Vergleich auf der VOLLEN gescorten Kohorte, nicht nur der sichtbaren Top-100.

**2776 von 12543 Snapshots bekommen eine ANDERE Wachstumszahl**
(auf den gerouteten Board-Zeilen: 2062). Das ist der direkte Effekt.

**5617 von 5975 Rang-Positionen verschieben sich.** Diese Zahl ist
ERWARTUNGSGEMAESS gross und darf NICHT als "alles hat sich geaendert" gelesen werden: das
Scoring ist kohorten-relativ perzentiliert, eine geaenderte Zahl verschiebt die Perzentile
ALLER Mitglieder derselben Kohorte um mindestens einen Platz. Aussagekraeftig ist die
GROESSE der Verschiebung (Median/p90 je Board) und die Spalte "eigene Zahl geaendert".

| Board | Zeilen | eigene Zahl geaendert | Rang geaendert | Median \|ΔRang\| | p90 \|ΔRang\| | neu in Top-100 | raus |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| consumer-discretionary|profitable | 632 | 162 | 610 | 9 | 85 | 12 | 12 |
| consumer-discretionary|unprofitable | 56 | 18 | 40 | 2 | 16 | 0 | 0 |
| consumer-staples|profitable | 348 | 102 | 324 | 5 | 78 | 16 | 16 |
| consumer-staples|unprofitable | 0 | 0 | 0 | - | - | 0 | 0 |
| energy|profitable | 249 | 72 | 243 | 13 | 52 | 17 | 17 |
| energy|unprofitable | 15 | 4 | 12 | 1 | 3 | 0 | 0 |
| financials|profitable | 248 | 87 | 244 | 13 | 62 | 16 | 16 |
| financials|unprofitable | 23 | 4 | 13 | 1 | 6 | 0 | 0 |
| health-care|profitable | 451 | 118 | 398 | 3 | 76 | 9 | 9 |
| health-care|unprofitable | 185 | 41 | 151 | 2 | 28 | 5 | 5 |
| industrials|profitable | 1161 | 446 | 1150 | 42 | 292 | 24 | 24 |
| industrials|unprofitable | 54 | 12 | 48 | 2 | 5 | 0 | 0 |
| it-services|profitable | 90 | 30 | 80 | 2 | 15 | 0 | 0 |
| it-services|unprofitable | 0 | 0 | 0 | - | - | 0 | 0 |
| materials|profitable | 615 | 308 | 598 | 14 | 143 | 19 | 19 |
| materials|unprofitable | 0 | 0 | 0 | - | - | 0 | 0 |
| real-estate|profitable | 300 | 48 | 262 | 2 | 16 | 4 | 4 |
| real-estate|unprofitable | 0 | 0 | 0 | - | - | 0 | 0 |
| semiconductors|profitable | 216 | 109 | 209 | 11 | 65 | 17 | 17 |
| semiconductors|unprofitable | 53 | 22 | 45 | 2 | 12 | 0 | 0 |
| software-comm-services|profitable | 366 | 60 | 341 | 4 | 23 | 6 | 6 |
| software-comm-services|unprofitable | 71 | 22 | 56 | 2 | 9 | 0 | 0 |
| tech-hardware|profitable | 362 | 186 | 357 | 9 | 53 | 8 | 8 |
| tech-hardware|unprofitable | 49 | 22 | 35 | 3 | 18 | 0 | 0 |
| utilities|profitable | 277 | 101 | 256 | 5 | 91 | 15 | 15 |
| utilities|unprofitable | 3 | 0 | 0 | - | - | 0 | 0 |
| UEBERSICHT | 200 | 88 | 145 | 6 | 41 | 20 | 20 |

### Groesste Einzelverschiebungen (Top 25, volle Kohorte)

| Board | Ticker | Rang vorher | Rang nachher | Wachstum vorher | nachher | Ursache |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| industrials|profitable | 300201.SZ | 1060 | 118 | -11.8 % | 50.5 % | 2026-03-31 vs 2025-03-31 (Pos 3) statt 2024-12-31 (Pos 4) |
| industrials|profitable | 600685.SS | 979 | 53 | -15.3 % | 56.1 % | 2026-03-31 vs 2025-03-31 (Pos 3) statt 2024-12-31 (Pos 4) |
| industrials|profitable | 600057.SS | 114 | 1002 | 43.7 % | 2.0 % | 2026-03-31 vs 2025-03-31 (Pos 3) statt 2024-12-31 (Pos 4) |
| industrials|profitable | EMBJ3.SA | 1037 | 173 | -37.4 % | 31.2 % | 2026-03-31 vs 2025-03-31 (Pos 3) statt 2024-12-31 (Pos 4) |
| industrials|profitable | 000680.SZ | 971 | 111 | -9.5 % | 20.1 % | 2026-03-31 vs 2025-03-31 (Pos 3) statt 2024-12-31 (Pos 4) |
| industrials|profitable | 300870.SZ | 1070 | 257 | -8.1 % | 17.3 % | 2026-03-31 vs 2025-03-31 (Pos 3) statt 2024-12-31 (Pos 4) |
| industrials|profitable | HAVELLS.NS | 972 | 197 | -0.4 % | 19.5 % | 2026-06-30 vs 2025-06-30 (Pos 3) statt 2025-03-31 (Pos 4) |
| industrials|profitable | 688003.SS | 1046 | 278 | -49.3 % | 75.6 % | 2026-03-31 vs 2025-03-31 (Pos 3) statt 2024-12-31 (Pos 4) |
| industrials|profitable | 688349.SS | 967 | 228 | -54.3 % | 82.2 % | 2026-03-31 vs 2025-03-31 (Pos 3) statt 2024-12-31 (Pos 4) |
| industrials|profitable | BHEL.NS | 1013 | 296 | -14.4 % | 40.3 % | 2026-06-30 vs 2025-06-30 (Pos 3) statt 2025-03-31 (Pos 4) |
| industrials|profitable | 688097.SS | 916 | 221 | -11.9 % | 100.9 % | 2026-03-31 vs 2025-03-31 (Pos 3) statt 2024-12-31 (Pos 4) |
| industrials|profitable | 600118.SS | 1036 | 365 | -82.5 % | 37.9 % | 2026-03-31 vs 2025-03-31 (Pos 3) statt 2024-12-31 (Pos 4) |
| industrials|profitable | 688005.SS | 986 | 323 | -18.7 % | 50.4 % | 2026-06-30 vs 2025-06-30 (Pos 4, per Datum bestaetigt) — Quartals-Bein greift jetzt trotz Luecke davor |
| industrials|profitable | 601877.SS | 802 | 175 | -8.3 % | 46.3 % | 2026-03-31 vs 2025-03-31 (Pos 4, per Datum bestaetigt) — Quartals-Bein greift jetzt trotz Luecke davor |
| industrials|profitable | 688281.SS | 1150 | 524 | -25.5 % | 23.9 % | 2026-03-31 vs 2025-03-31 (Pos 3) statt 2024-12-31 (Pos 4) |
| industrials|profitable | 603031.SS | 203 | 828 | 27.4 % | -3.4 % | 2026-03-31 vs 2025-03-31 (Pos 3) statt 2024-12-31 (Pos 4) |
| industrials|profitable | 600435.SS | 938 | 322 | -77.9 % | 22.7 % | 2026-03-31 vs 2025-03-31 (Pos 3) statt 2024-12-31 (Pos 4) |
| industrials|profitable | 002340.SZ | 326 | 937 | 19.9 % | 5.1 % | 2026-03-31 vs 2025-03-31 (Pos 3) statt 2024-12-31 (Pos 4) |
| industrials|profitable | 000157.SZ | 123 | 733 | 16.8 % | 6.9 % | 2026-03-31 vs 2025-03-31 (Pos 3) statt 2024-12-31 (Pos 4) |
| industrials|profitable | 301018.SZ | 331 | 941 | 39.6 % | -1.8 % | 2026-03-31 vs 2025-03-31 (Pos 4, per Datum bestaetigt) — Quartals-Bein greift jetzt trotz Luecke davor |
| industrials|profitable | 300083.SZ | 965 | 356 | -11.6 % | 12.2 % | 2026-03-31 vs 2025-03-31 (Pos 3) statt 2024-12-31 (Pos 4) |
| industrials|profitable | 688400.SS | 324 | 929 | 30.3 % | -2.8 % | 2026-03-31 vs 2025-03-31 (Pos 4, per Datum bestaetigt) — Quartals-Bein greift jetzt trotz Luecke davor |
| industrials|profitable | 603929.SS | 974 | 371 | -8.8 % | 35.4 % | 2026-03-31 vs 2025-03-31 (Pos 4, per Datum bestaetigt) — Quartals-Bein greift jetzt trotz Luecke davor |
| industrials|profitable | IMPC.JK | 651 | 61 | -19.6 % | 25.4 % | 2026-03-31 vs 2025-03-31 (Pos 3) statt 2024-12-31 (Pos 4) |
| industrials|profitable | 688248.SS | 444 | 1031 | 22.3 % | -12.7 % | 2026-03-31 vs 2025-03-31 (Pos 4, per Datum bestaetigt) — Quartals-Bein greift jetzt trotz Luecke davor |

### Namen mit geaenderter Wachstumszahl, nach Land (Top 20)

| Land | Namen |
| --- | ---: |
| China | 1412 |
| India | 245 |
| Sweden | 151 |
| Germany | 98 |
| France | 80 |
| Indonesia | 70 |
| Spain | 65 |
| Finland | 61 |
| Canada | 60 |
| Japan | 48 |
| Taiwan | 41 |
| Norway | 39 |
| Vietnam | 36 |
| Saudi Arabia | 32 |
| Denmark | 30 |
| Italy | 28 |
| Brazil | 28 |
| United States | 27 |
| Mexico | 27 |
| Switzerland | 26 |
