# Vorschlag: Auslands-Entdeckungsschwelle von 2 Mrd auf 800 Mio USD

Entscheidungsvorlage fuer Karl, 2026-08-19. **Nichts davon ist scharf geschaltet** — dieser
Zweig enthaelt nur das Ausschluss-Protokoll (Tag 642/643/645) und das Messwerkzeug (Tag 644).
Die Messung selbst steht in `reports/entdeckungsband-800mio-2026-08-19.md` (maschinell
gerendert, jederzeit reproduzierbar).

---

## 1. Die Antwort in einem Satz

Wenn **beide** Auslands-Schwellen auf 800 Mio USD fallen, kommen **960 zusaetzliche Ticker**
ins Universum, daraus werden voraussichtlich **rund 380 bis 870 Firmen mit einem Score** —
beste Schaetzung **etwa 450**. Der Tageslauf waechst dabei um **gut 2 Minuten** von heute
83 Minuten. Das passt ohne Umbau in den bestehenden Lauf.

## 2. Warum eine Schwelle allein nichts bringt

Es gibt vier Groessengrenzen im Repo, nicht zwei:

| Tor | Ort | heute | wirkt auf |
|---|---|---|---|
| 1 | `discovery/tv-scanner.js` → `TV_PRECUT_USD` | **1,5 Mrd** | ~31 TradingView-Laender |
| 2 | `discovery/mcap-prefilter.js` → `MCAP_PREFILTER_MIN_USD` | **2 Mrd** | alle Auslandsquellen |
| 3 | `refresh-universe.js` → `MIN_MCAP_DISCOVERY` | 800 Mio | US-Kanaele — liegt bereits richtig |
| 4 | `.github/workflows/daily-pull.yml` → `MIN_MCAP_USD` | 800 Mio | der Abruf — nimmt ab 800 Mio |

Fuer die 31 TradingView-Laender sind Tor 1 und Tor 2 **hintereinander** geschaltet, und Tor 1
filtert bereits auf dem TradingView-Server: Namen unter 1,5 Mrd kommen gar nicht erst ueber die
Leitung. Gemessen:

| Szenario | Zusatz-Ticker |
|---|---:|
| (a) nur Tor 2 auf 800 Mio | 592 |
| (b) nur Tor 1 auf 800 Mio | **3** |
| (c) beide auf 800 Mio | **960** |

(b) = 3 ist der Beweis der Reihenschaltung: Tor 1 zu senken bringt nichts, solange Tor 2 bei
2 Mrd steht. Und (a) = 592 zeigt die Gegenrichtung: nur Tor 2 zu senken laesst die 368 Namen
liegen, die Tor 1 vorher wegschneidet.

## 3. Wo die 960 herkommen (die 20 groessten Beitraege von 40 Laendern)

| Land | (c) | Land | (c) | Land | (c) | Land | (c) |
|---|---:|---|---:|---|---:|---|---:|
| Hongkong | 210 | Deutschland | 44 | Norwegen | 29 | Chile | 17 |
| Kanada | 90 | Brasilien | 33 | Schweiz | 28 | Australien | 17 |
| Oesterreich | 63 | Indonesien | 32 | Thailand | 28 | Vietnam | 16 |
| Italien | 61 | Singapur | 31 | Taiwan | 22 | Polen | 16 |
| Tuerkei | 51 | | | Spanien | 20 | Belgien | 13 |
| Indien | 46 | | | | | Griechenland | 13 |

Die vollstaendige Liste aller 40 Laender steht in der Messung.

**Japan, Shanghai, Saudi-Arabien und Frankreich liefern fast nichts** — nicht weil es dort
keine Firmen dieser Groesse gaebe, sondern weil sie **schon drin sind**: 9.291 der 29.717
gepruefeten Auslandskandidaten stehen bereits in `watchlist.json`. Fuer Japan sind es alle
360 Namen im Band, fuer Shanghai alle 665, fuer Taiwan alle 129.

## 4. Der wichtigste Nebenbefund: die Schwelle ist eine Einbahnstrasse

Bestandszeilen laufen **gar nicht mehr** durch Tor 2 — der Vorfilter fasst nur Kandidaten ohne
Marktwert an, und die Vereinigung mit dem Bestand passiert danach. Die 2-Mrd-Grenze blockiert
also ausschliesslich **neue** Entdeckungen. Konsequenz: wer einmal drin ist, bleibt drin; wer
einmal herausfaellt (Delisting-Fehlalarm, Ticker-Wechsel, Kursrutsch), kommt unter 2 Mrd
**nie zurueck**. Die heutige gute Abdeckung von Japan/Shanghai/Taiwan im Band 800 Mio - 2 Mrd
ist historischer Zufall, kein Systemzustand.

## 5. Lohnt sich das? Die Ticker-zu-Score-Quote

Rohe Ticker sind nicht Karls Frage. Gemessen am Jahrgang 2026-08-19 (9.009 von 20.956
Watchlist-Zeilen standen in einem Board):

| Groessenband (Auslandszeilen) | Zeilen | mit Score | Quote |
|---|---:|---:|---:|
| ab 10 Mrd | 3.024 | 975 | 32,2 % |
| 5 - 10 Mrd | 1.270 | 774 | 60,9 % |
| 2 - 5 Mrd | 2.301 | 1.718 | 74,7 % |
| **800 Mio - 2 Mrd** | **2.633** | **2.386** | **90,6 %** |
| unter 800 Mio | 523 | 102 | 19,5 % |

Das Band, um das es geht, hat die **beste** Quote des ganzen Universums. Die Grossen sind
schlecht, weil dort die Zweitlistungen sitzen (dieselbe Firma in Wien, Mailand und Zuerich —
`dup-issuer`/`non-us`); unter 800 Mio bricht es ein, weil der Abruf selbst dort abschneidet
(`MIN_MCAP_USD`). Karls 800-Mio-Boden liegt also genau richtig.

**Spanne mit ausgewiesener Annahme:**

| Annahme | Firmen mit Score aus 960 Tickern |
|---|---:|
| Konservativ: Quote der jeweiligen Quelle **ueber alle Groessen** (durch Zweitlistungen gedrueckt) | **382** |
| Beste Schaetzung: Band-Quote wo die Quelle ≥ 20 Bestandszeilen im Band hat, sonst konservativ | **453** |
| Optimistisch: die gemessenen 90,6 % pauschal | **870** |

Die konservative Zahl ist zu pessimistisch (sie rechnet die Zweitlistungs-Verduennung der
Grossen auf kleine Lokalwerte hoch), die optimistische zu freundlich (die 90,6 % sind von
CN/TW/IN dominiert, die Neuzugaenge kommen aus HK/CA/AT/IT). **Erwartungswert: rund 450.**

## 6. Die Kostenseite — Ampel GRUEN

| Kennzahl | Wert | Beleg |
|---|---|---|
| Universum heute | 20.956 Ticker | `watchlist.json` |
| Deckel | `MAX_UNIVERSE: '25000'` | `daily-pull.yml:221` (Skript-Vorgabe waere 30.000) |
| Freier Platz | **4.044** | Rechnung |
| Tageslauf heute | 83,1 min | Lauf 32211143015 (19.08.); Bandbreite der letzten 9 gruenen Laeufe 71 - 83 min |
| Kritischer Pfad | prep 30,3 → Shard-Pull 16,3 → merge 29,9 → scoring 4,6 | `gh run view 32211143015` |
| Skalierung | **~2,3 min je +1.000 Ticker** | 1,6 min gemessen (Juli-Cluster 15.267 gegen August-Cluster 20.919) + 0,78 min gerechnet fuer den neuen 4-fach-Preis-Job (`PRICE_SHARDS: '4'`, `--rate-limit 1500`) |
| **Aufschlag fuer 960 Ticker** | **+2,2 min** → ~85 min | |
| Engste Reserve | Earnings-Kalender 13,7 min gegen `timeout-minutes: 20` | steigt auf ~14,3 min |

960 Ticker sind **24 % des freien Platzes**. Kein Deckel muss angefasst werden, kein Sharding
umgebaut, kein Timeout erhoeht. **Eine Welle reicht** — ein Wellenplan waere hier
Selbstbeschaeftigung.

## 7. Der Vorschlag

**Ein Schritt, drei Zeilen in `.github/workflows/daily-pull.yml`, im Schritt "Refresh Universe"
(um Zeile 218):**

```yaml
        env:
          FINNHUB_API_KEY: ${{ secrets.FINNHUB_API_KEY }}
          MAX_UNIVERSE: '25000'
          MCAP_PREFILTER_MIN_USD: '800000000'   # Tor 2: 2 Mrd -> 800 Mio
          TV_PRECUT_USD: '800000000'            # Tor 1: 1,5 Mrd -> 800 Mio (sonst wirkt Tor 2 nicht)
          TV_SCAN_RANGE: '4000'                 # Shenzhen meldet bei 800 Mio 3.008 Treffer > Deckel 2.500
```

Reihenfolge und Begruendung:

1. **Beide Tore gleichzeitig.** Getrennt zu schalten waere nicht vorsichtiger, sondern
   wirkungslos: Tor 1 allein bringt 3 Ticker, Tor 2 allein laesst 368 liegen.
2. **`TV_SCAN_RANGE` mit.** Ohne diese Zeile schneidet der Zeilendeckel Shenzhen ab (gemessen:
   3.008 Treffer bei 800 Mio, geliefert 2.500) — und zwar am **unteren** Ende, also genau bei
   den Namen, um die es geht. Betrifft heute nur diesen einen Markt, kostet einen groesseren
   HTTP-Antwortkoerper je Markt und sonst nichts.
3. **Kein `MAX_UNIVERSE`-Anfassen.** 960 passen in 4.044.
4. **Erste Kontrolle am Tag danach:** `data-health/entdeckungs-ausschluss.json` (neu, Tag 642)
   zeigt, wer noch verworfen wurde und warum — Ticker, Quelle, Marktwert, Grund. Zusaetzlich
   `Universe-Cap:`- und `New tickers:`-Zeile im prep-Log.

**Nicht Teil dieses Vorschlags, aber gefunden:** Suedkorea fehlt vollstaendig in der
Entdeckung. `OPENDART_KEY` ist weder lokal noch im Workflow gesetzt, der Adapter ueberspringt
sich still, und es gibt keinen TradingView-Markt fuer Korea. Das ist kein Schwellen-, sondern
ein Zugangsproblem und gehoert in eine eigene Runde.

## 8. Gegenprobe von aussen

Die Messung oben rechnet aus TradingView- und Register-Abzuegen. Das **Ausschluss-Protokoll**
(Tag 642, hier erstmals scharf gelaufen) rechnet voellig unabhaengig davon — es zaehlt, was der
echte Entdeckungslauf an Tor 2 wegwirft:

| Quelle | Zahl |
|---|---:|
| Ausschluss-Protokoll, echter Lauf 19.08.: verworfene Zeilen, die eine 800-Mio-Grenze gehalten haetten | **708** |
| Messung, Szenario (a) — dieselbe Groesse, aber **ohne** die Zeilen, die schon im Bestand stehen | **592** |
| Differenz = Kandidaten, die ohnehin schon in `watchlist.json` stehen | 116 |

Zwei getrennt gebaute Wege, dieselbe Groessenordnung, und die Abweichung ist vollstaendig
erklaert. Das Protokoll des Laufs: `data-health/entdeckungs-ausschluss.json` — 18.292
verworfene Zeilen, jede mit Ticker, Quelle, Marktwert und einem von drei Gruenden
(`unter-schwelle` / `kein-aktien-typ` / `ohne-marktwert`), plus je Markt die wirksame
TradingView-Schwelle.

## 9. Was diese Messung NICHT hergibt

- **Shenzhen ist eine Untergrenze.** Der Zeilendeckel hat bei 800 Mio abgeschnitten; die echte
  Zahl fuer CN liegt hoeher als die ausgewiesenen 7.
- **3.641 der 29.717 Kandidaten konnten nicht bepreist werden** (Yahoo antwortet nicht oder
  liefert keinen Marktwert; besonders CH 661, DE 550, IT 432, CA 394, GB 325). Diese Zeilen
  sind fuer die Entscheidung aber **neutral**: ohne Marktwert greift die Schwelle bei ihnen
  weder heute noch spaeter — unbeantwortete Zeilen fallen in die bestehende Slot-Logik,
  beantwortete ohne Marktwert fliegen unabhaengig von der Hoehe der Schwelle raus.
- **Suedkorea: null Kandidaten** (siehe oben).
- Die Score-Erwartung ist eine Hochrechnung aus Bestandsquoten, keine Simulation des Scorings.
  Nach dem ersten Lauf mit der neuen Schwelle ist sie an `board-history` nachpruefbar.
