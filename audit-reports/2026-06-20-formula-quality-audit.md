<!-- Generated 2026-06-20 by screener-formula-quality-audit workflow (wf_8b3a22af-ec0): 93 agents, 97 findings, 78 confirmed/partial, 4 refuted. Adversarial multi-agent audit of the QUALITY formulas. Branch loop/formel-haertung. -->

# Formula Quality Audit — Valuation-Purity + Correctness + Fitness (2026-06-20)

## Executive Summary

The valuation-purity verdict is unambiguous: **the quality score is contaminated by price-dependent signals in three of the four modes.** `fcf-yield` (FCF/MarketCap) carries 0.05 of the QUALITY_COMPOUNDER score, `dcf-intrinsic-value` (discount-to-intrinsic, moves with market cap) carries 0.30 of BUFFETT, and the BUFFETT mode is structurally a single nested owner-earnings→DCF→MoS bet where effectively all 1.00 of weight rides on a price-relative margin-of-safety construct. These directly violate the owner's #1 mandate (the score must never judge cheap/expensive). `estimate-revision-proxy` was flagged as a fourth leak but is REFUTED on the purity test — its forward-PE/PE ratio is price-invariant (price cancels). Beyond purity, two genuinely dangerous defects sit on the score path: the **Ohlson O-Score bankruptcy DATAGUARD is mis-calibrated** (totalAssets in raw dollars vs. Ohlson's millions, so the gate only ever bites micro-caps and provides near-zero real bankruptcy protection), and **QUALITY_COMPOUNDER has no essential-signal guard**, letting a stock reach Tier A=100 on a thin 50% computable slice with its flagship ROIC metric entirely missing. A large cluster of correctness bugs (negative-equity ROIC blowup, EBITDA=OpInc×1.2 proxy bias, Altman X1/X2 proxies, sloan-ratio gap defeat, forecast-contamination bypass) compound this. Finally, the fitness harness that decides "besser" optimizes raw forward return on the in-list universe — a target that structurally *rewards* adding the very valuation signals the mandate forbids.

Confidence is high on the purity and the verified critical correctness items (all re-confirmed verbatim against source during synthesis). The DATAGUARD-wiring findings are high-confidence but their *score* impact is mostly nil (DATAGUARDs are display/exclude-only, not in SCORE_WEIGHTS). Several verifier severity downgrades were applied where the mechanism was real but the impact narrow.

---

## A. Valuation-Purity Violations (the #1 mandate)

| ID | Signal | Mode / weight | Mechanism | affectsScore | affectsFixtureHash |
|----|--------|---------------|-----------|:---:|:---:|
| PURITY-01 / SCORE-02 | `fcf-yield` = FCF/MarketCap | QC 0.05 | `fcf-yield.js:51` value=fcfAdj/mcap; `score-aggregator.js:48` | **yes** | yes |
| SCORE-01 | `dcf-intrinsic-value` = discount-to-intrinsic | BUFFETT 0.30 | `dcf-intrinsic-value.js:314,322` mcap vs intrinsic; `score-aggregator.js:62` | **yes** | no¹ |
| REDUN-10 | BUFFETT fully nested OE→DCF→MoS | BUFFETT 1.00 | `buffett-criteria.js:728,731,744-761` hard-requires DCF MoS | **yes** | no¹ |
| PURITY-08 | BUFFETT storyHints surface E/P, Hurdle Rate, DCF/MoS discount | display | `strategy-modes.js:129,133,135` | no | no |
| PURITY-09 | momentum/analyst-upside/magic-formula/forward-pe/peg/ev-ebitda are DIAGNOSTIC | display | `method-types.js:101,105,109,119-121` | no | no |

¹ BUFFETT mode is not part of the frozen HG/QC/TURN fixture-hash per the audit's own notes; verify before assuming hash-safe.

**PURITY-01 / SCORE-02 — fcf-yield in the QC score (VERIFIED verbatim).** `methods/fcf-yield.js:51` computes `value = fcfAdj / mcap` and `methods/score-aggregator.js:48` lists `'fcf-yield': 0.05` under QUALITY_COMPOUNDER. Reproduced empirically by two independent dimensions: identical business, price doubles → yield halves → pass flips to fail → ~4.6-point swing in the 0-100 QC score from price alone. This is the textbook leak signature. The comment at `score-aggregator.js:49` already removed `above-200d-ma` "because a technical price signal has no place in fundamental quality" — fcf-yield is the same class of leak left behind.

**SCORE-01 — dcf-intrinsic-value in the BUFFETT score (VERIFIED verbatim).** `methods/dcf-intrinsic-value.js:314` `discountToIntrinsicRatio = (intrinsicTotal - currentMcap) / intrinsicTotal`, returned as `value` (line 342); `mosMet = currentMcap <= intrinsicTotal*(1-mos)` (line 322); `pass = mosMet && hurdleMet` (line 332). `currentMcap` is `marketCap.value` and the hurdle's `projReturn` (line 329) is a function of `currentMcap`. Weight 0.30 in BUFFETT (`score-aggregator.js:62`). Two identical businesses differing only in price differ by ~30 BUFFETT points. Verifier raised confidence; this is a clean, high-severity SCORE-path valuation leak.

**REDUN-10 — BUFFETT is one valuation bet wearing three hats.** `buffett-criteria` (0.50) internally re-evaluates owner-earnings (T6, pass-through) and dcf-intrinsic-value (T9), and hard-requires the DCF margin-of-safety (`buffett-criteria.js:744-761`, `pass = industryOk && mosOk && rateOk`); dcf-intrinsic-value (0.30) is itself a deterministic transform of owner-earnings (0.20) + market cap. So all 1.00 of BUFFETT weight collapses onto one owner-earnings→DCF→MoS chain, and the MoS/Hurdle legs are price-relative. This is simultaneously the worst redundancy finding AND a purity finding: the mode's single degree of freedom is a cheapness test.

**PURITY-08 (revised low) — display leak.** BUFFETT `description` (line 129) is "...zu Margin-of-Safety-Discount"; storyHints (133, 135) advertise E/P, Hurdle Rate, One-Dollar, "DCF/MoS 25-50% Discount". Display-only, but it advertises cheap/expensive as the mode's selling point — fix when touching SCORE-01.

**PURITY-09 (low) — latent.** Six price-normalized methods are correctly DIAGNOSTIC today. Recommendation worth adopting: add a guard/test asserting no price-normalized id ever enters SCORE_WEIGHTS, to prevent silent re-contamination (and to catch fcf-yield/dcf which are *currently* contaminating).

---

## B. Correctness & Gating Bugs (score-affecting)

| ID | Title | Where | affectsScore | Sev |
|----|-------|-------|:---:|:---:|
| OHLSON-01 | Ohlson size term in raw dollars (not millions) neuters bankruptcy gate | `ohlson-o-score.js:80,173-175` | yes (gate) | high |
| QRC-01 | Damodaran IC collapses for negative-equity firms → ROIC 70%+ or silent drop | `quality-compounder-roic.js:83-94` | **yes (0.25 QC)** | high |
| SCORE-04 | QC has no essential-signal guard: Tier A=100 on 50% slice w/o ROIC | `score-aggregator.js:255-287` | **yes** | high |
| CORR-03/CORR-02 | EBITDA=OpInc×1.2 proxy: no real-D&A path in premium-proof; raw in net-debt-ebitda fallback | `premium-compounder-proof.js:116`; `net-debt-ebitda.js:36` | **yes (QC)** | high→med |
| PIOTROSKI-01 | Piotroski CFO/accrual signals use FCF not OCF (OCF is in snapshot) | `piotroski-f-score.js:49,68-69,80-84` | **yes (0.15 TURN)** | high→med |
| ALTMAN-01 | Altman X1 working capital = cash−0.3·debt proxy, ignores real CA/CL | `altman-z-score.js:50-56` | **yes (0.20 TURN, must)** | high→med |
| G01 | Forecast latest-annual-rev leaks into CORE rev-growth-3y when guard incomputable | `strategy-modes.js:206`; `forecast-contamination-guard.js:47-63` | **yes (0.15 HG)** | high→med |
| PSC-01 | profitability-trend scores shrinking-loss loss-makers as IMPROVING (full 0.25) | `profitability-trend.js:55-60` | **yes (0.25 TURN)** | high→low |
| PSC-02 | profitability-state break-on-null downgrades STABLE w/ one missing year | `profitability-state.js:51-55` | **yes** | high→low |
| PSC-03 | margin-quality GM-decline blind to mid-period collapse if newest>oldest | `margin-quality.js:124` | **yes (0.20 QC)** | high→low |
| CORR-03(ndebt)/CORR-04 | operating-cashflow-coverage no outlier cap → 100x mean false-pass | `operating-cashflow-coverage.js:109,118` | no (DIAG) | med→high |
| CORR-03(sloan)/CORR-03 | sloan-ratio CHRONIC_FAIL defeated by one null-totalAssets middle year | `sloan-ratio.js:82-94` | yes (DATAGUARD) | high→med |
| ALTMAN-03 | Altman X2 uses 3y-NI-sum for cumulative retained earnings | `altman-z-score.js:71-72` | **yes (0.20 TURN)** | med |

**OHLSON-01 (VERIFIED verbatim).** `ohlson-o-score.js:80` `GNP_PRICE_INDEX=1.0`; `:173-175` `size = -0.407*log(ta_t/1.0)` with `ta_t` in raw dollars. Ohlson (1980) calibrated −0.407 on assets in **millions** deflated by a GNP index; raw dollars add a fixed ~−5.6 offset to every score, so the size term runs −7…−11 for any company above ~$50M assets and swamps all leverage/profitability terms. Consequence: the "7-sigma moat" the header celebrates is an artifact of the unit error, and the gate provides essentially zero bankruptcy protection above micro-cap. A $200M textbook-insolvent firm passes at O=−1.29. Note OHLSON-01 is high-confidence but **OHLSON is itself a dead gate** (see DG-02) — fixing the calibration only matters once the gate is actually wired in.

**QRC-01 (VERIFIED, revised high).** `quality-compounder-roic.js:83` derives equity = totalAssets−totalLiabilities (totalEquity is null in all snapshots), so `investedCapital = totalDebt + derivedEquity − cash` (line 87) collapses toward zero for negative-book-equity buyback champions: AZO 70.6% pre-tax ROIC, BBWI 67.9% — both trivially clear the 20% MUST-gate — while ANDG goes silently incomputable at IC≤0 (line 94) and is dropped. Multi-ticker, multi-sector (AZO/ABBV/BBWI/HD-adjacent), so a structural fallback (assets−cash when derivedEquity<0) is permitted under threshold-discipline. This is the single most material correctness bug on the 0.25-weight CORE QC input.

**SCORE-04 (VERIFIED, high).** `computeScore` normalizes `weightedSum/computedWeight` (line 287) over only computable methods, and the sole QC coverage gate (lines 255-256) requires just 40% computed weight. A QC stock computable only on earnings-stability(0.20)+margin-quality(0.20)+net-debt-ebitda(0.10)=0.50, all passing, scores **100/Tier A** with `quality-compounder-roic` (the defining 0.25 ROIC anchor) never computed. TURNAROUND has an essential-signal guard (lines 273-284); QC does not. Recommended: add a QC essential-signal guard rejecting when `quality-compounder-roic` is incomputable. Anchors MSFT/COST/V have full ROIC data so the guard never fires on them — fixture/anchor-neutral.

**EBITDA=OpInc×1.2 proxy (CORR-02 confirmed, CORR-01/CORR-05 confirmed, OVERFIT-03 confirmed).** The synthetic EBITDA (`net-debt-ebitda.js:36` fallback; `premium-compounder-proof.js:116` *always*, no real-D&A path) injects a D&A-ratio-dependent bias. premium-proof check #4 (a CORE QC all-pass gate) false-fails high-D&A industrials/REITs whose real ND/EBITDA ≤ 1.0. The RED_FLAG_RULES.HIGH_DEBT 4.0/1.2 compensation (`score-aggregator.js:74-77`) is exact only at D&A=0, not at the 20% the proxy assumes (CORR-01 detail; conclusion unchanged). Also CORR-05: reported D&A of exactly 0 takes the "trusted reported-da" branch (`approximationFlag=false`), getting the *less* conservative red-flag trigger while reading ~20% higher leverage — a sign-of-data inconsistency. Structural fix: reuse the reported-D&A-preferred path everywhere; do not retune 1.2 on single-ticker evidence (sector D&A variance is the literature basis).

**PIOTROSKI-01 / ALTMAN-01 / ALTMAN-03 — TURNAROUND proxies that the snapshot can do better.** Piotroski signals 2 & 4 use FCF as the CFO proxy (`piotroski-f-score.js:49`) even though `annual.annualOCF` exists and is read by ohlson/beneish/reinvestment — systematically docks capex-heavy reinvesting recoveries (the exact TURNAROUND archetype). Altman X1 uses (cash−0.3·debt) instead of real currentAssets−currentLiabilities present in 52.8% of snapshots; Altman X2 approximates cumulative retained earnings with a 3y NI sum (overstates X2 for firms with a large accumulated deficit + recent profits). All three are score-affecting on the 0.20/0.15 TURNAROUND inputs and all have a better field already in the snapshot — structural fixes, no threshold change.

**G01 (revised med).** `strategy-modes.js:206` blocks only on `computable===true && pass===false`; `forecast-contamination-guard.js:47-63` returns `computable:false` when <4 quarters. A stock with ≥4 annual revs but <4 quarters makes the guard incomputable (no block) while CORE `revenue-growth-3y` (HG 0.15) still computes an ~80% CAGR off the unvalidated forecast `annualRev[0]` — the 3SBio look-ahead the guard exists to stop. (Claim's "HG 0.15" was the weight, not a threshold; the threshold is 22.)

**PSC-01/02/03 (mechanisms confirmed; verifier revised to low on impact).** profitability-trend awards full 0.25 TURNAROUND credit to a perennial loss-maker whose loss merely shrank >20% (`profitability-trend.js:55-60` → normalize 1.0); margin-quality's GM-decline test is short-circuited by `gmEnd<=gmStart` so a mid-period margin collapse (newest 14pp below median) passes if newest>oldest (`margin-quality.js:124`); profitability-state's break-on-null can demote STABLE→RECENT when the gap sits at index 2 (PSC-02 — note the verifier corrected the claim's example: index-1 nulls are driven by a different branch). All real, all structural, none requiring a numeric-threshold change.

---

## C. Gaming / Robustness Gaps

- **G07 (revised low) — rule-of-40 neg-TTM FCF swap can flip FAIL→PASS.** `rule-of-40.js:71-79` substitutes the 3y annual FCF-margin median for a negative TTM margin in (−20,0) when median>5 and latest annual FCF>0, letting a TTM cash-burner pass R40 (CORE HG 0.25): −15% TTM + 30% median turns R40 25→70. Structural cap or require materially-positive latest margin.
- **G02 (med) — mixed growth basis.** `revenueGrowthYoY` (latest-quarter YoY from Yahoo) feeds rule-of-40/rule-of-x/hgqc's 25% gate while revenue-growth-3y uses annual CAGR; a blowout quarter passes the composites while the 3y fails. Unify basis or flag divergence.
- **G04 (med) — hgqc rounds strong-quarter count up.** `hypergrowth-quality-class.js:103` `Math.round(strongQ/validPairs*4)` turns 2-of-3 strong annual pairs into 3, meeting `isBroadGrowth>=3` (line 151, not 152). `affectsFixtureHash:true`. Use Math.floor.
- **G06 (revised low) — decimal-unit guard.** rule-of-40:89 / rule-of-x:30 mark computable:false when |growth|≤1 AND |fcfMargin|≤1; a real ±0.8% mature firm is dropped from the HG denominator. Validate units at ingestion instead.
- **G05 (med) — engine-fixtures revenueQ ordering.** Oldest-first fixtures vs production newest-first means hgqc reads reversed quarters on engine-fixtures; latent today (6Q fixtures fall back to the order-independent annual branch) but corrupts any ≥8Q fixture. Test-hygiene fix.
- **DG-04 (revised med) — revenue-shock YoY>500 hard-excludes micro-turnarounds.** `revenue-shock-guard.js:104-112` fails pass=false with no materiality floor on the YoY branch (a TURNAROUND hard dataGuard), rejecting a 1M→7M genuine turnaround. Apply the materiality gate to the YoY branch.

---

## D. Redundancy / Collinearity in the weighting

The nominal weights badly overstate the number of independent signals.

- **REDUN-01 (revised med) — HYPERGROWTH revenue factor counted up to 4× (~0.50-0.70 effective).** rule-of-40(0.25)+rule-of-x(0.10)+revenue-growth-3y(0.15) all read growth+margin (=0.50), plus hgqc(0.20) gated on growth (→0.70). The code header itself admits "revenue triple-counted". A fast-growing unprofitable SaaS name is mechanically A-tier on essentially one fact.
- **REDUN-02 (revised med) — rule-of-40 vs rule-of-x deterministically collinear.** Both linear in {revenueGrowthYoY, fcfMarginTTM}; rox−r40 = 0.5·growth. 0.35 combined weight on ~1 independent factor. rule-of-x is already `defaultSortMethod` — demote to display.
- **REDUN-06 (revised low) — net-debt-ebitda counted 3× in QC** (0.10 weight + RED_FLAG_RULES + premium-proof check#4). One leverage fact lands three compounding hits. Keep leverage as either graduated score OR red-flag, not both at full strength; drop the leverage check from premium-proof.
- **REDUN-05 (revised low) — premium-compounder-proof re-tests already-scored metrics.** 4 of its 6 all-pass checks (ROIC≥25, reinvest≥30, ND/EBITDA≤1, OpMargin) duplicate quality-compounder-roic/reinvestment-rate/net-debt-ebitda/margin-quality. (Two checks — rev-CAGR, FCF/NI — are genuinely new, so demote-to-display loses a little signal.)
- **REDUN-08/09 (revised low) — TURNAROUND stacks net-income direction.** profitability-state(0.25)+profitability-trend(0.25) share the NI series, echoed again in Altman X2/X3 and Piotroski signals 1/3 → ~0.85 of mode weight touches NI/OI primitives. (profitability-state is a 3-source 2-of-3 vote, so the overlap is partial, not lockstep.)
- **REDUN-12 (med) — graduation curve saturates correlated inputs together.** `normalizeMethodScore` returns 1.0 for any pass and saturates ≥0.9 ratio at 0.99, so several collinear inputs all hitting ~1.0 together collapses top-end discrimination: a stock marginally passing many correlated factors out-scores a stock deeply clearing one. Reproduced: marginal-all-pass=100/Tier A vs deep-single-pass=78/Tier B.

None of these flip the fixture hash unless weights/methods are edited; the fix is to collapse collinear methods or down-weight redundant composites.

---

## E. Threshold Overfit & Scoring-Mechanics

- **OVERFIT-01 (revised low) — revenue-growth-3y 25→22 on two named tickers.** `revenue-growth-3y.js:14` cites only AVGO 24.4% and NOW 22.4%; NOW clears the new bar by 0.4pp. Two tickers < the 3+/2-period requirement of `docs/threshold-discipline.md`. Revert or move the two names to an excludeList. `affectsFixtureHash:true`.
- **OVERFIT-02 / DG-10(NVDA half) (med) — revenue-shock 4.0→4.5 for NVDA z=4.14.** `revenue-shock-guard.js:14`; threshold sits 0.36 above the single named data point. A real z=4.2 distortion now passes. (DG-10's q-spike half is REFUTED — that 2.0→3.0 move was a documented *de*-fitting back to first principles, the opposite of the claim.)
- **SCORE-03 (revised med) — thresholdOp single-point-of-failure.** `score-aggregator.js:123` reads op only from `methodMeta.thresholdOp` (default gte), never from the result. If `_getMethodRegistry()` returns null (reachable via the try/catch in strategy-modes), every lower-is-better lte CORE method inverts: a 5.0x net-debt/EBITDA failure scores 0.99 instead of 0.1. Source op result-first (behavior-neutral with a populated registry → fixture-safe).
- **SCORE-05 (med) — red-flag/data-quality downgrade tier only, not score; tabs sort by score.** `score-aggregator.js:403-406,418-435` mutate tier; `generate-screener.js:773-774,806` sort by hg/qcScore. A red-flagged 85 outranks a clean B-tier 70 in the QC/HG tabs — the downgrade badge is cosmetic. Sort tier-major then score-minor, or cap score on downgrade.
- **SCORE-06 (revised low) — AUDIT_SCORE_MULTIPLIERS env split.** Dashboard score is multiplied (`daily-pull.yml:395`), picks-history backtest score is not (`:428`, intentionally per Tag 219a), so the walk-forward validates a cohort the user never saw. Record both raw and multiplied scores in picks-history.
- **SCORE-07 (med) — profitability-state all-or-nothing.** String threshold + `normalizeMethodScore` short-circuit at line 103 (`if pass return 1.0`) means STABLE and barely-TURNAROUND both contribute 1.0; the 0.20/0.25 weight behaves as a binary gate with no gradient for profitability strength. (Root cause is line 103, not the lines 119-121 the claim cited.) Export a numeric STATE_RANK with gte to graduate; flips fixture-hash.

---

## F. Fitness-Gate vs Quality-Mandate tension

This is the structural reason purity keeps leaking back in.

- **FIT-01 (revised low on verdict, but the tension is real) — forward-return Rank-IC is the deferred "besser" gate.** `fitness/lib/metrics.js:35` is Spearman(score, raw forward return). The spec defers all `[TODO-CAL]` constants to forward-fitness (`formula-spec-fabless-ai-connectivity-v5.2.md`). Verifier nuance: the constants are *currently* set by design invariants, and forward-fitness is a *future* (2026-07-14) validation date — so it is not literally being optimized today. **But** the moment it becomes the binding gate, any optimizer discovers that an FCF-yield/cheapness tilt lifts 28d/84d IC (forward returns are mean-reverting), pulling valuation signals into the score. The gate's objective is misaligned with the quality-only mandate. Augment with construct-validity against external quality references (next-year ROIC, GM persistence, realized FCF conversion).
- **FIT-02 (revised low) — raw total return, never market/sector-adjusted alpha.** `forward-returns.js:46` `ret=(p1/p0)−1`; the benchmark from resolveWindow only anchors dates (`measure.js:116`). Over 28d/84d the IC is dominated by beta/sector drift, not quality. The benchmark return *is* computed in walk-forward-perf but discarded by resolveWindow. Subtract it.
- **FIT-03 (revised med) — universe = the already-scored in-list.** cohortSpread's "universe median" is the median of the 44 SaaS / 8 fabless names that already passed gating (`measure.js:64`, `metrics.js:82-94`). It measures top-of-list vs median-of-list, never screen-vs-market — the whole in-list could trail the index 15% while the harness reports a healthy spread. Add a broad-universe / benchmark denominator.
- **FIT-04/FIT-05/FIT-10 (low-med) — statistically powerless.** Top-decile cohort = ceil(0.10·8)=1 stock for fabless (decile spread = ALAB's idiosyncratic move); IC SE ≈0.15 (N=44) / ≈0.35 (N=8) with no CI or significance test (`metrics.js:35` returns IC for any n≥3); single frozen t0, two horizons, no multi-vintage pooling. An IC of 0.18 vs baseline 0.05 is within noise. Attach the existing deterministic bootstrap CI and require pooling before any accept.
- **FIT-06 (revised med) — classify() conflates stale/illiquid with delisting → −100%.** `forward-returns.js:39-42` returns `delisted` whenever no exit price within the 7-day backward window; `measure.js:130-132` books −1.0 in the conservative variant. One illiquid small-cap with a stale tail tanks the conservative IC. Distinguish confirmed delisting from a stale series end.
- **FIT-09 (med) — cohort MEAN vs universe MEDIAN.** `metrics.js:92-94` mixes statistics; on right-skewed equity returns a zero-skill formula shows a positive spread (reproduced ≈+1.12 with random scores). Use median vs median.
- **FIT-07 (med) — primary SaaS baseline self-declared DEGRADED/NOT-READY** (A2 0% coverage) yet is one of only two forward "besser" references. Mark degraded baselines non-eligible for accept decisions.

Net: even with the harness mechanically clean, a higher fitness number does not establish higher quality and actively incentivizes valuation contamination — which is exactly how fcf-yield/dcf would be "justified" back into the score.

---

## G. Lower-severity / Diagnostic / Doc

- **DG-01/DG-02/DG-03/DG-11/DG-12 — DATAGUARD wiring gaps (display-only, affectsScore:false).** `quarter-concentration-guard`, `deceleration-guard`, and `ohlson-o-score` are typed DATAGUARD in `method-types.js` but appear in no mode's hard `dataGuards[]` and not in the `generate-screener.js:621` hardGated chain, so their pass=false never excludes a ticker. Root cause (DG-03): `generate-screener.js:259` calls the legacy `Runner.evaluateStock` which drops the `disqualified` flag, so the generic type-based DataGuard path is dead; only the 5-method per-mode allowlist gates. This means OHLSON-01's calibration bug is currently moot (the gate is unwired) — but also that fixing OHLSON-01 without wiring it does nothing. Decide per guard: relabel DIAGNOSTIC or wire a `*Fail` flag into the hardGated chain.
- **DG-05/DG-06 (low) — revenue-shock only detects up-spikes** (`jump>floor` with floor always ≥1e7, so negative jumps never fire); q-spike OI-severity cannot fire on a profit→loss flip (`q-spike-dataguard.js:238` requires both years negative). One-sided detectors; document or handle the down/flip case.
- **DG-07 (revised med) — pre-revenue bypass.** loss-magnitude / metric-divergence / ni-volatility all return computable:false on null annualRev[0], so a pre-revenue $200M-$1B name is gated only by pre-commerciality-megacap-guard, which applies above a 1B mcap floor. Add a sub-1B tier or hard-fail one gate on null/zero rev.
- **DG-09 (low) — forecast-contamination 1.5× ratio** compares annualRev[0] to 4 quarters with no period-span check; an IPO-era grower with transition-straddling quarters can be false-excluded.
- **PSC-06/PSC-07/PSC-09, QRC-05/QRC-07, CORR-07, DG-13 (low)** — thin-data medians (premium-proof computes "5y median" on 1 datapoint), MARGINAL_REV_PCT 2% demotes thin turnarounds, premium-proof check#4 synthetic EBITDA, distressed 999 sentinel could display as literal 999x, S3 redundant sub-condition makes REV_VOL_RATIO_MAX dead. Mostly diagnostic / structural-guard hygiene.
- **PSC-07 / gross-margin-stability (low) — stability≠quality.** A stable 13%-GM commodity reseller earns the same full 0.10 HG credit as a 70%-GM software name (`gross-margin-stability.js:37-67`, CoV-only, no level floor). Pair CoV with a GM-level floor or document scope.
- **QRC-03 (revised low) — intangible-adjusted-roic backwards (DIAGNOSTIC).** Inflates IC but not NOPAT, so adjROIC is always below nominal and penalizes high-R&D quality (MSFT 13.9% fails its own 15% floor). Must NOT be promoted to SCORE_WEIGHTS until the NOPAT add-back is added.
- **QRC-02 (revised low) — sibling ROIC IC-definition divergence** (Damodaran vs assets−cash; different numerators by design). Partly intentional; document or unify via a shared `investedCapital()` helper.

---

## Recommended changes (ordered)

1. **Remove `fcf-yield` from SCORE_WEIGHTS.QUALITY_COMPOUNDER; redistribute 0.05 to `reinvestment-rate` or `margin-quality`.** *Rationale:* pure valuation leak (FCF/mcap moves with price). *affectsScore:* yes. *affectsFixtureHash:* **yes — needs tag28-tests.js update.** *Threshold-discipline:* n/a (structural removal). Keep fcf-yield DIAGNOSTIC.
2. **Remove `dcf-intrinsic-value` from SCORE_WEIGHTS.BUFFETT; re-base BUFFETT on quality tenets only (buffett-criteria quality sub-tests + owner-earnings growth), and strip the DCF/MoS hard-requirement from buffett-criteria's overall pass.** *Rationale:* 0.30 (and effectively ~1.00 via REDUN-10) of BUFFETT is a price-relative MoS bet. *affectsScore:* yes. *affectsFixtureHash:* verify BUFFETT's fixture participation first. *Threshold-discipline:* n/a.
3. **Add a guard + unit test asserting no price-normalized id (fcf-yield, ev-ebitda, peg, forward-pe, magic-formula, analyst-upside, price-momentum-12-1, above-200d-ma, dcf-intrinsic-value) ever appears in any SCORE_WEIGHTS.** *Rationale:* prevents silent re-contamination; would have caught #1/#2. *affectsScore:* no. *affectsFixtureHash:* no.
4. **Add a QUALITY_COMPOUNDER essential-signal guard: REJECT when `quality-compounder-roic` is incomputable (mirror TURNAROUND).** *Rationale:* SCORE-04 — Tier A=100 with the flagship metric missing. *affectsScore:* yes (only for currently-mis-admitted thin-data names; anchors unaffected). *affectsFixtureHash:* no (anchors have full ROIC data). *Threshold-discipline:* structural.
5. **quality-compounder-roic: fall back to assets−cash IC when derivedEquity<0 (or IC < fraction of operating assets); flag `_icDegenerate`.** *Rationale:* QRC-01 negative-equity blowup (AZO 70.6%, ANDG dropped) on the 0.25 CORE input. *affectsScore:* yes. *affectsFixtureHash:* yes if any fixture stock has negative equity — check. *Threshold-discipline:* multi-ticker/multi-sector evidence satisfies the bar; it is structural, not a numeric tune.
6. **Use reported `annualDepreciation`-preferred EBITDA everywhere (net-debt-ebitda fallback already does; add the same to premium-compounder-proof check#4); treat reported D&A==0 as "no usable D&A" → fallback path.** *Rationale:* CORR-02/CORR-05/OVERFIT-03. *affectsScore:* yes (premium-proof is in SCORE_WEIGHTS → **fixture-hash flips, tag28 update**). *Threshold-discipline:* do NOT change 1.2 on single-ticker evidence.
7. **Piotroski: use `annual.annualOCF` for the CFO>0 and accrual signals (fall back to FCF only if OCF absent).** *Rationale:* PIOTROSKI-01, OCF is in the snapshot. *affectsScore:* yes (0.15 TURN → fixture flips). *Threshold-discipline:* structural.
8. **Altman: X1 = (currentAssets−currentLiabilities)/assets when both finite (52.8% of snapshots), fall back to the cash proxy; document X2's upward bias or source true retainedEarnings.** *Rationale:* ALTMAN-01/ALTMAN-03 on the 0.20 TURN must-gate. *affectsScore:* yes (fixture flips). *Threshold-discipline:* structural.
9. **Gate CORE `revenue-growth-3y` when forecast-contamination-guard is incomputable AND annualRev[0] is uncorroborated.** *Rationale:* G01 look-ahead leak into the 0.15 HG input. *affectsScore:* yes. *affectsFixtureHash:* no (per claim). *Threshold-discipline:* structural.
10. **Wire OR relabel the dead DATAGUARDs (ohlson-o-score, quarter-concentration-guard, deceleration-guard) and fix OHLSON-01's size-term scaling (assets in millions) — do both together or neither.** *Rationale:* DG-01/02/03 + OHLSON-01; the calibration fix is pointless while the gate is unwired, and wiring the gate as-calibrated would catch nothing. *affectsScore:* no (DATAGUARDs aren't in SCORE_WEIGHTS). *affectsFixtureHash:* no. *Threshold-discipline:* OHLSON re-scaling is literature-backed (Ohlson 1980), then re-verify the O>0 boundary against anchors.
11. **Sort quality tabs tier-major, score-minor (or cap score on downgrade); source thresholdOp result-first in normalizeMethodScore.** *Rationale:* SCORE-05 (cosmetic downgrades) + SCORE-03 (registry-null inversion). *affectsScore:* SCORE-03 fix is behavior-neutral with a populated registry (fixture-safe); SCORE-05 is sort-order only.
12. **Fitness harness: (a) compute IC/spread on benchmark-adjusted excess returns over a broad universe; (b) attach bootstrap CI + require multi-vintage pooling before "besser"; (c) split stale-data from delisting; (d) cohort-median vs universe-median; (e) demote forward-return IC to a non-binding sanity check and add construct-validity vs external quality references; (f) mark DEGRADED baselines accept-ineligible.** *Rationale:* FIT-01/02/03/04/05/06/07/09/10 — the harness currently incentivizes valuation contamination. *affectsScore:* no (validation layer). *affectsFixtureHash:* no.

---

## Refuted / not-real (brief)

- **SCORE-08 / ERP-01 — estimate-revision-proxy as a valuation leak: REFUTED on the purity test.** Signal 1 = forwardPE/PE = trailingEPS/forwardEPS; price cancels exactly (verified price-invariant). It is an EPS-growth-expectation proxy, not a cheap/expensive signal. (It remains a weak/noisy signal per ERP-02, but not a mandate violation.)
- **QRC-06 — quoteSummary OCF-vs-FTS-capex positional misalignment: REFUTED.** The mis-pairing is structurally unreachable: annualCapex and annualOCF/FCF both derive from the same FTS `annualCash` rows and the FTS override fires together; the QS .filter(Boolean) arrays are discarded. The FTS-path version was already fixed (F-DP-101).
- **DG-10 (q-spike half) — OI_SEVERITY_HARD "fit to IONQ": REFUTED.** The last move (2.0→3.0) was a documented *reversion to first principles* per threshold-discipline, with IONQ-class names moved to an exclude list — the opposite of single-ticker fitting. (The NVDA/revenue-shock half stands as OVERFIT-02.)
- **GAME-01 — placeholder ("test claim"): dropped, no propositional content.**

---

## Coverage & caveats

- **Re-verified verbatim during synthesis:** SCORE_WEIGHTS (all 4 modes), fcf-yield.js:51, dcf-intrinsic-value.js:314-345, ohlson-o-score.js:80/173-175. These four anchor the top priorities and are confirmed.
- **Verifier verdicts honored:** revisedSeverity applied throughout (many "high" mechanisms revised to low because impact is narrow or display-only). The most common pattern: the mechanism is literally true but (a) the metric is DIAGNOSTIC not CORE, (b) the cited example/line was slightly off (PSC-02, PSC-06, G04 line 151 not 152, REDUN-01 effective weight), or (c) the impact is latent on the current fixture set (G05). I kept the strongest framing and noted the corrections inline.
- **NOT independently re-run:** all UNVERIFIED low-severity findings (PURITY-09, G08, PSC-08/09, QRC-08, CORR-07, OHLSON-02, ERP-02, several DG-13/14/15, SCORE-09/10, FIT-11) were "not adversarially verified" by the upstream verifiers and I did not re-run them — treat as plausible-but-unconfirmed.
- **Not checked at all:** runtime/perf, the full 83-module set beyond the audited dimensions, whether removing fcf-yield/dcf actually re-normalizes cleanly (re-weighting QC/BUFFETT needs an anchor-set regression run), and the exact fixture-hash deltas (Node is off-path; I did not execute the suite).
- **Key structural insight cutting across dimensions:** the DATAGUARD layer is half-dead (DG-03), so OHLSON-01's high-confidence calibration bug currently changes no outcome — this is the single most important "looks scary, does nothing today, but is a trap on the next wiring change" item.
