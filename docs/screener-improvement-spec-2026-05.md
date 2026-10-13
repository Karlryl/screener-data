# Screener Improvement Spec — Tag 205 (2026-05)

Autonome Umsetzung in 3 Workstreams. So viele parallele Subagenten wie sinnvoll.
Erst Plan/Spec pro Workstream, dann SOFORTIGE Umsetzung — NICHT um Erlaubnis fragen,
durcharbeiten bis verifiziert grün. Superpowers-Skills befolgen (brainstorming →
writing-plans → test-driven-development → verification-before-completion). Ein Commit
pro Workstream (A, B, C) mit Co-Authored-By.

Repo: `C:\Users\Karlr\OneDrive\Dokumente\GitHub\screener-data`

## OPERATING PROTOCOL
- `dispatching-parallel-agents` für unabhängige Teilaufgaben; `subagent-driven-development` für Implementierung.
- Nichts ist fertig ohne Beweis: `node generate-screener.js` exit 0 + Tab-Counts im Output + Method-Tests grün. Keine Erfolgsmeldung ohne Befehlsausgabe.
- Bei echter Mehrdeutigkeit: vernünftige Annahme treffen und im Commit dokumentieren, statt anzuhalten.

## PHASE 0 — GROUNDING (zuerst lesen, nicht überspringen)
`generate-screener.js` (Tab-Logik Z.490-656, Spalten Z.1464-1524, Row-HTML Z.1625-1739, Explainer Z.1742-1750, Modal Z.2072-2426, KI_INFRA-Seed Z.31-39); `methods/index.js` (Registry Z.23-256); `methods/runner.js`; `methods/insider-buy-cluster.js`, `insider-net-buying.js`, `insider-ownership.js`; `scripts/pull-insider-form4.js`; `pull-yahoo.js` (insiderActivity Z.653-715); `filter-config.json`; `ki-infra.json`; `.github/workflows/daily-pull.yml` (Step-Reihenfolge, timeout 240min).

---

## WORKSTREAM A — INSIDER-BUYING TAB (höchste Priorität, neu)
Ziel: Eigener Tab `INSIDER_BUYING` (gespiegelt nach KI_INFRA-Muster), der Aktien mit echtem, hochkonviktem Insider-Kaufsignal aus SEC-Form-4-Daten zeigt. Hintergrund: Yahoo deckt nur 0,7 % der Snapshots mit Insider-Daten ab → SEC EDGAR ist die einzige tragfähige Quelle.

### A1. DATEN-PIPELINE (SEC EDGAR, nicht Yahoo)
- **`scripts/pull-insider-form4-daily.js`**: lädt den SEC Daily-Index
  `https://www.sec.gov/Archives/edgar/daily-index/{YYYY}/QTR{n}/form.{YYYYMMDD}.idx`
  (1 Request = alle ~2.000-4.500 Form-4 des Tages, fixed-width: Form|Company|CIK|Date|FileName), filtert `form=="4"` ∩ Ticker-Universum, holt je Treffer
  `https://www.sec.gov/Archives/edgar/data/{CIK}/{ACCESSION-mit-Bindestrichen}.txt`
  (Form-4-XML inline, mit bestehendem `parseForm4Xml` aus pull-insider-form4.js parsen) und merged inkrementell in `external-data/sec-form4-cache.json`. **NICHT per-CIK iterieren** (das wären 4.800 Requests/Tag). Index wird ~22:00 ET gepostet → gestrigen Index ziehen.
- **`scripts/backfill-form345.js`**: lädt die Quartals-Datasets
  `https://www.sec.gov/files/structureddata/data/insider-transactions-data-sets/{YYYY}q{N}_form345.zip`
  für die letzten ~8 Quartale. TSV-Schema: `SUBMISSION.tsv` (PK ACCESSION_NUMBER; Felder FILING_DATE, PERIOD_OF_REPORT, ISSUERCIK, **ISSUERTRADINGSYMBOL** = Ticker direkt, AFF10B5ONE); `NONDERIV_TRANS.tsv` (TRANS_DATE, TRANS_CODE, TRANS_SHARES, TRANS_PRICEPERSHARE, TRANS_ACQUIRED_DISP_CD, SHRS_OWND_FOLWNG_TRANS); `REPORTINGOWNER.tsv` (RPTOWNERCIK, RPTOWNERNAME, RPTOWNER_RELATIONSHIP, RPTOWNER_TITLE). Join auf ISSUERTRADINGSYMBOL — kein CIK-Map nötig.
- **SEC-Regeln**: User-Agent `Name screener-data mail@example.com`, ≤10 req/s (125ms throttle), `Accept-Encoding: gzip, deflate`, atomic writes via `lib/atomic-write.js`, resumable. `data.sec.gov` und `www.sec.gov` sind getrennte Hosts (Rate pro Host).
- **Verdrahten**: `pull-insider-form4-daily.js` in `daily-pull.yml` VOR "Run Yahoo Pull", `timeout-minutes: 30`, `continue-on-error: true`.

### A2. SIGNAL-METHODE — `methods/insider-conviction-score.js` (in `methods/index.js` registrieren)
Nur Transaction-Code **P** (Open-Market-Kauf). A (Award) und M (Option-Exercise) komplett ausschließen — nicht bullish. Pro Ticker über 90-Tage-Fenster:
- **HARD GATE** (alle Bedingungen): ≥1 P-Kauf in 90d UND aggregierter Kaufwert ≥ $25.000 UND netto positiv (P-$ > S-$, 10b5-1-geflaggte Verkäufe ausgenommen) UND Filing-Lag ≤ 90d.
- **SCORE 0-100** (Summe, cap 100):
  - Rolle des größten Käufers **0-25**: CEO/Chair 25, CFO 22, Officer-Director 18, Director 10, nur 10%-Owner 4.
  - Cluster-Breite (distinct Insider im Fenster) **0-25**: 1→5, 2→14, 3→20, ≥4→25.
  - Conviction/Preislage **0-20**: Kauf nahe 52W-Tief (innerh. 15%)→20, Mitte→10, nahe 52W-Hoch→0-6. (Distanz-zum-52W-Hoch ist das stärkste Einzelfeature lt. Studie.)
  - % der bestehenden Holdings **0-20**: Erstkauf oder >20% Aufstockung→20, 10-20%→12, <10%→4. **Ersetzt** das nicht verfügbare Gehalts-Feature (Yahoo liefert kein Salary).
  - Opportunistic vs Routine **0-10**: Cohen-Malloy-Pomorski — "routine" = Insider, der im gleichen Kalendermonat in den 3 Vorjahren handelte (braucht ≥3J Historie pro RPTOWNERCIK aus dem Backfill); routine→0, opportunistic→10; bei zu wenig Historie als opportunistic behandeln, aber nur Teil-Punkte (z.B. 5).
- **ZEIT-DECAY-Multiplikator** auf Endscore: ×1.0 (≤30d), ×0.7 (31-90d), ×0.4 (91-180d). Returns front-loaden (~50% Alpha im ersten Monat).
- **Failure-Defenses**: P-only schützt vor Award/Exercise-Fehlklassifikation; 10b5-1-Verkäufe aus dem Netto-Gate ausschließen (Form-4-Checkbox seit 2023); $25k-Floor gegen Optik-Käufe; ≤90d-Lag-Gate gegen veraltete Filings.
- **TDD**: Fixtures (CEO-Cluster, Routine-Filer, Token-Buy, reiner Award, Netto-negativ trotz Käufen) schreiben BEVOR die Methode implementiert wird.
- Evidenz: Lakonishok-Lee (2001), Cohen-Malloy-Pomorski (2012, "Decoding Inside Information"), Jeng-Metrick-Zeckhauser (2003), Kang-Kim-Wang (2018, Cluster). Hinweis: Bei einem groß-/midcap-lastigen Universum ist das absolute Alpha kleiner — der Score dient als **Ranking**, nicht als Renditeversprechen.

### A3. NEUER TAB (exakt KI_INFRA-Muster spiegeln)
- `generate-screener.js`: Tab ist **datengetrieben** (kein JSON-Seed) — aufnehmen wer das Hard-Gate aus `row.results['insider-conviction-score']` besteht.
- `classifyTabs` (Z.490-656): `tabs.INSIDER_BUYING` hinzufügen; einsortieren wenn Gate bestanden; nach Score desc sortieren.
- `tabColumns` (Z.1464-1510): `[#, Ticker, Company, Score, Cluster, Top-Buyer-Role, Net$90d, LastBuy, R40, State]`.
- `BULLET_COLS` (Z.1516-1524): `'INSIDER_BUYING':['insiderScore','r40']`.
- `renderRow` (Z.1625-1739): Block analog KI_INFRA mit Score-Badge + Cluster-Count + Rolle + letztem Kaufdatum.
- `TAB_EXPLAINERS` (Z.1742-1750): erklären (SEC Form 4, P-Code, Conviction-Score, Decay).
- Detail-Modal (Z.2072-2426): neue Section "Insider Activity" nach der R40/RX-Section — Tabelle der letzten Käufe (Datum, Insider, Rolle, Shares, $, Code) + Score-Breakdown.

---

## WORKSTREAM B — RULE OF 40 / RULE OF X REFINEMENT
- `filter-config.json`: `rule_of_x.multiplier` 1.5 → **2.0**, `rule_of_x.threshold` 50 → **58**. Konfigurierbar lassen. (Literatur: Multiplikator 2.0-2.3×; Bessemer Rule-of-X korreliert mit Forward-EV/Rev bei R²≈0.62 vs 0.50 für R40.)
- `methods/rule-of-x.js`: neuen Multiplikator/Schwelle konsumieren.
- **Neue Methode `methods/rule-of-40-sbc-adjusted.js`**: R40 mit (FCF-Marge − SBC%-vom-Umsatz); **Flag** setzen wenn (FCF-Marge − EBITDA-Marge) > 15 Prozentpunkte (SBC-Inflation, z.B. Okta-Fall). In Modal + als Spalten-Flag im R40-Tab zeigen.
- **Q-Spike-Gate verschärfen**: zusätzlich verlangen, dass R40 in ≥3 der letzten 4 Quartale ≥40 war (nutze `r40rx-history/*.json`). Wo <4 Quartale vorliegen: nur TTM werten + flaggen. (McKinsey: Firmen clearen R40 nur ~16% der Zeit; Durability ist das wertprädiktive Signal.)
- **R40-Trend-Zerlegung**: pro Quartalsänderung Δgrowth vs Δmargin berechnen und im Modal-Chart anzeigen; growth-getriebene Anstiege grün, rein margen-getriebene gelb markieren (margengetriebenes R40 = Value-Trap-Risiko).
- TDD-Tests für jede neue Methode/Schwelle.

---

## WORKSTREAM C — AI-INFRASTRUCTURE EXPANSION
`ki-infra.json` erweitern + Tickers ins `watchlist.json` aufnehmen (damit tägl. Pull Snapshots zieht); danach `scripts/backfill-r40rx-history.js` + `node generate-screener.js` neu laufen lassen. Für sofortige Snapshots: gezielten Pull via `pull-yahoo.js --watchlist <temp>` für die neuen Tickers (Muster wie Tag 204e).
- **NEUER LAYER "On-Site Power"**: CAT, CMI, GNRC (+ vorhandene GEV/BWXT/OKLO querverweisen).
- **NEUER LAYER "Storage"**: SNDK, WDC, PSTG.
- Data Centers/Compute: AMKR.
- Power & Cooling: PH, ECL, AEIS, HUBB, FLEX, JBL.
- Supply Bottlenecks: STM, POWI, LIN, APD.
- Packaging & Semicap: BESI (BESI.AS), ASMPT (0522.HK), Advantest (6857.T), Disco (6146.T).
- International (Yahoo-Suffix; einzeln auf Datenverfügbarkeit prüfen, nur aufnehmen wenn Snapshot lädt): Delta 2308.TW, SK Hynix 000660.KS, Infineon IFX.DE, Schneider SU.PA, Foxconn 2317.TW, Unimicron 3037.TW, Shin-Etsu 4063.T.
- **Prune-KANDIDATEN nur FLAGGEN (nicht löschen)** mit kiNote "marginale AI-Exposure": CSCO, INTC, HPE, MXL, FCX, NNE — finale Entscheidung bleibt manuell.

---

## VERIFICATION GATE (vor jedem Commit)
1. `node generate-screener.js` → exit 0, Tab-Counts ausgeben (INSIDER_BUYING > 0, KI_INFRA ≥ vorher).
2. Method-Tests grün (`npm test` bzw. der Test-Runner des Repos).
3. Insider-Pipeline-Smoke: `scripts/pull-insider-form4-daily.js` für 1 Tag laufen lassen, Cache prüfen.
4. Keine Regression: HG/QC/R40/KI_INFRA-Tabs laden weiterhin, NVDA/CRDO/ALAB sichtbar.

## COMMIT-KADENZ
Ein Commit pro Workstream (A, B, C) mit aussagekräftiger Message + `Co-Authored-By`. Am Ende: Kurzreport — welche Tickers neu Snapshots haben, INSIDER_BUYING-Top-10, welche int. Tickers mangels Yahoo-Daten ausgelassen wurden.
