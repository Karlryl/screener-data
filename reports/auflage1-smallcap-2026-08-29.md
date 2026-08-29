# Auflage 1 (T130) — 5.2 Small-Cap-Board, Nachrechnung gegen echte 10-K/10-Q

**Stand:** 2026-08-29 · **Board-Stand:** `outputs/smallcap/` (lokal regeneriert, `calibration.json.generated_at = 2026-08-29T11:22:48.948Z`)
**Messskript:** `scripts/probe-auflage1-messlauf.js` (Wegwerf, nur lesend) · **Messdatei:** Scratchpad `auflage1.json`
**Wortlaut der Auflage** (`protocol/5.2-smallcap-registered-20260721.md:36`): „Stichprobe ≥10 Namen, jede der 7 Achsen gegen echtes 10-Q/10-K nachgerechnet".

---

## AUF EINEN BLICK

**Auflage 1 ist TEILWEISE erfüllt — in der wörtlichen Fassung NICHT.** 26 Namen (>10 ✓) über 11 Sektoren und die volle Score-Spanne 12,4–62,3 wurden gemessen; **alle 7 Achsen gegen echte Filings nachgerechnet werden konnten aber nur bei EINEM Namen (HNRG)** — der einzige Board-Name, für den die Roh-`companyfacts` offline vorliegen. Für die übrigen 25 sind aus der offline verfügbaren SEC-Jahresschicht nur 2 der 7 Achsen bildbar.

- **Die Rechnung stimmt, die Daten wackeln.** Eigene, unabhängig geschriebene Arithmetik reproduziert die Engine auf **182 von 182 Achsen-Zellen bit-identisch**. Kein einziger Rechenfehler in `axes.js`.
- **`annualOpInc` ist die Bruchstelle:** nur **46,5 %** der gegen das Filing prüfbaren OpInc-Jahreswerte decken sich (Umsatz 84,3 %, Bilanz 96–97 %). An HNRG gegen das Roh-10-K bewiesen: der Store trägt für GJ 2024 **−0,56 Mio. $** statt der eingereichten **−218,16 Mio. $** — es fehlt exakt die Wertminderung von 215,14 Mio. $.
- **Eine Board-Konsequenz:** **EGY** steht im `profitable`-Track, weil der Store +46,62 Mio. $ OpInc trägt; das Filing sagt −20,61 Mio. $. `energy.js:splitMetric='OpInc'` → mit dem Filing-Wert wäre EGY im anderen Track.
- **Ein synthetischer Datensatz auf dem Board:** **BTBT** trägt `meta.opIncSource = "computed-margin"` — die gesamte 4-Jahres-OpInc-Reihe ist eine TTM-Marge × Umsatz, kein Filing-Wert. Einziger von 54 Board-Zeilen, und zugleich der einzige der Stichprobe, dessen `capitalEfficiency` aus Yahoo statt SEC rechnet.
- **Auch die Grundwahrheit hat Löcher:** CWCO trägt in der SEC-Schicht einen Teilumsatz (108,95 statt ~180 Mio. $ für GJ 2023); NVEC/IPI/RMR/IIIV haben große Umsatzlücken. Die SEC-Schicht ist kein bedingungsloser Schiedsrichter.

**Sprungkarte:** §1 Auswahlregel · §2 Grundwahrheit + Grenzen · §3 Toleranz · §4 Rechenwahrheit · §5 Datenwahrheit (Eingangsgrößen) · §6 Achsen-Ebene · §7 HNRG-Tiefenanker · §8 Befunde · §9 Urteil · §10 Was zur wörtlichen Erfüllung fehlt · §11 Abgleich mit dem Vorlauf 21.07.

---

## §1 Auswahlregel — vor jedem Blick auf ein Ergebnis fixiert

Die Regel ist rein geometrisch (Board-Position), nicht ergebnisabhängig. Sie steht im Skript als `auswahl()` (`scripts/probe-auflage1-messlauf.js:38-60`) und wurde vor dem ersten Achsenvergleich festgeschrieben:

1. **Population P** = alle Zeilen der 11 aktuellen Small-Cap-Boards, `outputs/smallcap/smallcap-*.json` → `profitable[]` + `unprofitable[]`. **54 Zeilen.**
2. **Eignung E** = Ticker hat einen Eintrag in `external-data/sec-secannual-smallcap.json` (Grundwahrheit überhaupt vorhanden). Reines Datenverfügbarkeits-Kriterium, ausgewertet bevor irgendeine Achse gerechnet wurde. **38 von 54.**
3. **Ziehung S** = je Board (Sektor × Track) mit ≥1 eligiblem Namen: der **bestplatzierte** UND der **schlechtestplatzierte** eligible Name (identisch, wenn nur einer eligible ist). Gezogen wird über den **Rang**, nicht über den Score-Wert.

**Ergebnis: 26 Namen, 11 Sektoren, beide Tracks, Score-Spanne 12,4–62,3.** Kein Namensaustausch, keine Nachziehung.

| Ticker | Sektor | Track | Rang | Ziehung | Score | ROIC-Quelle | SEC-Tiefe (GJ) |
| --- | --- | --- | --- | --- | ---: | --- | ---: |
| NATH | consumer-discretionary | profitable | 1/5 | bester | 60,2 | sec | 15 |
| MCFT | consumer-discretionary | profitable | 5/5 | schlechtester | 38,3 | sec | 10 |
| NATR | consumer-staples | profitable | 3/4 | bester | 44,4 | sec | 15 |
| MGPI | consumer-staples | profitable | 4/4 | schlechtester | 15,8 | sec | 15 |
| EGY | energy | profitable | 1/1 | bester | 52,9 | sec | 15 |
| VALU | financials | profitable | 1/1 | bester | 60,4 | sec | 14 |
| BTBT | financials | unprofitable | 2/2 | bester | 18,1 | **yahoo** | 2 |
| ELMD | health-care | profitable | 2/4 | bester | 61,8 | sec | 14 |
| EBS | health-care | profitable | 4/4 | schlechtester | 27,8 | sec | 15 |
| MASS | health-care | unprofitable | 1/9 | bester | 62,3 | sec | 5 |
| CTKB | health-care | unprofitable | 8/9 | schlechtester | 29,7 | sec | 5 |
| FSTR | industrials | profitable | 1/4 | bester | 61,2 | sec | 15 |
| SBC | industrials | profitable | 4/4 | schlechtester | 35,8 | sec | 4 |
| SERV | industrials | unprofitable | 2/5 | bester | 29,6 | sec | 6 |
| TRC | industrials | unprofitable | 4/5 | schlechtester | 21,8 | sec | 15 |
| IPI | materials | profitable | 1/5 | bester | 61,6 | sec | 16 |
| ALTO | materials | profitable | 5/5 | schlechtester | 12,4 | sec | 15 |
| RMR | real-estate | profitable | 1/2 | bester | 50,6 | sec | 10 |
| AGNT | real-estate | profitable | 2/2 | schlechtester | 49,4 | sec | 14 |
| NVEC | semiconductors | profitable | 1/1 | bester | 50,6 | sec | 15 |
| ALMU | semiconductors | unprofitable | 1/1 | bester | 49,2 | sec | 4 |
| OSPN | software-comm-services | profitable | 3/5 | bester | 52,6 | sec | 15 |
| NCMI | software-comm-services | profitable | 5/5 | schlechtester | 23,0 | sec | 15 |
| IIIV | software-comm-services | unprofitable | 1/2 | bester | 53,4 | sec | 8 |
| CWCO | utilities | profitable | 1/2 | bester | 59,2 | sec | 15 |
| HNRG | utilities | profitable | 2/2 | schlechtester | 40,8 | sec | 15 |

**Die 7 Achsen** (im Code nachgesehen, nicht geraten): `src/scoring/formulas/smallcap/index.js` reicht die HG-Sektorformeln byte-identisch durch (tech-hardware ausgeschlossen). Alle 12 durchgereichten Formeln führen dieselben sieben `axes[].key`: `revGrowthLevel`, `revAcceleration`, `gpGrowth`, `ruleOfX`, `marginTrajectory`, `capitalEfficiency`, `dilution`. `revisionsMomentum` und `marginLevel` kommen in keiner vor. ✓ präreg-konform.

---

## §2 Grundwahrheit — und wo sie endet

| Quelle | Was drin ist | Deckung in der Stichprobe |
| --- | --- | --- |
| `external-data/sec-secannual-smallcap.json` | `annualRev`, `annualOpInc`, `annualNetIncome`, `annualFCF`, `annualOCF`, `annualShares`, `annualAssets`, `annualCurrentLiabilities`, `nfy`, `cik` — aus 10-K/20-F/40-F, `fp='FY'`, nur USD-Einheit | 26/26 Namen |
| `external-data/sec-xbrl/<cik>.json` (Roh-`companyfacts`) | **alles**, inkl. Quartalsframes, `ShareBasedCompensation`, `CostOfGoodsAndServicesSold` | **1/26** (HNRG, CIK 0000788965) |
| `external-data/sec-annual-bulk.jsonl` | wie oben + `annualGP`, `_fys`, `annualFiled` | **0/26** (deckt nur den $800M+-Korpus) |

**Die harte Grenze:** `merge-sec-xbrl.js:24-28` deklariert wörtlich „SCOPE (2026-07-02): NUR ANNUAL" — es gibt in diesem Repo **keine SEC-Quartalsschicht**. Die Jahresschicht führt zusätzlich **kein `GrossProfit`** und **kein `ShareBasedCompensation`** (`scripts/build-secannual-smallcap.js:119-125` schreibt nur die acht oben genannten Felder). Daraus folgt zwingend:

| Achse | Aus der SEC-Jahresschicht bildbar? | Grund |
| --- | --- | --- |
| `revGrowthLevel` | **nein** (Achsenwert) | Engine nutzt bei **allen 26** Namen den Quartals-Zweig (`revQuartalsYoY ≠ null`); die Jahresschicht hat keine Quartale. Der Jahres-Zweig ist prüfbar, wird aber nicht benutzt. |
| `revAcceleration` | **ja** | Engine fällt bei 5 Quartalen auf die Jahresreihe zurück (`axes.js:211-217`) — verifiziert: eigene Jahres-Fallback-Rechnung reproduziert die Engine bei 26/26. |
| `gpGrowth` | **nein** | kein `GrossProfit` in der Schicht |
| `ruleOfX` | **nein** (Achsenwert) | Wachstums-Bein = `revGrowthLevel` (s. o.); FCF-Bein = `metrics.fcfMarginTTM`, eine TTM-Größe ohne Entsprechung in Jahresdaten |
| `marginTrajectory` | **nein** | quartalsweise (`opIncQ/revenueQ`) |
| `capitalEfficiency` | **ja** | `annualOpInc` + `annualAssets` + `annualCurrentLiabilities` + `annualRev` — alle vier in der Schicht |
| `dilution` | **nein** | kein `ShareBasedCompensation` in der Schicht |

**Das ist die ehrliche Lücke, nicht ein Messversäumnis.** Sie wird nicht geraten, nicht approximiert und nicht durch eine „nächstbeste" Größe ersetzt.

### Perioden-Zuordnung (getestet, nicht angenommen)

Die Store-Jahresreihen tragen **keine Geschäftsjahres-Stempel** (`annual.annualRev` ist `[{value:…}]` ohne `end`). Die Zuordnung Store-Index *i* ↔ SEC-Index *i* ↔ GJ `nfy−i` ist deshalb eine Annahme — sie wurde **geprüft**: für jeden Namen wurde die Umsatzreihe mit Versatz −2…+2 gegen die SEC-Reihe gelegt und der Versatz mit der kleinsten Median-Abweichung gewählt.
**Ergebnis: Versatz 0 gewinnt bei **22 von 26** Namen; bei **19** davon ist die Median-Abweichung exakt **0,000 %** (Store- und SEC-Umsatzreihe sind dort Wert für Wert identisch), bei MCFT/AGNT/HNRG gewinnt Versatz 0 mit 9,36 / 0,17 / 0,06 %.** Ausnahmen: EBS (−1 minimal besser, 2,55 % vs. 3,99 %), CWCO (−1, 13,6 % vs. 16,9 %), IIIV (+2), NVEC (kein Überlapp bei Versatz 0, weil die SEC-Umsatzreihe für die vier jüngsten Jahre leer ist). Alle vier sind in §5/§8 als Perioden-/Lückenfälle eingeordnet — keiner davon kippt die Zuordnung für die restlichen 22.

**Zusatzbefund zur Periode:** alle Store-Snapshots tragen `metrics.*.asOf = 2026-07-22`, das Board wurde am **2026-08-29** erzeugt. Der Skalar-Teil des Stores (u. a. `fcfMarginTTM` im `ruleOfX`) ist damit **38 Tage alt** gegenüber dem Board-Stempel.

---

## §3 Toleranz — vor der Messung festgelegt, mit Begründung

| Ebene | Schwelle | Begründung |
| --- | --- | --- |
| **Eingangsgröße** (ein gemeldeter USD-Betrag) | Treffer wenn \|rel\| ≤ **0,5 %** ODER \|abs\| ≤ **50 000 $** | Emittenten runden auf Tausender, Yahoo rundet nach; die kleinste Kohorte im Sample hat n=1–2, die größte n=12 — eine 0,5-%-Verschiebung einer Eingangsgröße kann in keiner davon einen Mid-Rank-Perzentil verschieben. Der Absolut-Zweig fängt Near-Zero-Nenner (SERV: Umsatz 207 545 $). |
| **Achsenwert** (dimensionslos: `revAcceleration`, `gpGrowth`, `marginTrajectory`, `capitalEfficiency`, `dilution`) | Treffer wenn \|rel\| ≤ **1 %** ODER \|abs\| ≤ **0,005** | Wachstums- und Margen-Achsen sind Differenzen fast gleich großer Größen → Fehlerverstärkung. Das Board rundet Perzentile auf 0,1 (`score.js:1367 round1`); 0,005 auf dem Rohwert liegt weit unterhalb der Auflösung, bei der ein Kohortenrang kippt. |
| **Achsenwert in %** (`revGrowthLevel`, `ruleOfX`) | Treffer wenn \|rel\| ≤ **1 %** ODER \|abs\| ≤ **0,5 Prozentpunkte** | dieselbe Logik, auf der ×100-Skala der beiden Achsen. |
| **Währung** | **keine Toleranz nötig** | `smallcapRoute()` erzwingt `isUS(s)`, und `merge-sec-xbrl.js:163-166` liest ausschließlich die `units.USD`-Sektion. FX ist strukturell ausgeschlossen, nicht wegtoleriert. |
| **Periode** | Versatz-Test −2…+2, s. §2 | Eine Abweichung, die bei Versatz ±1 verschwindet, ist Perioden-Versatz, kein Defekt. |

---

## §4 Ebene A vs. B — rechnet die Engine, was sie behauptet?

Für jede der 7 Achsen wurde die Rechenvorschrift **aus den Kommentaren in `axes.js` neu implementiert** (`scripts/probe-auflage1-messlauf.js:78-150`, eigene Funktionen `eigenRevAnnualYoY`, `eigenRevAccelAnnual`, `eigenGpGrowth`, `eigenDilution`, `eigenMarginTrajectory`, `eigenCapEff`) und gegen `score.rawAxisValue()` gestellt — mit den **eingefrorenen Linealen des tatsächlichen Laufs** (`outputs/smallcap/calibration.json` → `winsorBounds = {opMargin:[−180.251…,1], qoq:[−0.798…,4.398…]}`, `growthBounds = [−0.5578…, 10.2339…]`).

> **Ergebnis: 182 von 182 Zellen identisch (Abweichung < 1e−9 relativ).**
> Kontrollanker: `axisBreakdown`-Träger `revGrowthYoYPct` aus den Board-Dateien stimmt bei **26/26** exakt mit dem rekonstruierten Achsenwert überein — die Rekonstruktion ist beweisbar derselbe Pfad, den das Board gelaufen ist.

Eine erste Fassung dieses Vergleichs zeigte 18 `ruleOfX`-Abweichungen — Ursache war **mein** Lesefehler (`metrics.*` sind `{value,source,asOf}`-Objekte, nicht nackte Zahlen, `snapshot.js:287-290`), nicht die Engine. Nach der Korrektur: 0 Abweichungen. Der Fall ist hier notiert, weil ein stillschweigend korrigierter Messfehler den Befund unlesbar machen würde.

**Zwischenurteil: `axes.js` rechnet fehlerfrei. Alles, was folgt, ist ein Daten-, kein Codebefund.**

---

## §5 Ebene C — Datenwahrheit: Store gegen Filing

Verglichen wurde je Name und je der 4 jüngsten Geschäftsjahre:
`snapshots-smallcap/<TICKER>.json → annual.annualRev[i].value` gegen `external-data/sec-secannual-smallcap.json → <TICKER>.annualRev[i].value` (analog `annualOpInc`, `annual.annualBalance[i].totalAssets` ↔ `annualAssets`, `.currentLiabilities` ↔ `annualCurrentLiabilities`).

| Eingangsgröße | Treffer | Abweichung | kein SEC-Wert | Trefferquote der vergleichbaren Zellen |
| --- | ---: | ---: | ---: | ---: |
| `annualRev` | 70 | 13 | 21 | **84,3 %** |
| `annualOpInc` | 47 | **54** | 3 | **46,5 %** |
| `totalAssets` | 99 | 3 | 2 | **97,1 %** |
| `currentLiabilities` | 98 | 4 | 2 | **96,1 %** |
| **Summe** | **314** | **74** | **28** | **80,9 %** |

**Die Bilanz ist sauber, die GuV nicht.** Assets und kurzfristige Verbindlichkeiten decken sich zu 96–97 % mit den Filings. Der Umsatz zu 84 %. Das Betriebsergebnis zu **weniger als der Hälfte**.

### Abweichungen je Name (die größte OpInc-Abweichung je Zeile)

| Ticker | Rev T/A/o | OpInc T/A/o | Assets | CurLiab | größte OpInc-Abweichung (GJ-Index) |
| --- | --- | --- | --- | --- | --- |
| NATH | 4/0/0 | 4/0/0 | 4/0/0 | 4/0/0 | — |
| MCFT | 1/3/0 | 1/3/0 | 4/0/0 | 4/0/0 | i1: Store 27,48 M vs. SEC 7,63 M (+260,0 %) |
| NATR | 4/0/0 | 4/0/0 | 4/0/0 | 4/0/0 | — |
| MGPI | 4/0/0 | 1/3/0 | 4/0/0 | 4/0/0 | **i0: Store +83,51 M vs. SEC −94,61 M** |
| EGY | 4/0/0 | 1/3/0 | 4/0/0 | 4/0/0 | **i0: Store +46,62 M vs. SEC −20,61 M** |
| VALU | 4/0/0 | 4/0/0 | 4/0/0 | 4/0/0 | — |
| BTBT | 2/0/2 | 0/2/2 | 2/0/2 | 2/0/2 | i1: Store −562,18 M vs. SEC +27,56 M |
| ELMD | 4/0/0 | 4/0/0 | 4/0/0 | 4/0/0 | — |
| EBS | 0/4/0 | 0/4/0 | 4/0/0 | 4/0/0 | i2: Store −201,50 M vs. SEC −726,40 M |
| MASS | 3/1/0 | 2/2/0 | 4/0/0 | 4/0/0 | i1: Store −29,95 M vs. SEC −76,72 M |
| CTKB | 4/0/0 | 4/0/0 | 4/0/0 | 4/0/0 | — |
| FSTR | 4/0/0 | 1/3/0 | 4/0/0 | 3/1/0 | i3: Store +0,81 M vs. SEC −7,21 M |
| SBC | 2/0/2 | 1/3/0 | 2/2/0 | 2/2/0 | i2: Store +71,07 M vs. SEC −1,77 M |
| SERV | 3/0/1 | 2/2/0 | 3/1/0 | 3/1/0 | i3: Store −20,95 M vs. SEC −0,05 M |
| TRC | 2/0/2 | 4/0/0 | 4/0/0 | 4/0/0 | — |
| IPI | 1/0/3 | 0/4/0 | 4/0/0 | 4/0/0 | i2: Store +0,13 M vs. SEC −43,97 M |
| ALTO | 3/0/1 | 0/4/0 | 4/0/0 | 4/0/0 | i0: Store +15,21 M vs. SEC +7,36 M (+106,5 %) |
| RMR | 2/0/2 | 0/4/0 | 4/0/0 | 4/0/0 | i1: Store 59,03 M vs. SEC 44,98 M (+31,2 %) |
| AGNT | 4/0/0 | 1/3/0 | 4/0/0 | 4/0/0 | i1: Store +19,94 M vs. SEC −18,99 M |
| NVEC | 0/0/4 | 4/0/0 | 4/0/0 | 4/0/0 | — |
| ALMU | 3/0/1 | 3/0/1 | 4/0/0 | 4/0/0 | — |
| OSPN | 4/0/0 | 0/4/0 | 4/0/0 | 4/0/0 | i2: Store −11,56 M vs. SEC −28,87 M (+60,0 %) |
| NCMI | 4/0/0 | 3/1/0 | 4/0/0 | 4/0/0 | i3: Store 12,70 M vs. SEC 6,90 M (+84,1 %) |
| IIIV | 0/2/2 | 0/4/0 | 4/0/0 | 4/0/0 | i2: Store 5,57 M vs. SEC 22,71 M (−75,5 %) |
| CWCO | 0/3/1 | 2/2/0 | 4/0/0 | 4/0/0 | i1: Store 18,09 M vs. SEC 18,28 M (−1,1 %) |
| HNRG | 4/0/0 | 1/3/0 | 4/0/0 | 4/0/0 | **i1: Store −0,56 M vs. SEC −218,16 M** |

*(T/A/o = Treffer / Abweichung / ohne SEC-Wert, über die 4 jüngsten GJ)*

---

## §6 Achsen-Ebene — Urteil je Zelle

**26 Namen × 7 Achsen = 182 Zellen.**

| Urteil | Zellen | Anteil |
| --- | ---: | ---: |
| **verifiziert** (Achse aus echten Filings nachgerechnet, innerhalb Toleranz) | **32** | 17,6 % |
| **Abweichung** (nachgerechnet, außerhalb Toleranz) | **21** | 11,5 % |
| **nicht querverifizierbar** (Grundwahrheit liefert die Eingangsgröße nicht) | **124** | 68,1 % |
| **Achse gedroppt** (`renorm-on-drop`, es gibt nichts nachzurechnen) | **5** | 2,7 % |

Die 5 gedroppten: `dilution` bei VALU/SBC/RMR (kein `annualSBC` im Store), `gpGrowth` bei BTBT/SERV (`annualGP` durchgängig 0 bzw. leer). Diese Namen tragen im Board korrekt `coverageAxes: "6/7"`.

Die 124 nicht querverifizierbaren Zellen verteilen sich auf `gpGrowth`, `dilution`, `marginTrajectory` (je Achse strukturell, §2) sowie `revGrowthLevel`/`ruleOfX` (Quartals-Zweig).

### 6a `revAcceleration` — Engine gegen SEC-Jahresreihe

| Ticker | Engine | SEC | abs | rel % | Urteil / Ursache |
| --- | ---: | ---: | ---: | ---: | --- |
| NATH | 0,0246183 | 0,0246183 | 0 | 0,0 | ✅ exakt |
| MCFT | 0,353129 | 0,221546 | +0,131583 | +59,4 | ⚠️ Restatement (aufgegebener Geschäftsbereich; Store führt fortgeführte Umsätze, SEC-Schicht die ursprünglich eingereichten) |
| NATR | 0,0364297 | 0,0364297 | 0 | 0,0 | ✅ exakt |
| MGPI | −0,0788281 | −0,0788281 | 0 | 0,0 | ✅ exakt |
| EGY | −0,302503 | −0,302503 | 0 | 0,0 | ✅ exakt |
| VALU | −0,00861147 | −0,00861147 | 0 | 0,0 | ✅ exakt |
| BTBT | −1,35462 | — | — | — | ⬜ SEC-Tiefe 2 GJ < 3 nötig |
| ELMD | 0,0313484 | 0,0313484 | 0 | 0,0 | ✅ exakt |
| EBS | −0,295073 | −0,282705 | −0,0123684 | −4,4 | ⚠️ Restatement (Umsatz weicht in allen 4 GJ um 2,5–5,1 % ab) |
| MASS | 0,226433 | −0,24477 | +0,471203 | +192,5 | ⚠️ Restatement GJ 2024 (Store 47,75 M vs. SEC 59,63 M) |
| CTKB | −0,0333476 | −0,0333476 | 0 | 0,0 | ✅ exakt |
| FSTR | 0,0412861 | 0,0412861 | 0 | 0,0 | ✅ exakt |
| SBC | −0,216194 | — | — | — | ⬜ SEC-Umsatz nur 2 GJ |
| SERV | −3,93648 | −3,93606 | −0,000417 | −0,0 | ✅ Rundung |
| TRC | 0,247722 | 0,0767352 | +0,170986 | +222,8 | ⚠️ SEC-Lücke: nur 2 der 4 jüngsten GJ vorhanden → Kompaktierung zieht GJ *nfy−5* als drittes Jahr |
| IPI | 0,258709 | — | — | — | ⬜ SEC-Umsatz nur 1 GJ |
| ALTO | 0,161672 | 0,161672 | 0 | 0,0 | ✅ exakt |
| RMR | −0,152601 | −0,215036 | +0,0624349 | +29,0 | ⚠️ SEC-Lücke (GJ 0+1 fehlen) |
| AGNT | −0,0239544 | −0,022136 | −0,00181841 | −8,2 | ✅ innerhalb Toleranz (abs 0,0018 < 0,005) |
| NVEC | 0,149487 | 0,422277 | −0,27279 | −64,6 | ⚠️ SEC-Umsatzreihe für die 4 jüngsten GJ komplett leer |
| ALMU | 0,322861 | 0,327632 | −0,00477154 | −1,5 | ✅ innerhalb Toleranz (abs 0,0048 < 0,005) |
| OSPN | −0,0343336 | −0,0343336 | 0 | 0,0 | ✅ exakt |
| NCMI | −0,44766 | −0,44766 | 0 | 0,0 | ✅ exakt |
| IIIV | 0,10648 | −0,95241 | +1,05889 | +111,2 | ⚠️ Restatement + SEC-Lücke (SEC 370,24 M vs. Store 189,68 M für GJ *nfy−2*) |
| CWCO | 0,242481 | 0,0586097 | +0,183871 | +313,7 | ⚠️ **SEC-Schicht defekt** (Teilumsatz, s. §8.3) |
| HNRG | 0,524994 | 0,523549 | +0,00144473 | +0,3 | ✅ innerhalb Toleranz (as-filed vs. restated Umsatz GJ 2024: 404,39 vs. 404,16 M) |

**15 verifiziert · 8 Abweichung (alle mit benannter Ursache) · 3 nicht bildbar.**
Bemerkenswert: **keine einzige** der 8 Abweichungen geht auf einen Rechenfehler zurück — 6 auf Restatements/Perioden, 2 auf Löcher bzw. einen Defekt in der SEC-Schicht selbst.

### 6b `capitalEfficiency` — Engine gegen reine SEC-Rechnung

Wichtige Vorbemerkung: `roicStabilitySource()` (`axes.js:496-512`) **bevorzugt bereits SEC**, sobald das Trio OpInc/Assets/CurrLiab tief genug ist — bei **25 von 26** Namen greift das (`_source = 'sec'`). Für diese Namen ist der ROIC-Kern per Konstruktion filing-basiert; die Restabweichung stammt ausschließlich aus den bewusst Yahoo-basierten Zusatztermen (Asset-Growth-Penalty auf `annualRev`, `cycleDiscount` auf Yahoo-OpInc/Rev, `axes.js:359-400`). **BTBT ist der einzige echte Quervergleich Yahoo↔SEC.**

| Ticker | Quelle | Engine | SEC-pur | abs | rel % | Urteil |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| NATH | sec | 0,46553 | 0,46553 | 0 | 0,0 | ✅ |
| MCFT | sec | 0,249321 | 0,207099 | +0,0422 | +20,4 | ⚠️ Yahoo-Umsatz (Restatement) im Penalty-Term |
| NATR | sec | 0,089093 | 0,0953025 | −0,00621 | −6,5 | ⚠️ knapp außerhalb (abs 0,0062 > 0,005) |
| MGPI | sec | −0,0253067 | −0,0253067 | 0 | 0,0 | ✅ |
| EGY | sec | −0,0538866 | −0,0538866 | 0 | 0,0 | ✅ |
| VALU | sec | −0,0494742 | −0,0550219 | +0,00555 | +10,1 | ⚠️ knapp außerhalb |
| **BTBT** | **yahoo** | **−1,98524** | **−1,17201** | **−0,813** | **−69,4** | ❌ **synthetische OpInc-Reihe, s. §8.2** |
| ELMD | sec | 0,0951502 | 0,0787972 | +0,0164 | +20,8 | ⚠️ Yahoo-Terme |
| EBS | sec | −0,224424 | −0,208299 | −0,0161 | −7,7 | ⚠️ Yahoo-Terme (Restatement) |
| MASS | sec | −0,244957 | −0,479544 | +0,2346 | +48,9 | ⚠️ Yahoo-Terme (Restatement) |
| CTKB | sec | −0,0377833 | −0,0377833 | 0 | 0,0 | ✅ |
| FSTR | sec | 0,0475592 | 0,062976 | −0,0154 | −24,5 | ⚠️ Yahoo-OpInc im `cycleDiscount` |
| SBC | sec | −0,3806 | −0,321807 | −0,0588 | −18,3 | ⚠️ Yahoo-OpInc (2 Vorzeichen-Divergenzen) |
| SERV | sec | −1,48211 | −1,48169 | −0,000417 | −0,0 | ✅ |
| TRC | sec | −0,000903372 | −0,000903372 | 0 | 0,0 | ✅ |
| IPI | sec | 0,00737689 | 0,00737689 | 0 | 0,0 | ✅ |
| ALTO | sec | −0,0417101 | −0,0417101 | 0 | 0,0 | ✅ |
| RMR | sec | −0,00431221 | 0,240866 | −0,2452 | −101,8 | ⚠️ SEC-Umsatzlücke → Penalty/Discount unterschiedlich bestückt |
| AGNT | sec | −0,137611 | −0,137611 | 0 | 0,0 | ✅ |
| NVEC | sec | 0,20647 | 0,20647 | 0 | 0,0 | ✅ |
| ALMU | sec | −0,431243 | −0,431243 | 0 | 0,0 | ✅ |
| OSPN | sec | −0,16552 | −0,156849 | −0,00867 | −5,5 | ⚠️ knapp außerhalb |
| NCMI | sec | 0,119198 | 0,119198 | 0 | 0,0 | ✅ |
| IIIV | sec | 0,0119315 | 0,0144844 | −0,00255 | −17,6 | ✅ innerhalb Toleranz (abs 0,0026 < 0,005) |
| CWCO | sec | −0,0131508 | 0,0533171 | −0,0665 | −124,7 | ⚠️ **SEC-Schicht defekt** (Teilumsatz) |
| HNRG | sec | −0,0171948 | −0,0171948 | 0 | 0,0 | ✅ |

**14 verifiziert · 12 Abweichung.** Von den 12 gehen **11 auf die bewusst Yahoo-basierten Zusatzterme oder auf Lücken/Defekte der SEC-Schicht** zurück; **1 (BTBT) ist ein echter Datendefekt** (§8.2).

---

## §7 HNRG-Tiefenanker — alle 7 Achsen gegen echte 10-K/10-Q

HNRG (Hallador Energy, CIK 0000788965) ist der **einzige** Board-Name mit lokal vorhandenen Roh-`companyfacts` (`external-data/sec-xbrl/0000788965.json`). Für ihn wurden alle Reihen **direkt aus den eingereichten Zahlen** neu gebaut — eigene Extraktion (`fyMap`, `qSeries`, `qSeriesRev`, `q4Aus10K` im Messskript), unabhängig von `merge-sec-xbrl.js`: Jahreswerte aus `form ∈ {10-K,20-F,40-F} ∧ fp='FY'`, Quartale aus allen Frames mit 80–100 Tagen Laufzeit, fehlendes Q4 aus dem 10-K rekonstruiert (`FY − Q1 − Q2 − Q3`).

### Eingangsgrößen: Store gegen 10-K/10-Q

| Größe | GJ/Quartal | 10-K/10-Q | Store | Abw. |
| --- | --- | ---: | ---: | ---: |
| Umsatz | FY2025 | 469,47 M | 469,47 M | **0,00 %** |
| Umsatz | FY2024 | 404,39 M (as-filed) / 404,16 M (restated FY2025-10-K) | 404,16 M | **0,00 %** ggü. restated |
| Umsatz | FY2023 | 634,48 M | 634,88 M | +0,06 % |
| Umsatz | FY2022 | 361,99 M | 361,99 M | **0,00 %** |
| `totalAssets` | FY2025–22 | 408,05 / 369,12 / 589,78 / 630,55 M | identisch | **0,00 %** |
| `currentLiabilities` | FY2025–22 | 152,60 / 152,90 / 157,59 / 239,60 M | identisch | **0,00 %** |
| `SBC` | FY2025–22 | 3,53 / 4,45 / 3,55 / 1,27 M | identisch | **0,00 %** |
| Umsatz Q | 2026-03-31 | 101,81 M | 101,81 M | **0,00 %** |
| Umsatz Q | 2025-12-31 (aus 10-K) | 102,01 M | 101,94 M | −0,07 % |
| Umsatz Q | 2025-09-30 / 06-30 / 03-31 | 146,85 / 102,89 / 117,72 M | identisch | **0,00 %** |
| OpInc Q | 2026-03-31 | −5,65 M | −5,85 M | +3,5 % |
| OpInc Q | 2025-12-31 (aus 10-K) | 6,25 M | 6,11 M | −2,2 % |
| OpInc Q | 2025-09-30 | 29,06 M | 26,73 M | **−8,0 %** |
| OpInc Q | 2025-06-30 / 03-31 | 11,87 / 13,88 M | 11,81 / 13,85 M | −0,5 % / −0,2 % |
| **OpInc FY2024** | 2024 | **−218,16 M** | **−0,56 M** | **+99,7 %** ❌ |
| `GrossProfit` FY2022 | 2022 | 95,38 M (= 361,99 − 266,61 COGS) | 95,38 M | **0,00 %** |
| `GrossProfit` FY2023 | 2023 | 161,09 M (= 634,48 − 473,39 COGS) | 331,63 M | **+105,9 %** ❌ |

### Achsenwerte

| Achse | Engine (`score.rawAxisValue`) | aus 10-K/10-Q | abs | rel % | Urteil |
| --- | ---: | ---: | ---: | ---: | --- |
| `revGrowthLevel` | −13,52061 | −13,52061 | 0 | **0,00** | ✅ **exakt** (Quartals-YoY 101,81 / 117,72 direkt aus den 10-Q) |
| `revAcceleration` | 0,5249942 | 0,5235495 | +0,001445 | +0,28 | ✅ (as-filed vs. restated Umsatz) |
| `gpGrowth` | 0,4132854 | **nicht bildbar** | — | — | ❌ s. u. |
| `ruleOfX` | −22,16098 | −24,33709 | +2,176 | +8,94 | ◐ Wachstums-Bein exakt (α=1,8 × −13,52061 = −24,33709); Differenz = **genau** der FCF-TTM-Term (+2,176 pp), aus Jahresdaten nicht bildbar |
| `marginTrajectory` | −0,1751633 | −0,1733674 | −0,001796 | −1,04 | ✅ innerhalb Toleranz (abs 0,0018 < 0,005) |
| `capitalEfficiency` | −0,01719482 | −0,01719482 | 0 | **0,00** | ✅ **exakt** |
| `dilution` | −0,01152849 | −0,01152849 | 0 | **0,00** | ✅ **exakt** |

**HNRG: 5 ✅ · 1 ❌ · 1 ◐.**

**Der `gpGrowth`-Befund im Detail.** Hallador taggt kein `GrossProfit`. Der Bruttogewinn ist aus dem 10-K nur über `Revenues − CostOfGoodsAndServicesSold` rekonstruierbar — und nur bis FY2023, danach taggt der Emittent stattdessen Kostenkomponenten (`FuelCosts`, `LaborAndRelatedExpense`, `UtilitiesOperatingExpenseMaintenanceAndOperations`). Der Vergleich, der möglich ist:

- **FY2022:** Filing 95,38 M = Store 95,38 M → **exakt** (Bruttomarge 26,3 %).
- **FY2023:** Filing 161,09 M vs. Store 331,63 M → **Faktor 2,06** (Bruttomarge 25,4 % vs. 52,2 %).
  Gegenprobe aus dem Filing: `Revenues 634,48 − CostsAndExpenses 569,47 = OperatingIncomeLoss 65,01` — die 473,39 M COGS passen in diese Identität; die vom Store implizierten 303,25 M Umsatzkosten passen in keine.

Der Engine-Wert `gpGrowth = 0,41329` setzt sich zusammen aus `gpYoY = +0,1326` und `gmTraj = 0,5442 − 0,2635 = +0,2807`. **Über zwei Drittel der Achse stammen aus einem Bruttomargen-Sprung von 26 % auf 52 %, der genau zwischen FY2022 (filing-exakt) und FY2023 (filing-unvereinbar) liegt.** Für einen Kohleproduzenten ist eine Bruttomarge von 52 % nicht plausibel; das Filing sagt für beide Jahre ≈ 26 %, also eine flache Trajektorie. Diese Abweichung bleibt **nicht abschließend erklärt** — sie ist damit ein Befund, kein Erklärter-Versatz.

---

## §8 Befunde

### 8.1 `annualOpInc` ist die Bruchstelle des Stores — bewiesen ❌
Nur **46,5 %** der prüfbaren OpInc-Jahreswerte decken sich mit den Filings (Umsatz 84,3 %, Bilanz 96–97 %). An HNRG **gegen die Roh-Filing-Daten bewiesen**, nicht vermutet:
`facts["us-gaap"].Revenues` FY2024 = 404,39 M; `CostsAndExpenses` = 622,55 M; `OperatingIncomeLoss` = **−218,16 M** (accn `0001558370-25-003141`, filed 2025-03-17); darin `ImpairmentOfLongLivedAssetsHeldForUse` = 215,14 M; `NetIncomeLoss` = −226,14 M. Der Store trägt **−0,56 M**. Die Differenz ist der Größe nach exakt die Wertminderung.
**Muster:** die Abweichung tritt systematisch in Geschäftsjahren mit großen Wertminderungen/Sonderposten auf (MGPI, EGY, EBS, AGNT, IPI, BMBL). Ob Yahoo dort durchgängig „vor Sonderposten" ausweist, ist mit den vorhandenen Offline-Daten **nicht für jeden Namen belegbar** — bewiesen ist es für HNRG.

### 8.2 BTBT trägt eine **synthetische** OpInc-Reihe ❌
`snapshots-smallcap/BTBT.json → meta.opIncSource = "computed-margin"`. Die Reihe lautet
`[−590 848 666,944 · −562 182 493,624 · −233 696 378,584 · −168 037 542,941]`
und ist Zeile für Zeile `annualRev[i] × (−5,2028)` — **eine einzige TTM-Betriebsmarge, auf vier Umsatzjahre multipliziert**. Zusätzlich ist `annual.annualGP = [0,0,0,0]` (die `gpGrowth`-Achse droppt korrekt).
**Reichweite:** von 101 gescannten Snapshot-Dateien in `snapshots-smallcap/` tragen **24** `computed-margin` und **27** ein durchgängig genulltes `annualGP` (19 beides) — davon steht aber **nur BTBT** auf einem Board (die übrigen fliegen als `balance-sheet-bank`/`insurer` raus). BTBT ist zugleich der **einzige** Name der Stichprobe, dessen `capitalEfficiency` aus Yahoo statt SEC rechnet (`roicStabilitySource._source = 'yahoo'`, weil die SEC-Tiefe 2 GJ < Yahoo-Tiefe 4 GJ ist) — der synthetische Wert geht damit **ungefiltert** in die Achse: −1,98524 statt −1,17201 aus den Filings (−69,4 %).
Betroffene Board-Zeile: `outputs/smallcap/smallcap-financials.json → unprofitable[1]`, Score 18,1.

### 8.3 Die Grundwahrheit selbst hat Defekte ⚠️
- **CWCO:** `sec-secannual-smallcap.json → CWCO.annualRev` = 127,24 / 114,59 / 108,95 M, während `annualOpInc` mit dem Store auf ±1,1 % übereinstimmt (18,36 vs. 18,26 / 18,28 vs. 18,09 / 37,17 vs. 37,17 M). Ein Umsatz von 108,95 M bei einem Betriebsergebnis von 37,17 M ergibt eine Betriebsmarge von 34 % für einen Wasserversorger — der Store-Wert (180,21 M → 20,6 %) ist der plausible. Das ist genau das in `merge-sec-xbrl.js:69-73` beschriebene Risiko: **ein Umsatz-BESTANDTEIL in der Rolle der Gesamtgröße.** In beiden von CWCO betroffenen Achsen (`revAcceleration` +313,7 %, `capitalEfficiency` −124,7 %) ist deshalb **die SEC-Spalte die unzuverlässige**, nicht die Engine.
- **Umsatzlücken:** NVEC (4 jüngste GJ leer), IPI (3 von 4 leer), RMR (2 von 4), TRC (2 von 4), SBC (2 von 4), IIIV (2 von 4). 21 der 104 Umsatzzellen haben schlicht keinen SEC-Wert.

### 8.4 Track-Konsequenz: EGY steht möglicherweise im falschen Track ⚠️
Über **alle 38** eligible Board-Zeilen geprüft: 3 Vorzeichen-Divergenzen im jüngsten OpInc-Jahr.

| Ticker | Sektor | `splitMetric` | Track heute | Store | SEC |
| --- | --- | --- | --- | ---: | ---: |
| MGPI | consumer-staples | `none` | profitable | +83,51 M | −94,61 M |
| **EGY** | energy | **`OpInc`** | **profitable** | **+46,62 M** | **−20,61 M** |
| BMBL | software-comm-services | `FCF` | profitable | +240,48 M | −805,78 M |

Nur bei EGY entscheidet `annualOpInc[0]` über den Track (`formulas/energy.js:14 splitMetric:'OpInc'` → `score.js:688-707 signTrack`). Mit dem Filing-Wert wäre EGY `unprofitable` — anderer Kohorten-Vergleich, andere Achsengewichte. EGY hält heute `smallcap-energy → profitable[0]`, Score 52,9, **Kohortengröße 1**. Nicht abschließend adjudizierbar: für EGY liegen die Roh-`companyfacts` offline nicht vor.

### 8.5 Latent: `revAcceleration` kompaktiert Lücken ⚠️
`axes.js:212` — `const ar = norm(s,'annualRev').filter(v => v !== null && v !== undefined && v > 0)` — entfernt Lücken **vor** der Index-Paarung und bildet dann `ar[0]/ar[1]` und `ar[1]/ar[2]`. Das ist exakt das Muster, das BH-079 (`adjacentTwoPresent`) und BH-080 (`quarterQoQRates`) an allen anderen Stellen beseitigt haben: bei einer Lücke wird eine **Mehrjahres**-Rate als Ein-Jahres-Wachstum verrechnet.
**Heute ohne Schaden:** keiner der 26 Store-Namen hat eine Lücke in den ersten drei `annualRev`-Positionen (nachgezählt; die einzigen Lücken in der Stichprobe sind ALMU `annualRev[3]`, VALU/SBC/RMR `annualSBC`). Der Befund ist deshalb **latent**, nicht live — er wird scharf, sobald ein Name mit Innenlücke geroutet wird. Genau dieser Effekt hat übrigens in der SEC-Spalte für TRC/NVEC/RMR die großen Abweichungen erzeugt.

### 8.6 Aktualitäts-Versatz ⚠️
`snapshots-smallcap/*.json → metrics.*.asOf = 2026-07-22`, Board-Lineal `outputs/smallcap/calibration.json → generated_at = 2026-08-29T11:22:48.948Z`. Der Skalar-Teil des Stores (u. a. `fcfMarginTTM`, das FCF-Bein von `ruleOfX`) ist **38 Tage** älter als der Board-Stempel. Kein Defekt, aber eine Periodengrenze, die bei jeder künftigen Nachrechnung mitzuführen ist.

### 8.7 Positiv: die Rechnung ist sauber ✅
- 182/182 Achsen-Zellen reproduzieren unabhängig geschriebene Arithmetik bit-identisch (§4).
- Bilanzdaten decken sich zu 96–97 % mit den Filings (§5).
- `capitalEfficiency` ist bei 25/26 Namen bereits filing-nativ — die einzige der sieben Achsen, deren Kern per Konstruktion aus 10-K-Zahlen kommt.
- HNRG reproduziert `revGrowthLevel`, `capitalEfficiency` und `dilution` **auf die letzte Stelle** aus den eingereichten Zahlen.

---

## §9 Urteil zu Auflage 1

> ## **TEILWEISE ERFÜLLT — in der wörtlichen Fassung NICHT ERFÜLLT.**

**Erfüllt:**
- „Stichprobe ≥10 Namen" ✅ — 26 Namen, outcome-blind nach einer vorab fixierten Rang-Regel gezogen, 11 Sektoren, beide Tracks, Score 12,4–62,3.
- „nachgerechnet" im Sinne der Rechenprüfung ✅ — 182/182 Zellen, plus Board-Anker 26/26.

**Nicht erfüllt:**
- „**jede** der 7 Achsen gegen echtes 10-Q/10-K nachgerechnet" ❌ — das gelang **bei genau einem Namen** (HNRG), und auch dort nur 5 von 7 sauber (`gpGrowth` unvereinbar, `ruleOfX` nur im Wachstums-Bein). Über die Stichprobe hinweg sind **32 von 182 Zellen (17,6 %)** gegen echte Filings nachgerechnet; **124 (68,1 %)** sind aus der offline verfügbaren Grundwahrheit **strukturell nicht nachrechenbar**.

**Der Grund ist benannt und behebbar, nicht prinzipiell:** die SEC-Jahresschicht führt kein `GrossProfit`, kein `ShareBasedCompensation` und keine Quartale (`merge-sec-xbrl.js:24-28`, `scripts/build-secannual-smallcap.js:119-125`). Drei Achsen und die Primärzweige zweier weiterer hängen genau daran.

**Und die Auflage hat geliefert, wofür sie da ist:** sie hat **drei Befunde ans Licht gebracht, die ohne sie unentdeckt geblieben wären** — die 46,5-%-OpInc-Deckung (§8.1, an einem Namen gegen das Roh-Filing bewiesen), die synthetische BTBT-Reihe (§8.2) und die mögliche Track-Fehlzuordnung von EGY (§8.4). Ein Board, dessen zentrale GuV-Größe zu mehr als der Hälfte nicht mit den Filings übereinstimmt, hat **kein sauberes Auflage-1-Zeugnis**, auch wenn die Rechenmaschine fehlerfrei arbeitet.

---

## §10 Was zur wörtlichen Erfüllung fehlt

Genau ein Schritt, **gratis, aber netzgebunden** — und damit ein Karl-Stop:

1. **`companyfacts` für die 26 Stichproben-CIKs ziehen** (freie SEC-API, `https://data.sec.gov/api/xbrl/companyfacts/CIK<cik>.json`, ~26 Abrufe à ~2 MB, dieselbe Mechanik wie `scripts/build-secannual-smallcap.js:95`). Damit werden `gpGrowth` (via `GrossProfit` bzw. `Revenues − COGS`), `dilution` (via `ShareBasedCompensation`) und die Quartals-Achsen `marginTrajectory`/`revGrowthLevel`/`revAcceleration` für **alle** Stichproben-Namen nachrechenbar — der HNRG-Pfad aus §7 skaliert unverändert, die Extraktionsfunktionen stehen bereits im Messskript.
2. Erst danach ist „jede der 7 Achsen gegen echtes 10-Q/10-K nachgerechnet" wörtlich einlösbar.

**Nicht nötig:** kein kostenpflichtiger Datenbezug, keine neue Dependency, keine Änderung an `src/scoring/` oder `tests/scoring/`.

**Vorschlag für die Befund-Queue (nicht selbst gefixt, Methodik-nah):**
- **B1 (hoch):** `annualOpInc`-Herkunft. Entweder die SEC-`OperatingIncomeLoss`-Reihe auch für Track-Split und `cycleDiscount` zur Quelle machen (dann ist eine Definition durchgehend), oder die Divergenz als Lampe sichtbar machen. Heute läuft der ROIC-Kern auf SEC und die Zusatzterme auf Yahoo — zwei Definitionen in einer Achse.
- **B2 (hoch):** `opIncSource: "computed-margin"` gehört fail-loud behandelt (Exclude oder `data-suspect`-Lampe), nicht stillschweigend gescort. Heute betrifft es 1 von 54 Board-Zeilen, aber 24 von 101 Snapshot-Dateien.
- **B3 (mittel):** `axes.js:212` auf Adjazenz härten (BH-079/BH-080-Muster), solange der Fall noch latent ist.
- **B4 (mittel):** Umsatz-Konzeptwahl in `merge-sec-xbrl.js` gegen Bestandteils-Tags absichern — CWCO ist ein lebender Beleg dafür, dass die Prioritäts-Union eine Teilgröße durchlässt.

---

## §11 Abgleich mit dem Vorlauf vom 2026-07-21

Im Repo liegt bereits `reports/5.2-auflage1-stichprobe-2026-07-21.md` (10 Namen, 7 Sektoren). Dieser Lauf hier ist der erste, der die **Achsen** selbst nachrechnet — der Vorlauf sagt das ausdrücklich von sich: „Bewusst NICHT alle 7 Achsen einzeln von Hand nachgerechnet" (Zeile 20-21). Auflage 1 war damit auch damals nicht wörtlich eingelöst; beide Läufe kommen unabhängig zu „teilweise erfüllt".

**Bestätigt, auf den Dollar:** der Vorlauf meldet für MGPI `OperatingIncomeLoss` FY2025 = **−94.615.000 $** (10-K, filed 2026-02-25) gegen Snapshot **+83.507.000 $**. Meine Messung heute, aus einer anderen Datei (`sec-secannual-smallcap.json`) und mit anderer Arithmetik: **−94,61 M vs. +83,51 M**. Identisch. Der Befund ist 39 Tage alt und im Store **unrepariert**.

**Repariert und heute verifiziert:** der damalige Befund hat den SEC-Präferenz-Fix ausgelöst (`axes.js:311-318` nennt „MGPI Vorzeichen-Flip, KODK-Betrag" wörtlich als Anlass). Der Fix **wirkt**: MGPIs `capitalEfficiency` stimmt heute mit der reinen SEC-Rechnung **exakt** überein (−0,0253067 = −0,0253067, `_source='sec'`). Das ist der eine Punkt, an dem das Board seit Juli nachweislich besser geworden ist.

**Was der Fix nicht abdeckt — und was dieser Lauf neu findet:**
1. Der Track-Split (`signTrack(annualOpInc)`) und der `cycleDiscount` innerhalb von `capitalEfficiency` lesen **weiterhin Yahoo**. Deshalb der EGY-Fall (§8.4), den der Vorlauf nicht sehen konnte.
2. Der Vorlauf prüfte nur das **jüngste** OpInc-Jahr und kam auf 2/10 = 20 % Divergenz. Über **vier** Jahre gemessen liegt die Nicht-Übereinstimmung bei **53,5 %** (54 von 101 Zellen). Die Rate, die der Vorlauf „im Auge zu behalten" empfahl, ist bei tieferer Messung deutlich schlechter, nicht besser.
3. Der Vorlauf notierte als offenen Punkt, „ob Yahoos Quartals-OpInc für diese 2 Namen ebenfalls abweicht". **Für HNRG ist das jetzt beantwortet:** die Quartals-OpInc-Reihe weicht um −0,2 bis −8,0 % ab (§7) — also spürbar, aber ohne Vorzeichen- oder Größenordnungsfehler. Für MGPI/KODK bleibt der Punkt offen (keine Roh-`companyfacts` offline).
4. `meta.opIncSource = "computed-margin"` (§8.2) kommt im Vorlauf nicht vor.

---

### Quellen-Schlüssel (jede Zahl dieses Reports)

| Größe | Datei → Schlüssel |
| --- | --- |
| Board-Zeile, Score, Rang, `lamps`, `coverageAxes`, `axisBreakdown`, `revGrowthYoYPct` | `outputs/smallcap/smallcap-<sektor>.json → <track>[rang−1]` |
| Board-Lineal (`winsorBounds`, `growthBounds`), Zeitstempel | `outputs/smallcap/calibration.json` |
| Store-Jahresreihen | `snapshots-smallcap/<TICKER>.json → annual.annualRev[i].value`, `.annualOpInc[i].value`, `.annualGP[i].value`, `.annualSBC[i]`, `.annualBalance[i].totalAssets`, `.annualBalance[i].currentLiabilities` |
| Store-Quartalsreihen | `… → timeseries.revenueQ[i].value`, `.opIncQ[i].value`, `.revenueQEnds[i]` |
| Store-Skalare, Herkunft | `… → metrics.fcfMarginTTM.value`, `metrics.*.asOf`, `meta.opIncSource` |
| SEC-Jahresschicht | `external-data/sec-secannual-smallcap.json → <TICKER>.annualRev[i].value`, `.annualOpInc[i]`, `.annualAssets[i]`, `.annualCurrentLiabilities[i]`, `.nfy`, `.cik` |
| Roh-Filings (nur HNRG) | `external-data/sec-xbrl/0000788965.json → facts["us-gaap"].<Konzept>.units.USD[]` mit `form/fp/fy/start/end/val/accn/filed` |
| Achsen-Definition | `src/scoring/formulas/smallcap/index.js`, `src/scoring/formulas/<sektor>.js → axes[]`, `alpha`, `splitMetric` |
| Achsen-Rechnung | `src/scoring/axes.js`, Aufruf über `src/scoring/score.js → rawAxisValue()` |
| Messskript | `scripts/probe-auflage1-messlauf.js` (Wegwerf; erzeugt keine Repo-Datei) |
