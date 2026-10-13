# Tag 206 — End-to-End Ticker Trace (Agent B)

**Date:** 2026-05-16
**Scope:** NVDA, CRDO, MSFT, IONQ, GPT.AX traced through snapshot → gates → mode → tab → screener.html row.
**Method:** Static read-only of snapshots/methods/generator; live screener.html parsed via PowerShell (no `node` per constraints).

---

## Headline finding

The screener pipeline is structurally correct end-to-end for these 5 tickers, but `screener.html` on disk is **stale** (built 12:46:06 — generator code mtime 12:47:36, ~90 s newer). As a direct consequence **GPT.AX (REIT, fcfMarginTTM = 598.69%) sits in the R40 tab with R40 = 593.5% — exactly the artefact Karl reports**. The current `r40-sanity-cap` (Tag 205) would flag GPT.AX (F2: fcfMargin > 80%) and IONQ (F1: growth > 150% + OpInc < 0) once the dashboard is regenerated, but the field `r40SanityFail` is absent from every row payload in the served HTML, so the badge UI and the hard-gate filter both behave as if Tag 205 were not deployed. A second, longer-term gap is that the Tag 199–205 DataGuards are **not** wired into `strategy-modes.js → MODES.HYPERGROWTH.dataGuards / MODES.QUALITY_COMPOUNDER.dataGuards`; they only filter via the `classifyTabs` post-pass. Mode evaluation (and the mode scores users see) is therefore computed on stocks that should never have been scored.

---

## Per-ticker gate trace

Snapshot inputs (USD/AUD as reported):

| Ticker  | sector / industry           | mcap     | rev0       | oi0        | ni[0..3] swing   | revGrowth | fcfMargin | opMargin |
|---------|-----------------------------|----------|------------|------------|------------------|-----------|-----------|----------|
| NVDA    | Tech / Semis                | 5.37 T   | 215.94 B   | 130.39 B   | 47.2 B (Y0–Y1)   | 73.2 %    | 26.92 %   | 65.02 %  |
| CRDO    | Tech / Semis                | 36.6 B   | 436.78 M   | 37.997 M   | 80.55 M          | 201.5 %   | 16.13 %   | 36.76 %  |
| MSFT    | Tech / Software-Infra       | 3.03 T   | 281.72 B   | 128.53 B   | 15.78 B          | 18.3 %    | 11.63 %   | 46.33 %  |
| IONQ    | Tech / Computer-HW          | 20.85 B  | 130.02 M   | -633.72 M  | 178.73 M         | 754.7 %   | -48.83 %  | -401.76 %|
| GPT.AX  | Real Estate / REIT-Diversif | 5.85 B A | 806 M AUD  | 643.8 M    | 34.2 M           | -5.2 %    | **598.69 %** | 61.47 % |

Gate verdicts (computed vs `screener.html` payload):

| Ticker  | q-spike | loss-mag | metric-div | ni-vol   | pre-comm-megacap | closed-end-trust | r40-sanity        | hg-class    | hgTier | qcTier   | landed in tabs           |
|---------|---------|----------|------------|----------|------------------|------------------|-------------------|-------------|--------|----------|--------------------------|
| NVDA    | PASS    | PASS     | PASS       | PASS     | PASS             | PASS             | PASS              | REAL_ACC    | A      | A        | HG, QC, R40              |
| CRDO    | PASS    | PASS     | PASS       | PASS     | PASS             | PASS             | PASS (carve-out)  | REAL_ACC    | A      | NEAR_MISS| HG, QC, R40, PRE_BR, WATCH|
| MSFT    | PASS    | PASS     | PASS       | PASS     | PASS             | PASS             | PASS              | NOT_HG      | REJECT | A        | QC                       |
| IONQ    | FAIL*   | **FAIL** | PASS       | **FAIL** | PASS             | PASS             | **FAIL (F1, F3)** | Q_SPIKE_FAKE| —      | REJECT   | WATCH                    |
| GPT.AX  | PASS    | PASS     | PASS       | PASS     | PASS             | PASS             | **FAIL (F2, F3)** | NOT_HG      | —      | REJECT   | **R40**                  |

*IONQ: `q-spike-dataguard` returns `pass:false` via the `EXCLUDED_TICKERS` early-return (quantum-computing allow-list), not via the threshold logic.

---

## Discrepancy section (computed vs served screener.html)

1. **`r40SanityFail` field is missing on every row.** PowerShell-parsing the embedded `SCREENER_DATA` shows `r40SanityFail` is **not** a NoteProperty of any ticker (NVDA, CRDO, MSFT, IONQ, GPT.AX inspected). The row literal in `generate-screener.js:334` lists it, so the served HTML is from an earlier generator. The badge in `screener.html:480` (`if (r.r40SanityFail) sigBadges.push(...)`) never lights.
2. **GPT.AX in R40 tab.** Even with the current (un-rendered) generator, GPT.AX would be hard-gated by `r40-sanity-cap` (F2 fcfMargin = 598.7 > 80; F3 |61.47 − 598.69| = 537pp > 50). In the served HTML it shows R40 = 593.5 and lives in the R40 universe — top-of-list-poisoning risk.
3. **IONQ `hgTier` is missing entirely.** Confirmed by PowerShell NoteProperty dump: `hgTier` is absent (so is `r40SanityFail`). `hgScore = null` is serialised, but `hgTier` is dropped — `modeEvals.HYPERGROWTH.tier` is `undefined` (likely because IONQ fails sector exclude or dataGuards in HYPERGROWTH, so `evaluateMode` returns the early `{passed:false, reason:'...'}` object without `tier`). JSON.stringify drops it. Not a correctness bug for IONQ (it's still WATCH-only), but the row shape is inconsistent.
4. **`hgClass = "Q_SPIKE_FAKE"` is set on IONQ** correctly (so `hgClassFail = true` in `classifyTabs`). Good.

---

## Confirmed bugs (ranked by severity)

### #1 — CRITICAL: `screener.html` is stale; Tag 205 R40-Sanity payload missing
- **Where:** `screener.html` (whole file) — generated 12:46:06; `generate-screener.js` last touched 12:47:36.
- **Effect:** GPT.AX (and any other R40-poisoning candidate that would be caught by Tag 205) is currently surfaced in the R40 tab. The R40-SANITY badge in the UI also never renders.
- **Fix:** Regenerate `screener.html` after every edit to `generate-screener.js`/`methods/*`. Add a freshness gate / mtime check in CI; the recent Tag 192 "snapshot freshness gate" pattern can be reused for derived artefacts.

### #2 — HIGH: Tag 199–205 DataGuards not in `MODES.*.dataGuards`
- **Where:** `methods/strategy-modes.js:90` (HYPERGROWTH `dataGuards`), `:116` (QUALITY_COMPOUNDER `dataGuards`).
- **Effect:** `loss-magnitude-guard`, `metric-divergence-guard`, `ni-volatility-guard`, `pre-commerciality-megacap-guard`, `closed-end-trust-guard`, `r40-sanity-cap` only filter through `classifyTabs` (post-scoring). Mode scores (e.g. IONQ `qcScore = 39`, GPT.AX `qcScore` non-null) are computed for stocks that should never have been scored. Score-history (Tag 202/203) records "scores" for narrative-loss stocks.
- **Fix:** Add the six gate ids to `MODES.HYPERGROWTH.dataGuards` and `MODES.QUALITY_COMPOUNDER.dataGuards` arrays. This is a one-line registry edit per mode.

### #3 — HIGH: `closed-end-trust-guard` does not catch REITs
- **Where:** `methods/closed-end-trust-guard.js:77-84` (`TRUST_INDUSTRY_TOKENS` lacks `'reit'`, `'real estate'`); `:86` (`FIN_SECTOR = 'financial services'` only).
- **Effect:** GPT.AX (industry = "REIT - Diversified", sector = "Real Estate") gets 0 signals. The whole REIT universe slips this guard. The fix would protect against the Yahoo `freeCashflow`-includes-property-disposition artefact that produces fcfMargin = 598.69 %.
- **Fix:** Add `'reit'`, `'real estate'` to `TRUST_INDUSTRY_TOKENS`; add `'real estate'` as a second valid sector for the S2/S4 ratio checks; tune `REV_ASSETS_FLOOR` for REITs (rent-yield property is structurally low rev/assets but is a real operating model — pair with the FCF/Assets check). Alternative: a dedicated `reit-guard` is cleaner than overloading this one.

### #4 — HIGH: GPT.AX `fcfMarginTTM = 598.69 %` has no clamp in `pull-yahoo.js`
- **Where:** `pull-yahoo.js:542` — `const fcfMarginTTM = (fcfTTM != null && revTTM && revTTM !== 0) ? (fcfTTM / revTTM) * 100 : null;`
- **Effect:** Whatever Yahoo returns for `freeCashflow` (here ~AUD 6.21 B vs revTTM AUD 1.038 B — likely includes asset-disposition cash) flows through unflagged. Downstream R40, score-aggregator, and PRE-Breakout score all consume the inflated value.
- **Fix:** When `Math.abs(fcfMarginTTM) > 200`, attach a `validation.issues` entry (`code:'fcf_margin_out_of_band'`) and **either** null the field **or** cap it (e.g. clamp to ±200 and surface `validation.warnings`). The existing `validation.issues` plumbing (line 150 of `q-spike-dataguard.js` already reads `q_rev_guidance_suspect`) is the right channel.

### #5 — MEDIUM: Threshold-operator inconsistency in `net-income-volatility-guard`
- **Where:** `methods/net-income-volatility-guard.js:51,107` — module exports `THRESHOLD_OP = 'lte'` but the eval uses `ratio < THRESHOLD` (strict less-than). For `ratio === 1.0`, the guard fails, but the reported `thresholdOp = 'lte'` says it should pass.
- **Effect:** Off-by-epsilon for stocks at exactly 1.0× rev volatility (rare); also poisons graduated-scoring in `score-aggregator.normalizeMethodScore` which trusts the `thresholdOp` to decide `op` direction.
- **Fix:** Change `:107` to `const pass = ratio <= THRESHOLD;` so the comparator matches the declared op. Equivalent and safer: declare `THRESHOLD_OP = 'lt'` consistently.

---

## Additional findings (lower severity)

- **No FX conversion in $-floor guards:** `loss-magnitude-guard`, `pre-commerciality-megacap-guard`, `ni-volatility-guard`, `metric-divergence-guard` all read raw `annual.annualRev[0]` and `marketCap` without `meta.reportingCurrency` conversion. Thresholds are USD-named ($100 M revenue floor, $1 B mcap floor, $/rev ratios) but applied to JPY/AUD/CNY/INR numbers. For our 5 tickers nothing flips (rev/mcap dwarf the floors), but a Japanese pre-revenue narrative megacap with mcap ¥150 B (~$1 B USD) and rev ¥10 B (~$63 M USD) would slip the pre-commerciality gate because ¥10 B > $100 M floor. `fx-rates.json` exists and is loaded elsewhere; route it through these guards.
- **IONQ excluded-ticker mechanism:** `q-spike-dataguard.js:39-41` hard-codes IONQ/RGTI/QBTS/QUBT and returns `pass:false` for them. This contradicts the "no hardcoded tickers" commitment in the module header; the gate isn't pattern-based for these names. Cosmetic only — it does fail IONQ as intended — but the policy invariant is broken.
- **`scripts/walk-forward-perf.js` and `snapshot-picks.js` have uncommitted modifications** (per `git status`). Not part of this trace but worth a separate look.

---

## Proposed concrete code changes (one diff per bug)

**Bug #1 (regen):**
```bash
# In CI / pre-publish step:
node generate-screener.js && touch screener.html
# Add a make/npm script that fails if screener.html mtime < newest *.js mtime under methods/ or generate-screener.js
```

**Bug #2 (`strategy-modes.js:90,116`):**
```diff
-  dataGuards: ['sloan-ratio', 'forecast-contamination-guard', 'q-spike-dataguard', 'revenue-volatility-guard'],
+  dataGuards: ['sloan-ratio', 'forecast-contamination-guard', 'q-spike-dataguard', 'revenue-volatility-guard',
+               'loss-magnitude-guard', 'metric-divergence-guard', 'net-income-volatility-guard',
+               'pre-commerciality-megacap-guard', 'closed-end-trust-guard', 'r40-sanity-cap'],
```
(and similarly for `QUALITY_COMPOUNDER`)

**Bug #3 (`closed-end-trust-guard.js:77-86`):**
```diff
 const TRUST_INDUSTRY_TOKENS = [
   'asset management', 'investment trust', 'closed-end fund', 'closed end fund',
-  'holding company', 'capital markets'
+  'holding company', 'capital markets', 'reit', 'real estate'
 ];
-const FIN_SECTOR = 'financial services';
+const FIN_SECTORS = new Set(['financial services', 'real estate']);
```
(and replace `sector === FIN_SECTOR` with `FIN_SECTORS.has(sector)`)

**Bug #4 (`pull-yahoo.js:542`):**
```diff
-const fcfMarginTTM = (fcfTTM != null && revTTM && revTTM !== 0) ? (fcfTTM / revTTM) * 100 : null;
+let fcfMarginTTM = (fcfTTM != null && revTTM && revTTM !== 0) ? (fcfTTM / revTTM) * 100 : null;
+if (fcfMarginTTM != null && Math.abs(fcfMarginTTM) > 200) {
+  (validation.warnings = validation.warnings || []).push({ code: 'fcf_margin_out_of_band', value: fcfMarginTTM });
+  fcfMarginTTM = null;  // refuse the artefact rather than propagate it
+}
```

**Bug #5 (`net-income-volatility-guard.js:107`):**
```diff
-const pass = ratio < THRESHOLD;
+const pass = ratio <= THRESHOLD;
```
