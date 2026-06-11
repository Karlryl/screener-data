# Regression-Audit 2026-06-11 (Tag 237-240)

> **RESOLUTION (2026-06-11, Tag 241–242 — committet, getestet):**
> - **F-PY-102** (FIXED, Tag 241): `_withAbortTimeout` + AbortSignal durch
>   `moduleOptions.fetchOptions` an quoteSummary/quote/FTS — Timeout bricht den
>   Fetch jetzt ab und gibt den Queue-Slot frei. Live: 3/3 ok.
> - **F-DP-101** (FIXED, Tag 241): `mapFTSToAnnual` Cash-Schleife null-erhaltend →
>   annualOCF/FCF aligned mit annualCapex. Live nach Cache-Rebuild: NVDA 5/5/5,
>   aligned:true.
> - **F-R40-001 + F-R40-002** (FIXED, Tag 241): dqGrade-C-Block jetzt am echten
>   r40-latest.json-Export (generate-screener.js) UND in build-r40-latest.js;
>   irreführender WATCH-Kommentar korrigiert.
> - **F-ME-103** (FIXED, Tag 242): TURNAROUND verlangt jetzt ≥1 computable
>   profitability-Methode, sonst REJECT. Synthetisch verifiziert (no-prof→REJECT,
>   with-prof→A/100 unverändert).
> - **F-F4-003** (FIXED, Tag 242): Form-4-Pagination Cap MAX_OLDER_PAGES=4.
> - **F-MANIP-001 + F-GS-001** (DOKUMENTIERT, nicht gefixt): beide nicht-live —
>   manipulation-filters ist ein reiner Diagnose-Pfad, F-GS-001 betrifft nur die
>   Annual-Tabelle im Detail-Modal (Anzeige), kein Pick/Score/Ranking. Wurzel ist
>   die quellen-uneinheitliche Auswahl der annual.*-Arrays beim QS/FTS-Merge —
>   strukturelles Thema für einen späteren, eigenständigen Pass.
> - **F-METH-001**: widerlegt (Mechanismus real, Impact 0 — Legacy-totalLiab-Pfad
>   in 0 Snapshots erreicht).
> Alle Gates nach jedem Batch grün: tag28 184/184, engine-cli 10/10, anchors 10/10.

Triage + Re-Verifikation der bestätigten Findings aus dem Tag-237-240-Audit-Lauf.
Alle zitierten Code-Stellen wurden für diesen Report erneut gegen die echten
Quelldateien geprüft (generate-screener.js, pull-yahoo.js, methods/reinvestment-rate.js,
methods/score-aggregator.js, scripts/pull-insider-form4.js, scripts/build-r40-latest.js,
.github/workflows/daily-pull.yml). Heutiges Datum: 2026-06-11.

## Executive Summary

- **8 bestätigte Findings** (1 nach Re-Verifikation als HIGH/MEDIUM-strittig, 1 MEDIUM,
  1 MEDIUM, 5 LOW), **1 widerlegtes** (F-METH-001).
- Nach Dedup bleiben **7 eigenständige Defekte** + **1 reine Doku-/Claim-Korrektur**
  (F-R40-001 ist Claim-Regression, F-R40-002 teilt deren Wurzel).
- **Sind Tag 237-240 sicher?** Funktional ja — **keine Regression erzeugt falsche
  Live-Screener-Werte mit hoher aktueller Inzidenz, kein Crash, keine Datenkorruption
  im committeten Output.** Die Tag-239-F-05-Änderung (dqGrade-C-Block) hat aber ihr
  erklärtes Ziel verfehlt (F-R40-001) und einen kleinen Sichtbarkeits-Regress
  eingeführt (F-R40-002). Der einzige *korrektheits*-relevante Defekt im Kern-Scoring
  (F-DP-101, reinvestment-rate) ist **kein Tag-237-240-Regress**, sondern ein latenter
  Altbestand-Defekt derselben Array-Alignment-Klasse — derzeit faktisch dormant
  (0 fehlberechnete computable-Werte im aktuellen 4683-Snapshot-Datensatz).
- **Größtes Risiko:** F-DP-101 — `reinvestment-rate` paart fehlausgerichtete
  `annualCapex` (null-erhaltend) vs. `annualOCF` (kompaktiert) am QC-MUST-Gate
  (Gewicht 0.15). Mechanismus bewiesen, .value-Verschiebung reproduziert, Gate kann
  bei passendem Yahoo-Schema-Loch kippen. Hoch nach Mechanismus, aber aktuell ohne
  reale Inzidenz → effektiv MEDIUM-mit-HIGH-Latenz. **Sofort fixen, da hash-sicher.**
- **Daten-Contract-Lücke nach außen:** F-R40-001 — `r40-latest.json` (findash-Export)
  lässt dqGrade-C-Zeilen weiterhin durch; der Tag-239-Commit behauptet das Gegenteil.
  Kein Test deckt den Export-Pfad ab.

## Bestätigte Findings (nach Severity)

### HIGH / strittig→MEDIUM-mit-HIGH-Latenz

**F-DP-101 — reinvestment-rate zippt fehlausgerichtete annualCapex/annualOCF**
- **Datei:** `pull-yahoo.js:1840` (annualCapex = ftsAnnualCapex, null-erhaltend via
  `_ftsExtractByYear`, def. 1047-1056) vs. `pull-yahoo.js:1875` (annualOCF aus
  `mapFTSToAnnual`-cash-Loop mit `continue` bei op==null&&fcf==null, Zeile 1096 →
  kompaktiert); Konsum: `methods/reinvestment-rate.js:138-158` (paart `rawCapex[j]`
  mit `rawOcf[j]` positionell).
- **Mechanismus (1 Satz):** Beide Arrays stammen aus derselben `fts.annualCash`, aber
  mit zwei Null-Konventionen; hat ein mittleres Geschäftsjahr OCF=null UND FCF=null bei
  vorhandenem Capex, ist annualCapex eine Position länger, und ab diesem Index paart der
  Median-Loop Capex(Jahr N) mit OCF(Jahr N±1) → falsche (Capex+R&D)/OCF-Ratio am
  QC-MUST-Gate (THRESHOLD 0.20, SCORE_WEIGHTS.QUALITY_COMPOUNDER 0.15).
- **Fix:** annualOCF/annualFCF NICHT mehr im skip-basierten cash-Loop bauen, sondern via
  `_ftsExtractByYear(fts.annualCash, [...])` (null-erhaltend, identisch zu Capex/SBC) —
  dann teilen Capex/OCF/FCF/SBC dieselbe Zeilenindizierung. Alternativ in
  `mapFTSToAnnual` den `continue` (Z.1096) durch Null-Push ersetzen (analog F-DP-003
  in `mapFTSToBalance` und dem financials-Loop derselben Funktion).
- **Verdikt:** confirmed 2/2 (isReal=true; eine Stimme HIGH 0.88, eine MEDIUM 0.78).
  Mechanismus + Code-Stellen + .value-Verschiebung von beiden reproduziert. Divergenz:
  reale Inzidenz. Mid-Window-Skip-Signatur tritt im aktuellen Datensatz in genau 1
  Ticker (MDLN.json) auf, und der ist computable=false → **0 aktuell fehlberechnete
  computable-Werte.** Yahoos fehlendes Jahr ist fast immer das älteste; dann droppen
  BEIDE Konventionen dasselbe Tail-Jahr → Indizes bleiben ausgerichtet. Daher:
  HIGH nach Mechanismus, dormant in der Praxis → konsolidiert **MEDIUM mit HIGH-Latenz.**
- **regression_of:** null (Altbestand-Defekt; gleiche Klasse wie bereits gefixte
  F-DP-030/031/F-DP-003 — die cash-Loop-Seite blieb inkonsistent).

### MEDIUM

**F-R40-001 — F-05-Fix erreicht r40-latest.json NICHT; Export lässt dqGrade-C weiter zu**
- **Datei:** `generate-screener.js:644` (F-05-Gate auf tabs.R40, mit
  `!dqBlockedFromQuality` = dqGrade==='C', def. Z.593) vs. **Export-Pfad**
  `generate-screener.js:4018-4047` (iteriert volle `rows`, Gate `hardGated` Z.4029-4031
  enthält `dqGrade === 'D'`, NICHT 'C'); Schwester-Skript `scripts/build-r40-latest.js:56-58`
  identischer Defekt.
- **Mechanismus (1 Satz):** Der Tag-239-F-05-Block wurde nur am R40-Tab-Gate ergänzt,
  aber der tatsächliche r40-latest.json-Export ist ein separater Pfad über die vollen
  `rows` und filtert nur Grade D — dqGrade-C-Zeilen werden unverändert exportiert; der
  Commit-Claim "trusted export no longer admits 60-85%-missing rows" ist falsch.
- **Fix:** `|| r.dqGrade === 'C'` in den `hardGated`-Ausdruck Z.4029-4031 aufnehmen UND
  in `build-r40-latest.js:56-58` spiegeln. Alternativ den Export aus dem bereits
  gefilterten `tabs.R40`-Array speisen statt aus vollen `rows` neu abzuleiten, damit die
  beiden Selektionspfade nicht driften können.
- **Verdikt:** confirmed 1/1 (isReal=true, 0.95). Voller Code-Pfad-Trace bestätigt:
  Export ist byte-für-byte unberührt von der Zeile-644-Änderung; CI baut über
  `node generate-screener.js` (daily-pull.yml:396, hier verifiziert) genau diesen
  In-Process-Pfad; kein Test deckt ihn ab. Kosmetische Ungenauigkeit im Finding
  ("60-85%" — Grade C liegt eher im 40-60%-Band) ohne Mechanismus-Folge.
- **regression_of:** 13d89e26a (Tag 239) — unvollständiger Fix + falscher Claim;
  Export-Unterfilterung selbst ist vorbestehend (Tag 234/235).

**F-PY-102 — _withTimeout bricht Yahoo-Anfrage nicht ab → Timeout gibt queue-Slot nicht frei**
- **Datei:** `pull-yahoo.js:1205-1211` (`_withTimeout` = Promise.race mit Timer, KEIN
  AbortSignal), `pull-yahoo.js:1283` (yf.quoteSummary ohne signal), `pull-yahoo.js:1291-1298`
  (Retry auch bei `isTimeout`, nicht nur 429); yahoo-finance2 queue hält `_running` bis
  der echte Fetch settled.
- **Mechanismus (1 Satz):** Bei Timeout rejectet nur das Race-Promise, der zugrunde
  liegende Fetch läuft ohne AbortSignal weiter und hält den concurrency-Slot belegt
  (Zombie); der Timeout-Retry enqueued zusätzlich neue Jobs hinter die toten Slots →
  unter Yahoo-Throttling Durchsatz-Kollaps statt Erholung.
- **Fix (mindestens (1)):** (1) Retry NUR bei echtem 429 (`isRateLimit`), NICHT bei
  `isTimeout` — kleiner, sicherer Sofort-Fix. (2) AbortController.signal via fetchOptions
  an quoteSummary/quote/fundamentalsTimeSeries durchreichen und bei Timeout abort()
  rufen, damit `runNext().finally()` feuert (yahoo-finance2 v3.14 reicht fetchOptions
  durch — vor Umsetzung verifizieren). (3) Sonst per-call-Timeout entfernen oder
  >= Yahoo-Retry-After (>=60s) setzen.
- **Verdikt:** confirmed 1/1 (isReal=true, 0.88). Code-Trace + zwei Simulationen mit der
  echten queue.js: maxActive-Fetches korrekt gecappt, aber _running bleibt belegt und
  _queue staut sich hinter Zombies. Quantitative Realwelt-Aussagen (CDN 30-60s,
  7.210-Failures-Zuordnung) plausibel, aber nicht aus Code allein beweisbar.
- **regression_of:** null (vorbestehend, Timeout/Retry seit Tag 169/182,
  concurrency-Wiring Tag 147 — kein Tag-237-240-Regress, aber im Kern-Pull-Pfad).

### LOW

**F-R40-002 — dqGrade-C-Zeilen, die NUR für R40 qualifizierten, verschwinden ganz vom Dashboard**
- **Datei:** `generate-screener.js:549` (hardGated-Kette listet nur 'D'), `:644`
  (F-05-Block), `:666` (WATCH nur bei NEAR_MISS in HG/QC/BF), `:3774-3777` (renderHTML
  behält nur getabbte Ticker in rowsByTicker).
- **Mechanismus (1 Satz):** Der F-05-Kommentar behauptet C-Zeilen blieben "in WATCH
  sichtbar", aber dqGrade==='C' ist nicht in hardGated (kein forced-WATCH) und WATCH
  erfordert NEAR_MISS — eine R40-only-C-Zeile matcht keinen Tab mehr und wird in
  renderHTML komplett aus dem HTML-Payload gedroppt.
- **Fix:** Wenn WATCH-Sichtbarkeit gewollt: C-Zeilen, die aus allen Quality-Tabs
  geblockt sind, mit watchReason 'DATA-C' in tabs.WATCH pushen; sonst den Kommentar
  korrigieren (Zeilen werden gedroppt, nicht in WATCH gezeigt).
- **Verdikt:** LOW-unverified (Mechanismus hier code-bestätigt: Z.3774-3777 behält nur
  `tabbedTickers`). Teilt Wurzel mit F-R40-001 (beide aus der Zeile-644-F-05-Änderung),
  gegenläufiger Effekt (Export unter-filtert, Dashboard über-droppt).
- **regression_of:** 13d89e26a (Tag 239).

**F-ME-103 — TURNAROUND-Score kann Tier A erreichen, obwohl beide profitability-Methoden incomputable sind**
- **Datei:** `methods/score-aggregator.js:248-259` (Coverage-Normalisierung über
  `computedWeight`, minCoverage TURNAROUND 0.40), `:119-121` (normalizeMethodScore:
  String-Threshold + pass===false → 0.0, pass===true → 1.0).
- **Mechanismus (1 Satz):** Der Score normalisiert nur über computable Gewicht; sind
  profitability-state (0.25) + profitability-trend (0.25) = 0.50 beide incomputable,
  liegt computedWeight/totalWeight = 0.50 ≥ 0.40 → score/tier='A' ganz ohne
  Profitabilitäts-Signal, während das Mode-Gate (acceptValues) sie separat prüft →
  Score und Gate können divergieren.
- **Fix:** Für TURNAROUND profitability-state/-trend als pflicht-für-Score behandeln:
  ist eine der beiden incomputable, Coverage-Gate auf >0.50 anheben oder score=null/REJECT
  mit reason='insufficient-coverage' (analog HG-Sonderbehandlung). HG/QC/BUFFETT NICHT
  anfassen (Anchor-Hash-Stabilität — TURNAROUND ist nicht im Anchor-Set).
- **Verdikt:** LOW-unverified (Mechanismus hier code-bestätigt: Z.248-259 + 119-121).
  Sichtbarkeits-/Design-Schwäche; das Mode-Gate verhindert i.d.R. passed:true, aber
  score/tier werden unabhängig exponiert (modes-report, Dashboard-Badges).
- **regression_of:** null.

**F-F4-003 — Form-4-Pagination ohne per-Ticker-Fetch-Cap; verlässt sich allein auf SEC filingTo**
- **Datei:** `scripts/pull-insider-form4.js:323-336` (`_filingsCoveringLookback`,
  einzige Schranke `if (fmeta.filingTo && !_withinLookback(...)) continue;` Z.326),
  `:354-393` (`pullTickerForm4`-Dokument-Fetch-Loop ohne Cap).
- **Mechanismus (1 Satz):** Fehlt `filingTo` auf einem Page-Eintrag, kurzschließt der
  Guard zu false (kein continue) und die Page wird geholt; für High-Volume-Filer löst
  jedes in-window-Filing einen ungedeckelten Dokument-Fetch (httpGet + 125ms) aus —
  der errors>25-Abbruch greift nicht, da dies *erfolgreiche* Fetches sind.
- **Fix:** Harten Page-Cap (z.B. max 3-4 Folge-Pages, reicht für 180d) und/oder
  per-Ticker-Dokument-Fetch-Ceiling einführen (analog MAX_POSITIONS_PER_FILING im
  13f-Skript); fehlendes `fmeta.filingTo` konservativ als skip behandeln, sobald Cap steht.
- **Verdikt:** T2, LOW-unverified (Mechanismus hier code-bestätigt). Politeness/Runtime
  gegen SEC 10 req/s/IP, kein Korrektheitsbug, kein Test deckt
  `_filingsCoveringLookback` ab.
- **regression_of:** 13d89e26a (Tag 239).

**F-MANIP-001 — manipulation-filters paart unabhängig kompaktierte Quartals-/Jahres-Arrays (diagnose-only)**
- **Datei:** `manipulation-filters.js:52-55` (`_arrayValues` kompaktiert nulls
  unabhängig), `:79-102, 107-137, 142-168` (Filter paaren grossProfitQ[i]/revenueQ[i]
  bzw. annualOpInc[i]/annualNetIncome[i] positionell).
- **Mechanismus (1 Satz):** `_arrayValues` droppt nulls je Metrik unabhängig und
  kollabiert Index-Positionen; danach paart der Code gp[i]/rev[i] aus divergent
  kompaktierten Arrays → unterschiedliche Kalenderquartale → falsche per-Quartal-GM und
  StdDev (GM_HIGH_VOLATILITY_HARDWARE u.a.).
- **Fix:** Unabhängige `_arrayValues`-Kompaktierung durch index-ausgerichtete Extraktion
  ersetzen: Roh-Arrays ZUERST positionell zippen (Eintrag nur behalten, wenn BEIDE
  Serien am selben Index i finite sind), dann rechnen — für alle vier Filter.
- **Verdikt:** T2, LOW-unverified. **Scope hier verifiziert: NICHT live** —
  `manipulation-filters.js` wird nur von `score-orchestrator.js`, `diagnose-spec.js`,
  `engine-cli-tests.js` requiret (Grep bestätigt), nicht von generate-screener.js /
  snapshot-methods-history.js / methods-runner. Keine Wirkung auf screener.html,
  methods-history oder Scoring — rein diagnostisch.
- **regression_of:** null (Pattern ist Tag 8; Tag 238 ändert Null-Verteilung, führte die
  Lücke nicht ein und machte keinen zuvor-korrekten Consumer falsch).

**F-GS-001 — Detail-Modal paart annual.rev[i] mit opInc[i]/gp[i]/netIncome[i] ohne Fiskaljahr-Check (display-only)**
- **Datei:** `generate-screener.js:410-417` (buildRow speichert flach via arrUnwrap.slice),
  `:2342-2344` (Client omSeries opInc[i]/rev[i]), `:2381-2395` (Annual-Financials-Tabelle).
- **Mechanismus (1 Satz):** Das Client-Template rechnet per-Jahr-Margins per Roh-Index
  und nimmt stillschweigend an, annualRev[i]/annualOpInc[i]/annualGP[i]/annualNetIncome[i]
  referenzieren dasselbe Fiskaljahr; bei in Live-Daten unterschiedlich langen
  Native-Source-Arrays (~115 Ticker, meist HK/foreign) ergeben sich falsche
  GrossM%/OpM%/NetIncM% und Margin-Sparklines.
- **Fix:** Vor dem Paaren nach Fiskaljahr ausrichten: year→{rev,opInc,gp,fcf,ni}-Map auf
  endDate/fiscalYear keyen, Zeilen aus den unionierten sortierten Jahren rendern.
  Minimal: bei Längendifferenz nur Indizes rendern, an denen alle nötigen Serien einen
  Eintrag haben, oder die Jahres-Zelle mit endDate annotieren.
- **Verdikt:** T2, LOW-unverified. Display-only (Detail-Modal); kein Effekt auf
  Mode-Scores, pass/fail oder Filter-Set (Scoring nutzt die gewrappten {value,endDate}).
- **regression_of:** null (Index-Pairing seit Tag 198; Längen-Mismatch ist
  vorbestehende Yahoo-Mapping-Eigenschaft. Tag-238-F-004 reduziert sogar eine Klasse
  dieser Fehlausrichtung. Zur Vollständigkeit gemeldet, kein Tag-238-Regress).

## Widerlegte Findings

- **F-METH-001** (altman-z-score X4-Floor-Explosion, `methods/altman-z-score.js:93-98`):
  Mechanismus real, aber IMPACT falsch — kein Screening-/Score-Effekt; Legacy 'totalLiab'
  in 0 Snapshots vorhanden, Pfad nicht erreicht. Pfadangabe des Findings (strategy-modes.js)
  zeigt zudem auf `methods/strategy-modes.js:154`. Abgelehnt.

## Dedup-Notiz

- **F-R40-001 + F-R40-002** teilen dieselbe Wurzel (die Tag-239-F-05-Änderung an
  `generate-screener.js:644`), sind aber distinkte Stellen mit gegenläufigem Effekt
  (Export unter-filtert dqGrade-C / Dashboard über-droppt R40-only-C). Bleiben getrennt,
  werden aber im selben Batch gefixt.
- **F-DP-101** ist die noch offene Instanz der Array-Alignment-Klasse, deren Geschwister
  (F-DP-030/031 financials-Loop, F-DP-003 balance-Loop) bereits gefixt sind — gleicher
  Fix-Pattern (Null-erhaltende Extraktion), andere Code-Stelle (cash-Loop OCF/FCF).
- **F-MANIP-001 + F-GS-001** sind beide Array-Pairing-ohne-Alignment, aber in
  getrennten, NICHT-live Pfaden (Diagnose-Tool bzw. Display-Modal) und keine
  Tag-237-240-Regression — separat, niedrigste Priorität.
- Keine echten Duplikate (gleiche file:line) im Set.

## Fix-Reihenfolge (Batches mit Test-Gate-Hinweis)

**Test-Gate-Architektur (verifiziert):**
- `tests/fixture-hash.txt` = `fd4a13856b18fc7b` — Hash über engine-Fixtures durch
  SCORE_WEIGHTS-Methoden. Bewegt sich nur, wenn eine *scoring-teilnehmende* Methode auf
  dem Fixture-Set ein anderes Ergebnis liefert.
- `tests/integration-anchor-test.js` — 10 Anchors (NVDA/MSFT/PLTR/META/COST/GOOG/AVGO/V/
  CRDO/MELI) müssen ihren Tier-Floor halten.
- `tag28-tests.js` — Methoden-Smoke-Tests; diagnostische Methoden explizit als
  "fixture-hash invariant safe" markiert.

**Batch 1 — Sofort, hash-sicher (Sicherheits-/Contract-Fixes):**
1. **F-PY-102 Teilfix (1):** Retry-Klassifizierung auf `isRateLimit` einschränken
   (Timeout nicht mehr retryen), `pull-yahoo.js:1295`. Reiner Control-Flow im Pull, kein
   Fixture-Bezug. **Ändert Fixture-Hash? NEIN.** Verifikation: Pull-Smoke + Run-Log
   beobachten (Durchsatz unter Throttling).
2. **F-R40-001:** `|| r.dqGrade === 'C'` in `generate-screener.js:4029-4031` UND
   `scripts/build-r40-latest.js:56-58`. Betrifft nur den r40-latest.json-Export, nicht
   Scoring/Tabs. **Ändert Fixture-Hash? NEIN** (kein Methoden-Output, kein Anchor-Pfad).
   Verifikation: `node generate-screener.js` neu laufen lassen, r40-latest.json-Count
   vorher/nachher diffen (erwartet: leicht kleiner; alle entfernten Einträge dqGrade==='C').
3. **F-R40-002:** im selben Batch — entweder C-Zeilen mit watchReason 'DATA-C' in
   tabs.WATCH pushen (`generate-screener.js` ~Z.644/666) ODER Kommentar Z.639-643
   korrigieren. **Ändert Fixture-Hash? NEIN** (Tab-Klassifizierung, kein SCORE_WEIGHTS).
   **Anchor-Test:** unbetroffen (Anchors sind nicht dqGrade C). Verifikation:
   integration-anchor-test.js grün + Stichprobe einer R40-only-C-Ticker-Sichtbarkeit.

**Batch 2 — Korrektheits-Kern, hash-sicher erwartet, ABER Anchor-Test pflicht:**
4. **F-DP-101:** OCF/FCF in `pull-yahoo.js` über `_ftsExtractByYear` bauen (statt
   skip-basiertem cash-Loop), `mapFTSToAnnual` Z.1086-1099 + Zuweisung Z.1874-1875
   angleichen. **Ändert Fixture-Hash? NEIN erwartet** — die tag28-Fixtures bauen
   annualOCF aus annualFCF+|Capex| ohne mittleres OCF-Loch (Z.2293), die Verifier
   bestätigen "Fixture hat keine OCF-Lücke → Hash bleibt stabil". **MUSS dennoch gegen
   `tests/fixture-hash.txt` UND `integration-anchor-test.js` laufen** (reinvestment-rate
   ist QC-MUST 0.15; MSFT/COST/V/GOOG/AVGO/META sind QC-Anchors). Real-Daten-Verifikation:
   reinvestment-rate über alle Snapshots vorher/nachher diffen — erwartet 0 geänderte
   computable-.values im aktuellen Datensatz (Inzidenz dormant), nur künftige
   OCF-Loch-Ticker werden korrekt.

**Batch 3 — LOW, optional, je nach Zeit:**
5. **F-ME-103:** TURNAROUND-Coverage-Sonderfall in `methods/score-aggregator.js`
   (>0.50 oder score=null bei incomputable profitability). **Ändert Fixture-Hash? NUR
   falls TURNAROUND-Fixtures existieren** — TURNAROUND ist NICHT im Anchor-Set; HG/QC/
   BUFFETT-Pfade nicht anfassen. Verifikation: fixture-hash.txt prüfen (sollte stabil),
   sonst Hash bewusst neu setzen + dokumentieren.
6. **F-F4-003:** Page-Cap + per-Ticker-Fetch-Ceiling in `scripts/pull-insider-form4.js`.
   Eigenständiges Skript, **kein Fixture-Bezug. Hash unverändert.** Verifikation:
   tests/sec-form4-test.js grün + Lauf gegen einen High-Volume-Filer beobachten.

**Batch 4 — Nicht-live / display-only, niedrigste Priorität (kein Tag-237-240-Regress):**
7. **F-MANIP-001:** index-ausgerichtetes Zippen in `manipulation-filters.js`. Diagnose-only.
   **Kein Fixture-Hash-Bezug** (nicht in SCORE_WEIGHTS / nicht live). Verifikation:
   engine-cli-tests.js / diagnose-spec.js.
8. **F-GS-001:** Fiskaljahr-Alignment im Detail-Modal (`generate-screener.js` Client-
   Template). Display-only. **Kein Fixture-Hash-Bezug** (Scoring nutzt gewrappte Objekte).
   Verifikation: visuelle Stichprobe (z.B. 0006.HK) im gerenderten screener.html.
