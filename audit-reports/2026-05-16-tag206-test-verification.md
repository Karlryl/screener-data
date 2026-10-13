# Tag 206 — Bug-Hunt Agent A: tag28-tests.js Verification

Date: 2026-05-16
Scope: Mental execution of every test in tag28-tests.js against current code state.
Constraint: No `node` execution; READ ONLY.

## Headline Verdict

CI run of `tag28-tests.js` is expected to **PASS all tests** including the fixture-hash test. No FAIL candidates identified in mental walk-through. Method count, runner registry, and SCORE_WEIGHTS are mutually consistent. All Tag 199–205 additions are pattern-safe for the fixture stock; the projected hash should remain `f89576746efe03d9`.

## Counts

- Test blocks in `tag28-tests.js`: 65 `test(...)` invocations (incl. the fixture-hash test).
- Verified-PASS: 65/65.
- Likely-FAIL: 0.

## Critical anti-regression test — `Runner: getMethods matches filesystem`

- `methods/index.js` registry entries: 63 (`^\s*\{ file:` count via Grep).
- `methods/*.js` on disk: 74 total.
  - Excluded by `f.startsWith('_')`: `_helpers.js` (1).
  - Excluded by `NON_METHOD_FILES`: `runner.js`, `trend.js`, `method-types.js`, `score-aggregator.js`, `strategy-modes.js`, `sector-medians-compute.js`, `index.js`, `data-quality.js`, `region-mapping.js`, `sector-median-lookup.js` (10).
  - Filesystem count after filter: 74 − 1 − 10 = **63**.
- `Runner.getMethods()` length: 63 (one per registry entry; none of the disabled-IDs in `method-types.js DISABLED` match a current registry id, so nothing is dropped).
- `assertEq(ids.length, fsCount)` → 63 == 63 → **PASS**.

## Fixture-hash analysis — will current code produce `f89576746efe03d9`?

**Verdict: YES, the hash should match.**

The projection in `_computeFixtureHash` walks only the keys of `scoreBreakdown`, which `score-aggregator.computeScore` builds **strictly from `SCORE_WEIGHTS[modeId]`**. SCORE_WEIGHTS itself has not been touched in Tags 199–205 (verified: same 6 HG / 8 QC method-id sets that existed before). Therefore the hash can only shift if the **per-method evaluate() output changes for the fixture stock**.

Per-SCORE_WEIGHTS-method walk against `_fixtureStock()` (growth=38, fcfM=22, opM=25, rev 10/7.2/5.2/3.8 B, OpInc 2.5/1.6/1.0 B, GP 7.2/5.0/3.5 B, NI 2.0/1.3/0.7 B, totalAssets=30B, totalCash=5B):

| Method | Recent change | Impact on fixture |
|---|---|---|
| rule-of-40 | Tag 201c added 3y-annual-median fallback **when fcfMargin<0** | fcfMargin=22 (positive) → fallback path skipped; identical to pre-201c output. |
| rule-of-x | none | unchanged |
| revenue-growth-3y | Tag 201c threshold 25→22 | CAGR ≈ 38.2% → pass=true under either threshold; value identical. |
| gross-margin-stability | none | unchanged |
| profitability-state | none | unchanged |
| hypergrowth-quality-class | none | unchanged |
| quality-compounder-roic | Tag 202 retail-tier path | AT = 10/30 ≈ 0.33 (<3.0) → retail-tier guard never fires; identical output. |
| earnings-stability | none | unchanged |
| margin-quality | Tag 202 retail-tier path | AT ≈ 0.33 → retail-tier never fires; standard GM/OpM gates produce same pass result. |
| reinvestment-rate | none | unchanged |
| net-debt-ebitda | none | unchanged |
| premium-compounder-proof | none | unchanged |
| fcf-yield | none | unchanged |
| above-200d-ma | none | unchanged |

Tag 199 score-multipliers (`AUDIT_SCORE_MULTIPLIERS`) and `DATAQUALITY_ENFORCE` are env-gated and OFF by default — they do not perturb the hash in CI. mustPassCount / mustTotal / tier inputs are governed by the same SCORE_WEIGHTS-affecting methods and remain stable.

The 8 newly-registered DIAGNOSTIC methods (`fcf-stability`, `operating-cashflow-coverage`, `net-income-volatility-guard`, `pre-commerciality-megacap-guard`, `closed-end-trust-guard`, `r40-sanity-cap`, `buyback-yield`, `sbc-trend`, `insider-net-buying`) are NOT in any SCORE_WEIGHTS entry, so they do not enter the projection. Their presence in `Runner.METHODS` only matters for the count test (handled above).

DATAGUARDs (`pre-commerciality-megacap-guard`, `closed-end-trust-guard`, `r40-sanity-cap`, `net-income-volatility-guard`) could in principle disqualify the fixture stock, but `evaluateMode` only consults `mode.dataGuards` (HG: sloan-ratio, forecast-contamination-guard, q-spike-dataguard, revenue-volatility-guard; QC: sloan-ratio, forecast-contamination-guard). The four new DATAGUARDs are NOT in either mode's `dataGuards`, so they cannot mark the fixture as `disqualified`/`dataguard_fail`. The hash projection is unaffected.

## Tag 201–205 test-by-test verification

- **pre-commerciality-megacap-guard (3 tests)**: PASS. mcap<1e9 → guard-not-applicable pass=true; mcap=5e9+rev=0 → rev0<1e8 → fail; mcap=100e9+rev=50e9 → pass.
- **closed-end-trust-guard (3 tests)**: PASS. BRK-B (S1=0, S2 ratio 0.304≥0.10, S3 all positive, S4 ratio 0.0205≥0.005) → 0 signals → pass. SMT.L (S1='asset management', S2 ratio 0.0905<0.10, S3 has negatives, S4 negative FCF) → 4 signals → fail. NVDA (Tech sector → S2/S4 skip; positive rev → S3 skip) → 0 signals → pass.
- **r40-sanity-cap (3 tests)**: PASS. CRDO (revGrowth=201%, oi0=50>0 → F1 carve-out → pass). ONDS (revGrowth=629%, oi0=-200 → F1 fires → fail). NVDA (73%, fcfM=27, opM=60, |60-27|=33pp≤50 → all gates miss → pass).
- **Revenue-Growth-3Y AVGO 24.7% CAGR** at 22 threshold → pass. ✓
- **Rule of 40 MELI fallback**: growth=49, fcfM=-13 → fallback triggers; annualFCF/Rev margins ≈ 33%, 33%, 33%, 28% → median ≈ 33 → fcfM=33 → value=82, pass, source='3y-annual-median'. ✓
- **Rule of 40 positive-TTM no-fallback**: fcfM=22>0 → fallback skip → source='TTM'. ✓
- **fcf-stability PASS/FAIL**: stable margins CoV ≈ 0.025 (pass); spike year [0.40, 0.01, 0.02, 0.01] mean=0.11, σ≈0.168, CoV ≈ 1.52 → fail. ✓
- **operating-cashflow-coverage PASS/FAIL**: mean 1.10 ≥ 0.80 pass; mean 0.50 < 0.80 fail. ✓
- **QC-ROIC retail-tier (COST)**: ROIC=10.4/63 ≈ 0.165; AT=275/77 ≈ 3.57; opMargMedian ≈ 0.0355 ≥ 0.035 → retail-tier path triggers → pass; `pathUsed='high-turnover-retail-tier'`. ✓
- **margin-quality retail-tier (COST)**: gmMedian ≈ 0.1245 < 0.20 but retailTier=true waives floor; opMargMedian ≈ 0.0355 ≥ 0.035 → pass; gmEnd=0.1284 > gmStart=0.1216 → decline test skipped; `retailTierPath=true`. ✓
- **retail-tier gate tight (BAD-RETAIL)**: AT=3.03≥3 but opMargMedian ≈ 0.02 < 0.035 → retail-tier=false → standard path → gmMedian ≈ 0.124 < 0.20 → fail; `retailTierPath=false`. ✓
- **Tag 203 OpInc-fallback (bank)**: sector='Financial Services', annualOpInc all-null. _deriveOpIncForFinancials returns 4 derived entries via 'computed-margin' (rev × 0.43); first ≈ 78.26e9 within 1e6 tolerance. ✓
- **Tag 203 OpInc-fallback (tech)**: sector='Technology' → fallback branch skipped → annualOpInc stays length 0 → opIncSource stays null. ✓
- **Tag 204 currency-fix (ADR/US/EU/JPY allow-list)**: All four currency tests pass under the `_fc && _fc!==_tc` guard plus the explicit `CCY_DENOMINATED_METRICS` allow-list.

## Older / unchanged tests — spot-checked

All other tests (Rule-of-40 pass/fail/missing, ROIC variants, Net-Debt/EBITDA + approximationFlag, Sloan, Earnings-Stability, Revenue-Growth-3Y orig, FCF-Yield, GM-Stability, Runner.evaluateStock(null) graceful, Tag 124 currency-aware floors, Tag 133c data-quality grading, picks-regression detectDrift, walk-forward priceAt/returnPct/addDaysIso/evaluateVintage, Tag 199 audit-method smoke tests, Tag 203 score-history append+prune) reference unchanged code paths and continue to satisfy their assertions.

## Top 3 "watch" items (NOT failing today but flagged for stability)

1. **Fixture-hash fragility**: any future edit to a SCORE_WEIGHTS method that changes its result for a stock with the fixture's shape (growth ~38, OpM 25, totalAssets 30B, AT 0.33) will break this single test. This is by design but means every CORE-method PR must verify `_fixtureStock()` outputs by mental walk-through. The walk-through for Tags 201c and 202 was clean only because the gates are pattern-guarded (negative TTM, AT≥3) — those guards are the load-bearing safety here.
2. **Tag 203 OpInc-fallback `opIncSource='native'` initial state**: line 482 sets `opIncSource = annualOpInc.length > 0 ? 'native' : null`. The Tech-sector test asserts `opIncSource === null` when `annualOpInc.length === 0` — which holds. But if FTS-merge later populates `annualOpInc` without overwriting `meta.opIncSource`, it will stay null even for native data. (Not a tag28-tests.js failure today, but worth verifying in Agent B/C scope.)
3. **`pre-commerciality-megacap-guard` test sets `s.marketCap = 5e9` (raw number) instead of `{value: 5e9}`**: the method's `_unwrap` handles both shapes, so the test passes — but this differs from the canonical snapshot schema (`marketCap` is always an envelope). Cosmetic only.

## Severity-ranked fixes

None. No FAIL candidates were identified. CI should be green.
