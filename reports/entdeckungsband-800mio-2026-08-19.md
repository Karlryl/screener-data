# Entdeckungsband 800 Mio - 2 Mrd USD: was der Screener zusaetzlich saehe

Gemessen 2026-08-19 mit `node scripts/messung-entdeckungsband.js {tv,register,preise,rechnen,bericht}`.
Keine Schwelle wurde gesenkt; die Messung laeuft ueber die vorhandenen Umgebungsvariablen in eigenen Kindprozessen.

## Die vier Schwellen des Repos

| Tor | Ort | heute | wirkt auf |
|---|---|---|---|
| 1 | `discovery/tv-scanner.js` `TV_PRECUT_USD` | 1500 Mio | ~31 TradingView-Laender, filtert bereits serverseitig |
| 2 | `discovery/mcap-prefilter.js` `MCAP_PREFILTER_MIN_USD` | 2000 Mio | alle Auslandsquellen mit marketCap:null |
| 3 | `refresh-universe.js` `MIN_MCAP_DISCOVERY` | 800 Mio | US-Kanaele — liegt bereits richtig |
| 4 | `daily-pull.yml` `MIN_MCAP_USD` | 800 Mio | der Abruf selbst — nimmt ab 800 Mio |

Tor 1 und Tor 2 sind fuer die TradingView-Laender **in Reihe** geschaltet.

## Die drei Szenarien

| Szenario | Zusatz-Ticker | Firmen mit Score: konservativ | beste Schaetzung | optimistisch |
|---|---:|---:|---:|---:|
| (a) nur Tor 2 auf 800 Mio | 592 | 241 | 312 | 536 |
| (b) nur Tor 1 auf 800 Mio | 3 | 0 | 0 | 3 |
| **(c) beide auf 800 Mio** | **960** | **382** | **453** | **870** |

**Die drei Annahmen im Klartext.** *Konservativ*: die neuen Namen erreichen genau die Quote, die ihre Quelle heute ueber ALLE Groessen erreicht — diese Quote ist durch Zweitlistungen der grossen Namen (Wien, Mailand, Zuerich) nach unten verzerrt. *Optimistisch*: sie erreichen die Quote, die Bestandszeilen IM SELBEN GROESSENBAND heute tatsaechlich erreichen (90.6 %, gemessen an 2633 Zeilen) — diese Quote ist von CN/TW/IN dominiert, waehrend die Neuzugaenge aus HK/CA/AT/IT kommen. *Beste Schaetzung*: Band-Quote wo die Quelle mindestens 20 Bestandszeilen im Band hat, sonst die konservative.

Bereits im Bestand (watchlist.json) und daher **kein** Zugewinn: 9291 Kandidaten.
Von Yahoo nicht bepreisbar (kein Kurs/kein Marktwert): 3641 von 29717.

## Je Land

| Land | Kandidaten | im Bestand | unbepreisbar | (a) | (b) | (c) |
|---|---:|---:|---:|---:|---:|---:|
| HK | 2779 | 466 | 41 | 210 | 0 | 210 |
| CA | 2264 | 182 | 394 | 90 | 0 | 90 |
| AT | 891 | 758 | 68 | 22 | 1 | 63 |
| IT | 1451 | 957 | 432 | 21 | 1 | 61 |
| TR | 109 | 52 | 5 | 12 | 1 | 51 |
| IN | 2553 | 604 | 269 | 46 | 0 | 46 |
| DE | 1424 | 563 | 550 | 44 | 0 | 44 |
| BR | 207 | 64 | 107 | 6 | 0 | 33 |
| ID | 115 | 82 | 0 | 0 | 0 | 32 |
| SG | 104 | 64 | 8 | 0 | 0 | 31 |
| NO | 295 | 45 | 12 | 29 | 0 | 29 |
| CH | 869 | 180 | 661 | 12 | 0 | 28 |
| TH | 92 | 58 | 6 | 1 | 0 | 28 |
| TW | 2148 | 322 | 187 | 22 | 0 | 22 |
| ES | 87 | 62 | 5 | 7 | 0 | 20 |
| CL | 76 | 26 | 33 | 4 | 0 | 17 |
| AU | 1830 | 229 | 68 | 17 | 0 | 17 |
| VN | 65 | 40 | 9 | 0 | 0 | 16 |
| PL | 103 | 83 | 3 | 3 | 0 | 16 |
| BE | 46 | 30 | 3 | 6 | 0 | 13 |
| GR | 35 | 22 | 0 | 2 | 0 | 13 |
| NORDIC | 664 | 218 | 34 | 12 | 0 | 12 |
| NZ | 28 | 17 | 2 | 1 | 0 | 9 |
| AR | 68 | 9 | 51 | 1 | 0 | 8 |
| CN | 5229 | 2878 | 65 | 5 | 0 | 7 |
| CO | 20 | 14 | 0 | 3 | 0 | 6 |
| GB | 1625 | 35 | 325 | 6 | 0 | 6 |
| IE | 12 | 6 | 1 | 1 | 0 | 5 |
| PT | 16 | 10 | 1 | 1 | 0 | 5 |
| ZA | 96 | 1 | 2 | 5 | 0 | 5 |
| QA | 26 | 20 | 0 | 1 | 0 | 5 |
| RO | 12 | 8 | 0 | 2 | 0 | 4 |
| FR | 162 | 148 | 10 | 0 | 0 | 3 |
| NL | 61 | 56 | 3 | 0 | 0 | 2 |
| MX | 83 | 16 | 65 | 0 | 0 | 2 |
| HU | 6 | 2 | 3 | 0 | 0 | 1 |
| JP | 3861 | 860 | 117 | 0 | 0 | 0 |
| MY | 100 | 0 | 100 | 0 | 0 | 0 |
| SA | 99 | 99 | 0 | 0 | 0 | 0 |
| CZ | 6 | 5 | 1 | 0 | 0 | 0 |

## Je Quelle, mit der historischen Ticker-zu-Score-Quote

Quote = wie viele Watchlist-Zeilen dieser Quelle am 2026-08-19 tatsaechlich in einem Board mit Score standen (9009 von 20956 insgesamt).

| Quelle | Land | Bestand | mit Score | Quote gesamt | Bestand im Band | Quote im Band | (a) | (b) | (c) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| hkex | HK | 378 | 211 | 55.8 % | 25 | 80.0 % | 210 | 0 | 210 |
| tsx | CA | 366 | 83 | 22.7 % | 3 | zu wenige | 90 | 0 | 90 |
| tvat | AT | 764 | 206 | 27.0 % | 7 | zu wenige | 22 | 1 | 63 |
| tvit | IT | 1341 | 149 | 11.1 % | 5 | zu wenige | 21 | 1 | 61 |
| tvtr | TR | 55 | 0 | 0.0 % | 3 | zu wenige | 12 | 1 | 51 |
| nse | IN | 702 | 302 | 43.0 % | 241 | 50.2 % | 46 | 0 | 46 |
| xetra | DE | 513 | 82 | 16.0 % | 4 | zu wenige | 44 | 0 | 44 |
| tvbr | BR | 62 | 48 | 77.4 % | 4 | zu wenige | 6 | 0 | 33 |
| tvid | ID | 83 | 63 | 75.9 % | 19 | zu wenige | 0 | 0 | 32 |
| tvsg | SG | 72 | 59 | 81.9 % | 13 | zu wenige | 0 | 0 | 31 |
| oslo | NO | 41 | 26 | 63.4 % | 1 | zu wenige | 29 | 0 | 29 |
| tvch | CH | 973 | 60 | 6.2 % | 2 | zu wenige | 12 | 0 | 28 |
| tvth | TH | 60 | 43 | 71.7 % | 14 | zu wenige | 1 | 0 | 28 |
| finmind | TW | 424 | 293 | 69.1 % | 131 | 93.1 % | 22 | 0 | 22 |
| tves | ES | 44 | 21 | 47.7 % | 2 | zu wenige | 7 | 0 | 20 |
| tvcl | CL | 33 | 18 | 54.5 % | 0 | zu wenige | 4 | 0 | 17 |
| asx | AU | 309 | 128 | 41.4 % | 83 | 90.4 % | 17 | 0 | 17 |
| tvvn | VN | 46 | 0 | 0.0 % | 10 | zu wenige | 0 | 0 | 16 |
| tvpl | PL | 84 | 29 | 34.5 % | 2 | zu wenige | 3 | 0 | 16 |
| tvbe | BE | 24 | 10 | 41.7 % | 0 | zu wenige | 6 | 0 | 13 |
| tvgr | GR | 21 | 13 | 61.9 % | 0 | zu wenige | 2 | 0 | 13 |
| nordic | NORDIC | 173 | 108 | 62.4 % | 41 | 87.8 % | 12 | 0 | 12 |
| tvnz | NZ | 19 | 10 | - | 0 | zu wenige | 1 | 0 | 9 |
| tvar | AR | 22 | 0 | 0.0 % | 0 | zu wenige | 1 | 0 | 8 |
| tvco | CO | 14 | 0 | - | 0 | zu wenige | 3 | 0 | 6 |
| lse | GB | 370 | 33 | 8.9 % | 2 | zu wenige | 6 | 0 | 6 |
| tvsz | CN | 774 | 753 | 97.3 % | 175 | 98.3 % | 3 | 0 | 5 |
| tvie | IE | 5 | 1 | - | 0 | zu wenige | 1 | 0 | 5 |
| tvpt | PT | 7 | 5 | - | 0 | zu wenige | 1 | 0 | 5 |
| tvza | ZA | 1 | 0 | - | 0 | zu wenige | 5 | 0 | 5 |
| tvqa | QA | 20 | 10 | 50.0 % | 0 | zu wenige | 1 | 0 | 5 |
| tvro | RO | 8 | 0 | - | 0 | zu wenige | 2 | 0 | 4 |
| tvfr | FR | 69 | 41 | 59.4 % | 10 | zu wenige | 0 | 0 | 3 |
| tvnl | NL | 37 | 15 | 40.5 % | 1 | zu wenige | 0 | 0 | 2 |
| tvmx | MX | 65 | 14 | 21.5 % | 4 | zu wenige | 0 | 0 | 2 |
| szse | CN | 0 | 0 | - | 0 | zu wenige | 2 | 0 | 2 |
| tvhu | HU | 3 | 0 | - | 0 | zu wenige | 0 | 0 | 1 |
| tvjp | JP | 26 | 26 | 100.0 % | 9 | zu wenige | 0 | 0 | 0 |
| tvmy | MY | 68 | 0 | 0.0 % | 0 | zu wenige | 0 | 0 | 0 |
| tvksa | SA | 70 | 52 | 74.3 % | 9 | zu wenige | 0 | 0 | 0 |
| tvcz | CZ | 5 | 0 | - | 0 | zu wenige | 0 | 0 | 0 |
| edinet | JP | 394 | 227 | 57.6 % | 248 | 89.9 % | 0 | 0 | 0 |
| sse | CN | 809 | 746 | 92.2 % | 46 | 97.8 % | 0 | 0 | 0 |

## Was diese Messung NICHT abdeckt

- **Abgeschnittene Maerkte bei 800 Mio** (Zeilendeckel `TV_SCAN_RANGE`, Vorgabe 2500): tv-szse. Deren (b)/(c)-Zahlen sind eine **Untergrenze**.
- **Quelle ausgefallen:** opendart: lieferte 0 Ticker (kein Fehler gemeldet — z.B. fehlender API-Schluessel)
- Alle drei Schaetzungen unterstellen, dass die Datenverfuegbarkeit der neuen Namen der der heutigen Bestandszeilen entspricht. Fuer Firmen, die noch nie im Universum waren, ist das nicht bewiesen.
- Bereits im Bestand heisst NICHT "durch die Schwelle gekommen": Bestandszeilen laufen gar nicht mehr durch Tor 2. Die Schwelle wirkt nur auf NEUE Entdeckungen — sie ist eine Einbahnstrasse. Wer einmal drin ist, bleibt; wer herausfaellt, kommt unter 2 Mrd nicht zurueck.
- Nicht hochgerechnet, weil die Quelle keine belastbare Bestandsquote hat (< 20 Zeilen): 37 Ticker aus tvie, tvpt, tvza, tvnz, tvco, tvro, tvhu, szse.

Rohdaten: `reports/messung-entdeckungsband-{tv,register,preise,ergebnis}.json` (TV-Maerkte 31, Register-Quellen 13).
