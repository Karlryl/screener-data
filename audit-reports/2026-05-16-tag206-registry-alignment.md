# Tag 206 — 4-Way Method-Registry Alignment Audit

**Agent C** — Method-Registry Alignment (post-Tag-205 drift check)

**Scope:** methods/*.js cross-referenced against `methods/index.js`, `methods/method-types.js` REGISTRY, `methods/score-aggregator.js` SCORE_WEIGHTS, and `methods/strategy-modes.js` (core/dataGuards/softGuards). Loader = `methods/runner.js`.

## Headline counts

- **Method files (with exported `id`):** 63
- **Entries in `methods/index.js`:** 63
- **Entries in REGISTRY (method-types.js):** 58 (CORE 13 / DIAGNOSTIC 30 / DATAGUARD 15)
- **Methods referenced in SCORE_WEIGHTS:** HG 6, QC 8, TURNAROUND 6 (12 distinct method ids; some shared)
- **Runner load logic:** `runner.js:16` iterates `methods/index.js` REGISTRY (explicit allow-list). Files not in `index.js` are silently NOT loaded.

## Alignment matrix

Legend: `—` = not present. REG type: C=CORE, D=DIAGNOSTIC, G=DATAGUARD, `?` = falls through to DIAGNOSTIC default via `getType()`.

| filename | exported id | in index.js | REGISTRY (type / dflt) | HG wt | QC wt | TR wt | DISABLED |
|---|---|---|---|---|---|---|---|
| above-200d-ma.js | above-200d-ma | yes | D / true | — | 0.05 | — | no |
| altman-z-score.js | altman-z-score | yes | **MISSING (?→D)** | — | — | 0.20 | no |
| asset-growth-divergence.js | asset-growth-divergence | yes | G / true | — | — | — | no |
| buyback-yield.js | buyback-yield | yes | D / true | — | — | — | no |
| capex-trend.js | capex-trend | yes | D / false | — | — | — | no |
| closed-end-trust-guard.js | closed-end-trust-guard | yes | G / true | — | — | — | no |
| deceleration-guard.js | deceleration-guard | yes | G / true | — | — | — | no |
| drawdown-52w.js | drawdown-52w | yes | D / false | — | — | — | no |
| earnings-stability.js | earnings-stability | yes | C / true | — | 0.15 | — | no |
| estimate-revision-proxy.js | estimate-revision-proxy | yes | **MISSING (?→D)** | — | — | 0.05 | no |
| ev-ebitda.js | ev-ebitda | yes | D / false | — | — | — | no |
| fcf-stability.js | fcf-stability | yes | D / true | — | — | — | no |
| fcf-yield.js | fcf-yield | yes | C / true | — | 0.05 | — | no |
| forecast-contamination-guard.js | forecast-contamination-guard | yes | G / true | — | — | — | no |
| forward-pe.js | forward-pe | yes | D / false | — | — | — | no |
| gross-margin-acceleration.js | gross-margin-acceleration | yes | D / true | — | — | — | no |
| gross-margin-stability.js | gross-margin-stability | yes | C / true | 0.10 | — | — | no |
| high-proximity-52w.js | high-proximity-52w | yes | D / false | — | — | — | no |
| hypergrowth-quality-class.js | hypergrowth-quality-class | yes | C / true | 0.15 | — | — | no |
| insider-buy-cluster.js | insider-buy-cluster | yes | **MISSING (?→D)** | — | — | — | no |
| insider-net-buying.js | insider-net-buying | yes | D / true | — | — | — | no |
| insider-ownership.js | insider-ownership | yes | D / false | — | — | — | no |
| listing-age.js | listing-age | yes | D / true | — | — | — | no |
| loss-magnitude-guard.js | loss-magnitude-guard | yes | G / true | — | — | — | no |
| margin-decay.js | margin-decay | yes | D / false | — | — | — | no |
| margin-quality.js | margin-quality | yes | C / true | — | 0.20 | — | no |
| metric-divergence-guard.js | metric-divergence-guard | yes | G / true | — | — | — | no |
| net-debt-ebitda.js | net-debt-ebitda | yes | **G / true** | — | **0.10** | — | no |
| net-income-volatility-guard.js | net-income-volatility-guard | yes | G / true | — | — | — | no |
| operating-cashflow-coverage.js | operating-cashflow-coverage | yes | D / true | — | — | — | no |
| operating-leverage.js | operating-leverage | yes | D / true | — | — | — | no |
| operating-margin-acceleration.js | operating-margin-acceleration | yes | D / true | — | — | — | no |
| opinc-margin-spike.js | opinc-margin-spike | yes | D / false | — | — | — | no |
| peg.js | peg | yes | D / false | — | — | — | no |
| piotroski-f-score.js | piotroski-f-score | yes | **MISSING (?→D)** | — | — | 0.15 | no |
| pre-commerciality-megacap-guard.js | pre-commerciality-megacap-guard | yes | G / true | — | — | — | no |
| premium-compounder-proof.js | premium-compounder-proof | yes | C / true | — | 0.05 | — | no |
| profitability-state.js | profitability-state | yes | C / true | 0.15 | — | 0.25 | no |
| profitability-trend.js | profitability-trend | yes | C / true | — | — | 0.25 | no |
| q-spike-dataguard.js | q-spike-dataguard | yes | G / true | — | — | — | no |
| quality-compounder-roic.js | quality-compounder-roic | yes | C / true | — | 0.25 | — | no |
| quarter-concentration-guard.js | quarter-concentration-guard | yes | G / true | — | — | — | no |
| quarterly-earnings-stability.js | quarterly-earnings-stability | yes | D / false | — | — | — | no |
| quarterly-revenue-acceleration.js | **quarterly-rev-acceleration** | yes (file) | **MISSING (?→D)** | — | — | — | no |
| r40-sanity-cap.js | r40-sanity-cap | yes | G / true | — | — | — | no |
| reinvestment-rate.js | reinvestment-rate | yes | C / true | — | 0.15 | — | no |
| revenue-acceleration-yoy.js | revenue-acceleration-yoy | yes | D / true | — | — | — | no |
| revenue-growth-3y.js | revenue-growth-3y | yes | C / true | 0.25 | — | 0.10 | no |
| revenue-quality.js | revenue-quality | yes | D / true | — | — | — | no |
| revenue-shock-guard.js | revenue-shock-guard | yes | G / true | — | — | — | no |
| revenue-volatility-guard.js | revenue-volatility-guard | yes | G / true | — | — | — | no |
| roic.js | roic | yes | C / true | — | — | — | no |
| roic-trend.js | roic-trend | yes | D / true | — | — | — | no |
| rule-of-40.js | rule-of-40 | yes | C / true | 0.25 | — | — | no |
| rule-of-x.js | rule-of-x | yes | D / false | 0.10 | — | — | no |
| sbc-growth-ratio.js | sbc-growth-ratio | yes | D / true | — | — | — | no |
| sbc-revenue.js | sbc-revenue | yes | D / false | — | — | — | no |
| sbc-trend.js | sbc-trend | yes | D / true | — | — | — | no |
| single-quarter-dependency.js | single-quarter-dependency | yes | D / true | — | — | — | no |
| sloan-ratio.js | sloan-ratio | yes | G / true | — | — | — | no |
| stable-quarterly-growth.js | stable-quarterly-growth | yes | D / false | — | — | — | no |
| volatility-annualized.js | volatility-annualized | yes | D / false | — | — | — | no |
| working-capital-anomaly.js | working-capital-anomaly | yes | D / true | — | — | — | no |

Utility modules (no `id`, library only): `data-quality.js`, `region-mapping.js`, `sector-median-lookup.js`, `trend.js`. Not loaded by runner (not in index.js). Consistent.

## Inconsistencies (ranked by severity)

### CRITICAL

**[C1] net-debt-ebitda — DATAGUARD type but used as scoring input AND as softGuard.**
- `method-types.js:73` declares it `DATAGUARD / defaultActive:true`.
- `score-aggregator.js:46` assigns it weight 0.10 in QUALITY_COMPOUNDER.
- `strategy-modes.js:113` lists it as `must` in QC `core[]`.
- `strategy-modes.js:143` lists it as `softGuards[]` in TURNAROUND (a DATAGUARD-typed method should NOT appear in softGuards — semantic contradiction).
- However QC `dataGuards[]` (line 116) does **not** include it, so it is never enforced as a hard guard. The DATAGUARD type is therefore vestigial.
- **Fix:** reclassify to `CORE` in `method-types.js:73`, since it is treated as a scoring/must input everywhere it is actually consumed.

### HIGH

**[H1] altman-z-score, piotroski-f-score, estimate-revision-proxy — used in SCORE_WEIGHTS but missing from REGISTRY.**
- Each method file exists and is loaded via `index.js:52-56`.
- `score-aggregator.js:54-57` assigns weights (0.20, 0.15, 0.05) to TURNAROUND mode.
- REGISTRY (`method-types.js:12-80`) has no entries → `getType()` falls back to DIAGNOSTIC, `isDefaultActive()` returns `false`.
- Net effect: Runner evaluates them only when caller does NOT pass `onlyDefault:true`. In the current pipeline calls Karl uses they DO get evaluated, but the contract is fragile — any future call with `onlyDefault:true` silently drops a 0.20-weight TURNAROUND input.
- **Fix:** add explicit CORE entries at `method-types.js` around line 27 (after `premium-compounder-proof`):
  ```js
  'altman-z-score':           { type: 'CORE', defaultActive: true, reason: 'Tag 140: TURNAROUND distress filter' },
  'piotroski-f-score':        { type: 'CORE', defaultActive: true, reason: 'Tag 140: TURNAROUND quality signal' },
  'estimate-revision-proxy':  { type: 'CORE', defaultActive: true, reason: 'Tag 141: TURNAROUND momentum signal' },
  ```

**[H2] quarterly-revenue-acceleration.js — exported id `quarterly-rev-acceleration` (truncated).**
- `methods/quarterly-revenue-acceleration.js:4` declares `const ID = 'quarterly-rev-acceleration';` (note: `rev` not `revenue`).
- Filename uses full `revenue`; only `index.js:67` references the filename, so the runner loads it fine.
- But REGISTRY, SCORE_WEIGHTS, strategy-modes have neither `quarterly-revenue-acceleration` nor `quarterly-rev-acceleration` → falls to DIAGNOSTIC default. Method is fully orphaned: loaded but never read.
- **Fix:** rename the constant at `methods/quarterly-revenue-acceleration.js:4` to `'quarterly-revenue-acceleration'`, then add a REGISTRY entry as DIAGNOSTIC.

### MEDIUM

**[M1] insider-buy-cluster — file loaded, no REGISTRY entry, no consumer.**
- `index.js:98` loads `./insider-buy-cluster.js` (Tag 137).
- Not in REGISTRY → defaults to DIAGNOSTIC.
- Not in SCORE_WEIGHTS, not in any strategy-modes `core/dataGuards/softGuards`, not in `generate-screener.js` hardGated chain.
- Method runs but result is unread.
- **Fix:** add explicit DIAGNOSTIC entry in `method-types.js` (around line 53 near `insider-net-buying`):
  ```js
  'insider-buy-cluster': { type: 'DIAGNOSTIC', defaultActive: true, reason: 'Tag 137: Insider buy cluster signal' },
  ```

**[M2] asset-growth-divergence — DATAGUARD type used as softGuard in QC.**
- `method-types.js:74` declares it `DATAGUARD / defaultActive:true`.
- `strategy-modes.js:118` lists it in QC `softGuards[]` (and applies SOFT_GUARD_PENALTY of 8 in score-aggregator).
- DATAGUARD semantics imply hard-fail on `pass:false`, but in QC only a soft penalty is applied → semantic mismatch; in HG/TURNAROUND it never even appears in dataGuards arrays.
- **Fix:** Document the dual-use intent OR split: rename type to DIAGNOSTIC and rely solely on per-mode dataGuards arrays. At minimum, add a comment at `method-types.js:74` clarifying QC treats it as soft.

### LOW

**[L1] `runner.js:34` `MT.isDisabled(mod.id)` filter happens AFTER duplicate-id check.**
- If a DISABLED id were ever re-added via a typo'd duplicate, the duplicate detector at `runner.js:30` throws first (correct). Not a bug, just an ordering note.

**[L2] HYPERGROWTH SCORE_WEIGHTS sum = 1.00; QC = 1.00; TURNAROUND = 1.00.** All sums verified clean. No drift.

## Cross-references verified clean

- All strategy-modes `dataGuards[]` ids are DATAGUARD type in REGISTRY.
- All strategy-modes `softGuards[]` ids exist as method files (with the asset-growth-divergence type caveat noted).
- All `hardGated` flag-sources in `generate-screener.js:399` map 1:1 to live REGISTRY DATAGUARD methods or computed result flags.
- 60 method-id symbols in score-weights / strategy-modes / hardGated all resolve to a loaded method file.
- Runner loader is registry-driven (`runner.js:16`); orphan files in `methods/` would silently NOT load — none found.
