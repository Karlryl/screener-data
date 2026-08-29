# B-Slot: hartes Gate gegen synthetische OpInc-Reihen (B1–B4 + Regressions-Pin)

**Datum:** 2026-08-29 · **Zweig:** `fix/b-slot-opinc-gate` ab `origin/main` `66b8f78ffd`
**Autorisierung (beide Glieder liegen vor, gqs00 verlangt beide):**

| Glied | Beleg |
|---|---|
| Gerichtsurteil | T164/T165/T166, 29.08.2026 — **K2 einstimmig 3:0**, **K3 einstimmig 3:0**; Bank vollzählig (R1/R2 Claude, R3 Codex CLI gpt-5.6-sol) |
| Ratifikation | Orchestrator **ENTSCHIED 15**, 29.08. 18:55 — „RATIFIZIERT ohne Änderung" |
| Karl-Freigabe | **29.08.2026 20:10**, Kreuzelrunde Frage 1 „Versiegelter Score-Slot B1–B4" → JA, gebündelt |
| Dispatch | Orchestrator **ENTSCHIED 18**, 29.08. 20:07 |
| Siegel-Übergang | `protocol/gqs-00/1.2.0-pending/transition.json` (status `pending`, from `GQS-00@1.1.0`) |

---

## AUF EINEN BLICK

**Das Gate steht vollständig; die gemessene Wirkung trifft die Gerichts-Prognose auf zwei
Nachkommastellen (n=160, Ø 5,906, max 26,573 gegen angesagt ~163 / 5,88 / 26,6), und der
IREN-Anker kippt wie angesagt das Vorzeichen.**

- **Wirkung ist auf die Financials-Boards begrenzt:** 0 Eintritte, **3 Austritte**, 324 Rangbewegungen. Kein anderes Board bewegt sich.
- **GLXY**, der Anlassfall des Urteils: der Rang-1-Treiber `capitalEfficiency`-Perzentil **99,7 aus Fiktion** fällt weg, Score 88,814 → 80,217. Die Zeile bleibt geroutet und gekennzeichnet.
- **Der eine strittige Punkt (§7) ist entschieden:** die drei Score-Ausfälle SIND die drei Coverage-1/7-Namen aus K2.6. „Restscore behalten" ist bei ihnen mechanisch unmöglich — **K2.6s Tatsachen-Prämisse ist messtechnisch widerlegt**. Eskaliert statt selbst entschieden; **ENTSCHIED 24 ratifiziert den Abgang über den universellen `no-axes`-Vertrag**. Klassen-Definition und Zählung (exakt 3) in §7 festgehalten, damit ein Anwachsen der Klasse künftig auffällt.

Sprungmarken: §1 Konsumenten-Inventur · §2 was gebaut wurde · §3 Gate-Wirkungs-Diff · §4 Anker
· §5 Wächter und Bruchprobe · §6 Siegel · §7 Eskalation · §8 Nebenbefunde.

---

## 1 Konsumenten-Inventur `annualOpInc` (K2-Auflage 4)

Vollständige Aufstellung **jedes** Lesers der Jahres-OpInc-Reihe in der Engine, mit Entscheid.
Erhoben per `grep -rn "annualOpInc\|opIncQ\|secAnnual" src/scoring/`, jede Fundstelle einzeln
gelesen — nicht gemustert.

### GESPERRT (lesen ab jetzt `histOpInc`)

| # | Ort | Funktion | Warum longitudinal |
|---|---|---|---|
| 1 | `axes.js` `roicStabilitySource` | speist `capitalEfficiency` **und** `roicStability` | Mehrjahres-ROIC-Serie; K2-Auflage 2 nennt beide namentlich |
| 2 | `axes.js` `capitalEfficiency` (cycleDiscount) | jüngste Marge gegen Eigen-Schnitt | Mehrjahres-Vergleich; auf Synthetik ist `cur == histRest` per Konstruktion |
| 3 | `lamps.js` `lowRoic` | Anzeige-Zwilling der ROIC-Achse | liest #1 mit — fällt automatisch, keine zweite Codestelle |
| 4 | `score.js` `cycleSeriesPair` → `cycleSignal`/`cycleDamperFactor` | Vorzeichenwechsel über die Jahresreihe | die longitudinalste Größe der Engine; Synthetik hat konstantes Vorzeichen |
| 5 | `score.js` `profitSeries` → `phaseOf` | `every(v >= 0)` = established | „nie ein Verlustjahr" ist auf konstanter Reihe eine Tautologie |
| 6 | `profit-tier.js` `annualProfitSeries` → `profitTierOf` | ≥4 Jahre alle ≥0 = langfristig-profitabel | **nicht nur deskriptiv:** `quality-route.js` benutzt die Stufe als Aufnahmeregel |
| 7 | `lamps.js` `peakMargin` | cur gegen Mittel der Vorjahre | longitudinal |
| 8 | `lamps.js` `cyclePeak` | dito, mit `!rising`-Schärfung | longitudinal |
| 9 | `lamps.js` `burnAccelerating` → `burnPressFactor` | `opi[0] < opi[1]` (Zwei-Jahres-Vergleich) | longitudinal **und score-drückend**: auf Synthetik wäre das nur `rev[0] < rev[1]` mit der TTM-Marge als Vorzeichen |

### BEWUSST NICHT GESPERRT (bleiben auf `norm`)

| # | Ort | Grund |
|---|---|---|
| 10 | `score.js` `trackOf` (`case 'OpInc'`) | **K2-Auflage 1.** Liest nur das jüngste Jahr; dessen Vorzeichen IST das der realen TTM-Operating-Margin (`rev[0] > 0 × Marge`). R3s Präzisierung „Signal direkt aus der Operating-Margin" ist damit erfüllt, ohne einen zweiten Rechenweg zu derselben Zahl. |
| 11 | `score.js` `profitSign` (Sub-Kohorte capEff) | dasselbe Vorzeichen-Signal; **zusätzlich** spiegelt `gqs00-freeze.js comparisonBasis()` genau diese Zeile — ein Wechsel würde Siegel und Produktion auseinanderdriften lassen |
| 12 | `calibrate.js` `profitSign` | Spiegel von #11; muss zeichengleich bleiben |
| 13 | `lamps.js` `unprofit` | `firstPresent` = ein Wert = aktuelles Vorzeichen. Der eigene Rückfall der Lampe ist ohnehin die TTM-`operatingMargin` — dieselbe Aussage |

### NICHT BETROFFEN (geprüft, kein Handlungsbedarf)

| # | Ort | Grund |
|---|---|---|
| 14 | `profit-streak.js` `profitStreak` | liest **nicht** den Snapshot, sondern `external-data/sec-annual-bulk.jsonl` — eine echte SEC-Reihe. Der Notbehelf hat sie nie berührt. |
| 15 | `axes.js` `quarterOpMargins`/`marginTrajectory`, `lamps.js` `newestQtrSuspect`, `profit-tier.js` Breakeven-Trajektorie | lesen **`opIncQ`** (Quartale). `_deriveOpIncForFinancials` füllt ausschließlich `annual.annualOpInc` — die Quartalsreihe ist nie synthetisch (verifiziert an `pull-yahoo.js:1396-1403`). |
| 16 | `score.js`/`axes.js` `normSec`/`secSeries` | committete SEC-Serien, unabhängige echte Quelle |

**Ergebnis: die Inventur ist vollständig, jeder der 16 Leser hat einen begründeten Entscheid.
Die K2.7-Fallback-Klausel (Gate unvollständig → NULLEN) ist damit NICHT ausgelöst.**

---

## 2 Was gebaut wurde

**Ein Gate, eine Definition.** `snapshot.js` bekommt `opIncSynthetic()` und `histOpInc()`; die
neun historischen Verbraucher wechseln von `norm(s,'annualOpInc')` auf `histOpInc(s)`.
`histOpInc` liefert bei `meta.opIncSource === 'computed-margin'` `[]` — exakt die Ausgabe, die
`norm()` laut eigenem Vertrag (iii) für ein fehlendes Feld liefert. Alle neun Verbraucher
behandeln diesen Zustand bereits korrekt über ihre **dokumentierten, vorbestehenden** Rückfälle
(NetIncome-Rescue, renorm-on-drop, Dämpfer-Faktor exakt 1.0). Kein neuer Sonderpfad, keine
zweite Semantik für denselben Zustand. Die Messung `scripts/ab-computed-margin.js` hat genau
diese Äquivalenz vorher am echten Bestand belegt.

**B3 fällt aus derselben Zeile.** In `roicStabilitySource` lautet die Längenbedingung
`opS.length >= opY.length`. Ist `opY` bei Synthetik leer, ist sie `>= 0` und damit immer erfüllt:
**eine echte SEC-Serie gewinnt gegen Synthetik unabhängig von ihrer Länge.** Gegen eine echte
Yahoo-Reihe bleibt sie unverändert scharf — der Dünne-Serien-Schutz ist nicht mitgelockert.
Single-Source-Trio-Guard und Index-0-Guard sind unangetastet.

**B2/B4: zwei nicht-excludierende Herkunfts-Lampen.** `opIncSynthetisch` (computed-margin) und
`opIncYahooAdjusted` (K1-Doppelboden). Beide **nicht** in `DATA_SUSPECT_LAMPS` — dort wären sie
ein 300-Zeilen-Exclude durch die Hintertür. Damit erreicht `meta.opIncSource` überhaupt zum
ersten Mal die Engine (K3-Auflage 3: `grep` in `src/scoring/` ergab bis heute 0 Treffer über
31 Dateien).

Ein `null` bleibt `null`: ein Snapshot **ohne** Etikett gilt nie als synthetisch, und beide
Lampen melden dort „nicht bewertbar" statt `false`.

---

## 3 Gate-Wirkungs-Diff (K2-Auflage 5)

**Messstand:** byte-identische Kopie des Live-Stores vom 29.08.2026, 15.046 Dateien, geladenes
Universum 15.044 in **beiden** Läufen. Voller lokaler Re-Score der Produktions-Engine je
Checkout (`origin/main 66b8f78ffd` gegen diesen Zweig), gleiche Eingabe-Objekte, gleiche
Lade-Kette inkl. `mergeSecIntoUniverse`. Der Zweig wurde nach der Bruchprobe erneut vermessen —
das Ergebnis ist **byte-identisch** zum ersten Lauf (Determinismus belegt).

**Etiketten-Zensus im Messstand:** `computed-margin` **1.859** · `yahoo-adjusted` 12.587 ·
`sec-gaap` 99 · ohne Etikett 495.

| Größe | Wert | Gerichts-Prognose |
|---|---:|---|
| aktiv betroffene Zeilen (dScoreBase ≠ 0, computed-margin) | **160** | ~163 |
| Ø \|dScoreBase\| | **5,9057** | ~5,88 |
| Median \|dScoreBase\| | 5,3449 | — |
| max \|dScoreBase\| | **26,5734** | ~26,6 |
| Score-Ausfälle | **3** | „bis zu 3" |

**Weitere Bewegung:** 354 Zeilen mit verändertem Endscore (297 computed-margin, 54 andere —
letztere ausschließlich `financials`-Namen, die sich über die neu gelernten Kohorten-Verteilungen
mitbewegen, das ist der gewollte populationsweite Effekt). Track-Wechsel: **3** (genau die drei
Ausfälle, deren Track mit dem Routing wegfällt) — **kein einziger echter Track-Flip**, K2-Auflage 1
hält. Endfaktoren: burn 10, growth 3, cycle 3. Lampen (ohne die zwei neuen): 175 Zeilen, sämtlich
`lowRoic`, das erwartete Mitfallen des ROIC-Anzeige-Zwillings. Profitphase und Profit-Stufe:
je 267 Wechsel (der Effekt aus Inventur-Zeile 5/6).

**Board-Wirkung — vollständig:**

| Board | Zeilen vorher | nachher | Austritte | Rangbewegungen |
|---|---:|---:|---|---:|
| `financials\|profitable` | 320 | 320 | — | 298 |
| `financials\|unprofitable` | 34 | 31 | `EXO.AS`, `0622.HK`, `0290.HK` | 26 |
| alle 24 übrigen Boards | — | — | keine | 0 |

**0 Eintritte, 3 Austritte, 324 Rangbewegungen. Kein Name verlässt das Universum.**

---

## 4 Regressionsanker

### IREN — K3-Anker **GETROFFEN**

| Größe | vorher | nachher |
|---|---:|---:|
| `roicStabilitySource._source` | `yahoo` | **`sec`** |
| `capitalEfficiency` | **−0,11469** | **+0,00621** |
| capEff-Perzentil | 62,5 | 96,7 |
| Score | 53,939 | 59,561 |

Die **echte SEC-Serie mit einem einzigen Jahr** schlägt jetzt die vier synthetischen Yahoo-Jahre.
Das Vorzeichen kippt — genau der vom Gericht angesagte IREN-Flip.

### GLXY — Anlassfall des Urteils

`capitalEfficiency`-Perzentil **99,7 → Achse gedroppt**, Score **88,814 → 80,217**,
coverageWeight 0,74 → 0,58, `profitTier` langfristig-profitabel → kurz-vor-profitabel.
Die Zeile bleibt **geroutet**, behält ihren Restscore aus den echten Achsen und trägt sichtbar
`opIncSynthetisch`. Das ist K2-Auflage 6, wie sie gemeint war.

### BTBT — **nicht messbar, ehrlich ausgewiesen**

`BTBT` steht in `watchlist.json`, hat aber **weder einen Snapshot im Store noch einen Eintrag in
`external-data/sec-secannual.json`** (214 SEC-Keys, `BTBT` nicht darunter). Der Anker ist eine
Datenlücke, keine Code-Frage. Ich habe ihn nicht ersatzweise konstruiert.

### Reichweite von B3 insgesamt

Von 1.859 computed-margin-Namen haben **6** überhaupt eine committete SEC-OpInc-Serie; genau
**1** (IREN) wechselt dadurch die ROIC-Quelle. Die übrigen 5 scheitern am **unveränderten**
Single-Source-Trio-Guard (fehlende tiefe Bilanz bzw. Index-0-Lücke). Der Diagnose-Zähler in
`run-screener.js` bestätigt es unabhängig: „in den Achsen wirksam" **140 → 141**.

---

## 5 Wächter und Bruchprobe

`tests/scoring/opinc-gate-computed-margin.test.js` — **21 Prüfungen, 21 grün.** Jede Sperr-Assertion
hat ihre Gegenprobe am **byte-gleichen Zwilling**, bei dem nur `meta.opIncSource` abweicht: damit
ist bewiesen, dass die Sperre am Etikett hängt und nicht an einer Eigenschaft der Zahlen — und
dass sie nicht zu weit greift.

**Absichtsbruch-Probe (jede Gruppe einmal am Prüfling gebrochen, Rücknahme per Datei-Kopie):**

| Bruch am Prüfling | Rot geworden |
|---|---|
| `histOpInc()` auf `norm()` zurückgesetzt (Gate weg) | G1a, G3a, G3c, G4c, G6a–G6d (8) |
| `trackOf` liest `histOpInc` (**Über**-Sperrung) | G2b (1) |
| `opIncSynthetisch` in `DATA_SUSPECT_LAMPS` eingetragen | G4b, G4c (2) |
| Runde-4-Null-Rettung aus `trackOf` entfernt | G7a, G7c, G7d (3) |
| K3-Ausnahme ausgehebelt | G1a, G3a, G3c, G4c (4) |
| Profitphasen-Gate zurückgedreht | G6a (1) |
| **Rücknahme-Kontrolle** | **21 ok, 0 fail** |

Jeder Bruch trifft **genau** die zuständige Gruppe. Der zweite Bruch ist der wichtige: er beweist,
dass der Wächter auch die **Über**-Sperrung fängt — ein Gate, das den Track-Split mitreißt, wäre
ein Urteilsbruch und würde still 1.859 Namen umrouten.

**Regressions-Pin (ENTSCHIED 16), G7a–G7d:** `trackOf` fällt bei present-0 im jüngsten OpInc-Jahr
auf das NetIncome-Vorzeichen zurück. Der A4-Scan zählte 140 Null-Fälle, 20 davon mit negativem
NetIncome. Ohne den Pfad würde `signTrack(0)` sie zu `profitable` routen. Der Pin hält ihn fest,
inklusive Gegenprobe (dieselbe 0 mit positivem NetIncome bleibt `profitable`) und der
Synthetik-Variante.

---

## 6 Siegel

`node scripts/gqs00-freeze.js --verify` → **grün**, `negativeMutationGate: PASS`,
25 Golden-Cases, 13 Branchen, 0 Score-/Rang-Abweichungen. `node --test
tests/scoring/gqs00-freeze.test.js` → 1 pass, 0 fail.

Das etablierte Verfahren wurde befolgt: `protocol/gqs-00/1.2.0-pending/transition.json` mit
`status: "pending"`, `from: "GQS-00@1.1.0"` und den LF-Hashes der **sechs** geänderten Dateien —
für genau diese sechs ist der pending-Hash eine **zweite** erlaubte Variante neben dem
1.1.0-Siegelhash, jeder dritte Stand bleibt rot, jede nicht gelistete Datei bleibt festgenagelt.
`protocol/gqs-00/1.1.0/` und `1.0.0/` sind **nicht angefasst**.

**Golden-Fixture-Wirkung: 0 erwartete Scores ändern sich.** Drei der 25 Fixtures tragen
`computed-margin` (`STB.OL`, `GDG.AX`, `001236.SZ`) — bei den ersten beiden ist
`capitalEfficiency` **bereits im Siegel** null, die dritte ist gar nicht geroutet
(`survival`/`no-revenue`). Auch kein Endfaktor bewegt sich. Der volle Trace-Rebuild in `verify()`
bestätigt das maschinell, nicht per Behauptung.

**Vollversiegelung als 1.2.0** erfolgt nach dem ersten grünen planmäßigen daily-pull mit dem
neuen Code (Cron `17 2 * * 2-6`) — so wie beim Übergang 1.0.0 → 1.1.0.

---

## 7 K2.6 gegen K2.5 — die drei Coverage-1/7-Namen (ENTSCHIED 24: entschieden)

> **ENTSCHIED 24 vom 29.08.2026 20:55 — Weg (3) ratifiziert, Konfidenz ~85 % geteilt.**
> **K2.6s Tatsachen-Prämisse ist messtechnisch widerlegt:** es EXISTIERT kein Restscore, den
> diese drei Zeilen behalten könnten — `capitalEfficiency` war ihre einzige Achse und vollständig
> synthetisch. **Bei toter Prämisse regiert der KERN des einstimmigen Urteils:** K2.2 verbietet
> Rang aus Fiktion (Weg 1 würde ihn brechen), der Fake-50 ist verboten (Weg 2), und R2s Sorge vor
> einem Lampen-Hintertür-Massen-Exclude greift hier nicht — **der Abgang läuft über den
> vorbestehenden universellen `no-axes`-Vertrag, nicht über die Lampe** (bewiesen in Wächter G4b:
> die Herkunfts-Lampen ändern `isDataSuspect` nicht).

### Klassen-Definition und Zählung (Auflage aus ENTSCHIED 24)

Damit ein künftiger Re-Run ein **Anwachsen** dieser Klasse erkennt statt es zu übersehen:

**Ursächliche Definition:** eine Zeile mit `meta.opIncSource === 'computed-margin'`, deren
**einzige** bewertbare Achse `capitalEfficiency` ist. Das Gate nimmt ihr diese eine Achse; damit
bleibt keine bewertbare Achse übrig und der vorbestehende universelle Engine-Vertrag greift.

**Operative Definition (das, was man zählt):** Zeilen, die beim Gate-Vergleich von
`action='route'` auf `action='exclude'` mit `reason='no-axes'` wechseln **und** das Etikett
`computed-margin` tragen.

**Zählung am Messstand 2026-08-29: exakt 3.**

| Ticker | Score vorher | einzige getragene Achse | Perzentil | coverageWeight | nachher |
|---|---:|---|---:|---:|---|
| `0290.HK` | 56,576 | `capitalEfficiency` | 83,9 | 0,18 | `exclude` / `no-axes` |
| `0622.HK` | 58,367 | `capitalEfficiency` | 94,6 | 0,18 | `exclude` / `no-axes` |
| `EXO.AS` | 58,965 | `capitalEfficiency` | 98,2 | 0,18 | `exclude` / `no-axes` |

**Nachzählen bei jedem künftigen Re-Run:** dieselben zwei Voll-Läufe wie in §3 fahren (alter
Stand gegen neuen Stand auf identischem Snapshot-Baum) und die Zeilen zählen, deren `action` von
`route` auf `exclude`/`no-axes` kippt. **Mehr als 3 = die Klasse wächst** → das ist ein neuer
Befund und gehört an den Orchestrator, nicht in eine stille Anpassung. Wächst sie, heißt das:
mehr Namen hängen mit ihrem GANZEN Score an einer synthetischen Achse — genau die Entwicklung,
vor der K2.5 gewarnt hat.

### Der Befund, der zu dieser Entscheidung führte (Messung, unverändert)

**Der Befund:** die drei Score-Ausfälle sind **dieselben drei Namen** wie die „3 Coverage-1/7-Namen"
aus K2-Auflage 6.

| Ticker | Score vorher | einzige getragene Achse | Perzentil | coverageWeight | nachher |
|---|---:|---|---:|---:|---|
| `0290.HK` | 56,576 | `capitalEfficiency` | 83,9 | 0,18 | `exclude` / `no-axes` |
| `0622.HK` | 58,367 | `capitalEfficiency` | 94,6 | 0,18 | `exclude` / `no-axes` |
| `EXO.AS` | 58,965 | `capitalEfficiency` | 98,2 | 0,18 | `exclude` / `no-axes` |

**Warum das kein Umsetzungsfehler ist:** ihr **gesamter** Score bestand aus der gesperrten Achse.
1 von 7 Achsen — und diese eine ist `capitalEfficiency` auf der synthetischen Reihe. Nimmt man
sie weg, bleibt **kein Rest**, den man behalten könnte. Es greift der vorbestehende, universelle
Engine-Vertrag `action='exclude', reason='no-axes'` — **nicht** die Herkunfts-Lampe und **nicht**
`DATA_SUSPECT_LAMPS` (nachgewiesen in Wächter G4b: die Lampen ändern `isDataSuspect` nicht).

**K2.5 und K2.6 widersprechen sich im Urteil selbst:** K2.5 nennt „3 mögliche Score-Ausfälle"
als gewürdigte, akzeptierte Folge; K2.6 verlangt für dieselben drei Zeilen einen Restscore.
Meine Messung zeigt, dass beides nicht gleichzeitig gehen kann.

**Die drei denkbaren Wege — und warum ich keinen davon selbst gewählt habe:**

1. **Ausnahme vom Gate**, wenn `capitalEfficiency` die einzige Achse ist → eine Zeile, deren
   **ganzer** Score aus Fiktion besteht, bliebe auf dem Board. Bricht K2-Auflage 2 frontal.
2. **Routen mit coverageWeight 0** → Score = Kohorten-Median aus dem Nichts. Genau der
   „Fake-50", den der Engine-Vertrag ausdrücklich verbietet.
3. **`exclude`/`no-axes` akzeptieren** (der jetzige Stand) → drei Zeilen verlassen das
   `financials|unprofitable`-Board, die Lampe bleibt an der ausgeschlossenen Zeile sichtbar.

**Weg (3) ist ratifiziert** (ENTSCHIED 24, Konfidenz ~85 % geteilt): eine Board-Zeile ohne eine
einzige belegbare Achse ist keine Aussage. Die Entscheidung lag als Board-Sichtbarkeits-Frage
beim Orchestrator, nicht beim Executor — der PR wurde bis zur Antwort offen gehalten und erst
danach gemergt.

Die K2.7-Fallback-Klausel ist hiervon **nicht** berührt: das Gate ist vollständig (§1), die
Nullungs-Bedingung ist nicht eingetreten.

---

## 8 Nebenbefunde (nicht angefasst — außerhalb des Auftrags)

- **`tests/scoring/calibration-ref.test.js` ist am echten Store rot** — und zwar **auch auf
  `origin/main`** (verifiziert im Baseline-Worktree, identischer Store). Es reißt eine
  *Vorbedingung* („Kohorte `utilities|unprofitable` fehlt in `calA_edge.cohortBases`"), also eine
  datenabhängige Fixture-Annahme, die der aktuelle Bestand nicht mehr erfüllt. Im CI fällt das
  nicht auf, weil die Datei dort mangels `snapshots/` unter UEBERSPRUNGEN läuft. **Nicht von
  dieser Änderung verursacht, nicht von mir gefixt.**
- **Eigener Fehler im Ablauf, offengelegt:** meine erste Bruchprobe nahm die Brüche per
  `git checkout -- <datei>` zurück. Die Änderungen waren unstaged — der Befehl hat damit nicht
  den Bruch, sondern die **Arbeit** verworfen (`snapshot.js`, `axes.js`, `score.js`). Vollständig
  rekonstruiert; der wiederhergestellte Stand wurde per erneutem Voll-Re-Score als
  **byte-identisch** zum vermessenen Stand belegt, bevor irgendetwas committet wurde. Die
  Bruchprobe läuft jetzt über Datei-Kopien statt über git.
