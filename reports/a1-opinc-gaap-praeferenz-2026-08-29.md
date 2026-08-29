# A1 — SEC-GAAP-OpInc-Praeferenz + ehrliche `opIncSource`-Etiketten

**Gerichts-Abhilfe zu K1** aus `_COURT-T164-OPINC-2026-08-29.md`, ratifiziert als **ENTSCHIED 15**
(Orchestrator, 29.08.2026 18:55). Auflagen K1.1–K1.4, A2-Mechanik-Entscheid (kein Massen-Re-Pull).
Erhebung: 29.08.2026, Store-Stand vom selben Tag (15.046 Haupt- + 103 Small-Cap-Snapshots),
SEC-Schicht `external-data/{sec,kr,jp,tw}-secannual*.json` mit 537 Namen.

---

## 1. Was gebaut wurde

| Auflage | Umsetzung |
|---|---|
| **K1.1** SEC-GAAP-OpInc beim Snapshot-Merge bevorzugen | `scripts/opinc-source-migrate.js`, verdrahtet im **scoring-Job** von `daily-pull.yml` unmittelbar vor `run-screener.js` |
| **K1.2** `'native'` stirbt, `meta.opIncSource` wird ehrlich | `pull-yahoo.js` schreibt kuenftig `'yahoo-adjusted'`; der Bestand wird lokal migriert, **kein Re-Pull** |
| **K1.3** kein Name verliert Daten, kein Exclude fuer Nur-Yahoo-Namen | 14.891 Namen ohne SEC-Serie bleiben unberuehrt; die ersetzte Yahoo-Reihe bleibt als `annual.annualOpIncYahoo` am Datensatz; **0 Abgaenge, 0 Neuzugaenge** im Board-Diff |
| **K1.4** Board-Diff mit HNRG-/EGY-Flips explizit | Abschnitte 4 und 5 dieses Berichts |

### Warum die Praeferenz im scoring-Job sitzt und nicht im merge-Job
`scripts/build-secannual.js` validiert jede SEC-Reihe **gegen die Yahoo-Reihe des Stores**
(`looseSanity`: gleiches Vorzeichen im neuesten Jahr, ~2x-Umsatzskala). Liefe die Praeferenz im
merge-Job, traegen die SEC-Werte ins hochgeladene `snapshots`-Artefakt — und `monthly-sec-xbrl.yml`
zieht genau dieses Artefakt. Das Tor vergliche kuenftig SEC gegen SEC und waere **still zur
Tautologie** geworden. Der scoring-Job beruehrt weder die Shard-Caches noch das Artefakt.
Zweiter Boden fuer lokale Laeufe: beide Builder lesen `annual.annualOpIncYahoo`, wo es existiert
(`yahooOpIncOf()` in `build-secannual.js`, EINE Stelle fuer beide Aufrufer).

---

## 2. Die Ersetzungsregel (und was sie bewusst NICHT tut)

1. **Ausrichtungs-Beleg am Umsatz.** Der Yahoo-Jahresblock traegt keine Jahres-Labels; dass
   Position *i* beider Quellen dasselbe Geschaeftsjahr meint, ist nicht aus den Daten ableitbar
   (`merge-sec-xbrl.js:419-431`: Versatz 0 nur bei **80,6 %** der Firmen bestaetigt). Getauscht wird
   nur, wenn mindestens **zwei** Umsatzjahre positionsweise vergleichbar sind und die groesste
   relative Abweichung **≤ 2 %** betraegt — dieselbe Schwelle wie die Erhebung vom 28.07.
   Das ist die direkte Antwort auf den R2-Dissens (heuristisches Index-Alignment).
2. **Fensterlaenge bleibt.** Ersetzt wird positionsweise ueber die Laenge der Yahoo-Reihe. Die
   tiefere SEC-Reihe erreicht das Scoring weiter ueber den bestehenden additiven Kanal
   `snapshot.secAnnual`. Ein laengen-veraendernder Tausch braeche die positionale Kopplung
   `annualRev[i] ↔ annualOpInc[i]`, auf der revAcceleration/marginTrajectory/ruleOfX stehen.
   **Vertiefung ist Abhilfe A3, nicht A1.**
3. **Keine Reihe aus zwei Definitionen.** Hat die SEC-Reihe im Fenster ein Loch, wo Yahoo einen
   Wert traegt, wird der Name nicht getauscht. Dieselbe Regel deckt automatisch die zu kurze
   SEC-Serie ab (IREN: 1 SEC-Jahr gegen 4 Yahoo-Jahre).
4. **Idempotent und rueckwegfaehig.** Die Transformation ist eine reine Funktion aus
   (Yahoo-Reihe, SEC-Schicht). Faellt eine SEC-Serie weg oder reisst die Ausrichtung, kommt die
   bewahrte Yahoo-Reihe zurueck. Kein Ratchet.

---

## 3. Zensus des Laufs (15.145 Snapshots)

### Etiketten-Migration
| Uebergang | Dateien |
|---|---|
| `native` → `yahoo-adjusted` | **12.629** |
| → `sec-gaap` | **128** |
| `computed-margin` unveraendert | 1.883 |
| `null` unveraendert | 505 |
| **geschriebene Dateien** | **12.757** |

Nach dem Lauf traegt **kein** Snapshot mehr das Etikett `'native'`.

### Warum ein Name nicht getauscht wurde
| Grund | Namen |
|---|---|
| keine SEC-Serie (K1.3: Yahoo bleibt, ehrlich etikettiert) | 14.891 |
| Umsatz-Ausrichtung reisst (> 2 %) | 82 |
| weniger als zwei vergleichbare Umsatzjahre (unbelegbar) | 17 |
| Loch in der SEC-Reihe im Fenster | 20 |
| keine Yahoo-Reihe, also kein Fenster | 7 |
| **SEC bevorzugt** | **128** |

Von den 128 bevorzugten Namen aendern **44** tatsaechlich Werte; die uebrigen 84 bestaetigen die
Yahoo-Reihe Zelle fuer Zelle. Alle 128 trugen zuvor `'native'`.

**Die ehrliche Luecke:** 247 Store-Namen haben ueberhaupt eine SEC-Serie, 119 davon fallen durch die
Ausrichtungs-/Lochpruefung. Diese 119 behalten die Yahoo-Reihe mit dem Etikett `'yahoo-adjusted'` —
die Luecke wird benannt, nicht erfunden (K1.3, Mehrheitsauflage gegen R3s NetIncome-Rescue).

---

## 4. Regressionsanker des Urteils

| Anker | Verlangt | Gemessen | |
|---|---|---|---|
| **EGY** neuestes OpInc | −20,607 Mio. | `[-20.607, 136.496, 158.657, 171.276]` statt `[46.617, 136.496, 166.141, 180.143]` | ✅ |
| **EGY** energy-Track (`formulas/energy.js:14`, splitMetric OpInc) | profitable → unprofitable | `smallcap-energy`: **profitable #1 → unprofitable #1**, Score 52,9 → 51,6, Lampe `unprofit` neu | ✅ |
| **HNRG** FY2024 | −218,156 Mio. | `[61.056, **-218.156**, 65.012, 30.430]` statt `[58.567, -0.555, 65.410, 30.430]` | ✅ |

Die Ausrichtung beider Anker ist am Umsatz belegt: EGY `maxRel = 0,0000` ueber 4 Jahre,
HNRG `maxRel = 0,00063` ueber 4 Jahre.

---

## 5. Board-Diff (voller lokaler Re-Score, before/after auf identischem Store)

Methode: byte-genaue Kopie des Stores, `run-screener.js` VOR der Migration, Migration, `run-screener.js`
DANACH. Beide Laeufe teilen jede lokale Eigenheit — die Differenz ist der Aenderung zuzurechnen.

**0 Neuzugaenge · 0 Abgaenge · 1 Track-Flip · 7 Lampen-Wechsel · 112 Rang-/Score-Bewegungen
(davon 49 mit |ΔScore| ≥ 0,05).**

### Track-Flip
| Name | Board | vorher | nachher |
|---|---|---|---|
| **EGY** | `smallcap/smallcap-energy` | profitable #1, Score 52,9 | **unprofitable #1, Score 51,6** |

### Lampen-Wechsel
| Name | vorher | nachher | Lesart |
|---|---|---|---|
| **EGY** | burning, shortRunway | + **unprofit** | GAAP-Verlust wird sichtbar |
| **HNRG** | lowRoic, **peakMargin** | lowRoic | die peakMargin-Lesart stand auf dem Yahoo-Wert −0,555 statt −218,156 |
| **BMBL** | lowRoic, peakMargin | lowRoic, **unprofit** | Track bleibt (Formel splittet nicht ueber OpInc), Lampe stimmt jetzt |
| **MGPI** | — | **unprofit** | die K3-Kipp-Bedingung nennt MGPI namentlich |
| **OSPN** | lowRoic, peakMargin | lowRoic | |
| **SBC** | — | **peakMargin** | |
| **KODK** | lowRoic, **unprofit** | lowRoic | ⚠ siehe Befund unten |

### Groesste Score-Bewegungen
| Name | Board | Score | Rang |
|---|---|---|---|
| SFD | `hypergrowth/full/consumer-staples` | 53,7 → **56,1** (+2,4) | 205 → 188 |
| SBC | `smallcap/smallcap-industrials` | 35,8 → 34,7 (−1,1) | 4 → 4 |
| ELMT | `smallcap/smallcap-industrials` | 56,2 → 56,9 (+0,7) | 1 → 1 |

Alle uebrigen 109 Bewegungen liegen bei |ΔScore| ≤ 0,1 — das sind Kalibrier-Kraeuselungen
(Perzentilbasis verschiebt sich um wenige Namen), keine inhaltlichen Umwertungen.

### ⚠ Ein Befund, der NICHT nachjustiert wurde: KODK
Das eingereichte Filing meldet fuer das neueste Jahr ein Betriebsergebnis von **exakt 0**
(`[0, -7, 4, -26, -46, …]` Mio.), Yahoo meldete −128 Mio. Der Tausch nimmt KODK deshalb die
`unprofit`-Lampe, obwohl der Name auf dem unprofitable-Track bleibt (die NetIncome-Rescue in
`score.js:695` faengt das present-0 ab). Die 0 ist **kein fabrizierter Wert**: `merge-sec-xbrl.js`
`cell()` liefert bei fehlendem Fakt `null`, nie 0 — die 0 steht so im Filing.
Das Urteil lautet GAAP-as-filed; nachjustiert wurde daher nichts. Der Fall ist hier
festgehalten, weil er die einzige Stelle ist, an der die Aenderung eine Warnung **entfernt**.

---

## 6. Wann das datenseitig lebt

Der Schritt haengt im **scoring-Job von `daily-pull.yml`** (Cron `17 2 * * 2-6`, Di–Sa). Er wirkt
**mit dem naechsten planmaessigen daily-pull-Lauf nach dem Merge** — kein manueller Schritt, kein
Warten auf den Monatslauf. Er laeuft ueber beide Stores (`snapshots` aus dem Artefakt,
`snapshots-smallcap` aus dem Cache-Restore), ist idempotent und schreibt nichts in die Caches
oder das Artefakt zurueck.

Der lokale Store (Haupt-Checkout) wurde mit demselben Skript migriert — das ist der A2-Entscheid
aus ENTSCHIED 15: **kein Massen-Re-Pull der 1.859 Namen**, die Etiketten werden lokal abgeleitet.
Nachgeprueft am migrierten Live-Store: Etiketten `yahoo-adjusted` 12.629 · `computed-margin` 1.883 ·
`sec-gaap` 128 · `null` 505, **Restbestand `native` = 0**. EGY traegt `sec-gaap` mit −20,607 Mio. und
der bewahrten Yahoo-Reihe daneben, HNRG FY2024 −218,156 Mio. Ein zweiter Lauf schreibt **0 Dateien**
— die Idempotenz ist am echten Bestand belegt, nicht nur an der Fixture.

*Zensus-Vermerk:* Der Board-Diff in Abschnitt 5 wurde auf einer Kopie mit einer fruehen Fassung des
Skripts gemessen, die noch den Blanket-Filter `f.startsWith('_')` statt des zentralen Praedikats
`isMetadataSnapshot()` benutzte (vom Test-Gate gefunden, im selben Commit geheilt). Betroffen sind
**4 Snapshots** mit Windows-Reservename-Faltung (`_CON.json`-Klasse) — sie bekommen jetzt ebenfalls
ein ehrliches Etikett. Am Board aendert das nichts: die Zahl der SEC-bevorzugten Namen bleibt bei
128, die der Wertaenderungen bei 44.

---

## 7. Wachen

`tests/opinc-source.test.js`, 21 Pruefungen, beidseitig und je einmal absichtlich gebrochen:

* SEC vorhanden + Ausrichtung belegt → `sec-gaap` · **KEINE SEC-Serie → Yahoo bleibt Wert fuer Wert**
* Ausrichtung reisst (> 2 %) → kein Tausch · < 2 Vergleichsjahre → kein Tausch (IREN-Klasse)
* Loch in der SEC-Reihe → kein Tausch · Loch NUR bei Yahoo → der Name gewinnt ein Jahr
* `'native'` stirbt · `computed-margin` bleibt · `computed-margin` + belegte SEC-Serie → `sec-gaap`
* Idempotenz (zweiter Lauf aendert nichts) · Rueckweg (SEC faellt weg → Yahoo kommt zurueck)
* **Anker HNRG −218,156 Mio. und EGY −20,607 Mio. als Literale**, nicht aus den Produktionsdateien
  geladen (sonst pruefte die Wache nur, dass eine Datei sich selbst gleicht)
* `pull-yahoo.js` wird **ausgefuehrt** (`mapYahooToCanonical`), nicht nach Schreibmustern abgesucht

Ein erster Entwurf der `pull-yahoo`-Wache griff per Regex auf `opIncSource = 'native'` und sah den
zurueckgedrehten Ternaer `? 'native' : null` **nicht** — der absichtliche Bruch lief still gruen
durch. Genau dafuer ist der Bruchtest da; die Wache fuehrt den Mapper jetzt aus.

---

## 8. Nicht angefasst

`src/scoring/**`, `tests/scoring/**`, jedes Siegel-/Freeze-/Hash-Manifest, das Ledger, die
committeten SEC-Schichten. Kein Force-Push, keine Loeschung, kein bezahlter Abruf, kein Re-Pull.
Die versiegelten Empfehlungen B1–B4 (K2-Gate, Lampe, K3-Ausnahme) sind **nicht** Teil dieser
Aenderung — sie warten auf Karls gqs00-Freigabe.
