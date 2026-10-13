# Merciless Follow-up Audit — 2026-06-13

Second-pass audit on top of the morning's 7-agent run (`2026-06-13.md`, 50 findings / 30 fixed in commit `2c7b609a1`).
Multi-agent workflow: 341 sub-agents, ~8.1M tokens. **Phase A** (re-verify the 50 prior findings vs current code) and **Phase B** (fresh hunt, loop-until-dry, 3 rounds) completed; **Phase C** (3-skeptic adversarial verification) and **Phase D** (synthesis) were **cut short by the account monthly spend limit** — 17 of 103 candidates were adversarially verified before agents started failing. Remaining fixes/verification done in the main thread.

## Gate status (all GREEN, before and after this batch)
1. `node engine-cli-tests.js` → 10/0
2. `node tag21-tests.js && node tag22-tests.js && node tag28-tests.js` → 10 / 13 / 184, fixture-hash stable
3. `node generate-screener.js` → 4680 stocks, 10 tabs, exit 0
(bonus `node tag-r40rx-config-tests.js` → ALL PASS)

## Phase A result — re-verification of the 50 prior findings
69 sub-verdicts: **28 FIXED_CORRECT, 41 OPEN/FIXED_INCOMPLETE, 0 FALSE_POSITIVE.** The 30-fix commit's data-correctness fixes (F-DQ-001 trading-FX, F-DP-008 FX casing, F-ME-201/202/203 scoring gates, F-BT-001/002/004 backtest freshness gates, etc.) verified genuinely correct. The OPEN set is dominated by CI-architecture / operational items (F-CI-001..010, F-DP-001/003/004/005/006, F-BT-005/006/014/015) — most are STOP-class (CI redesign, data backfill, dependency/schema) rather than surgical code fixes.

## FIXES APPLIED THIS BATCH (all gate-safe, surgical, future-pull data correctness)
| Ref | Sev | File | Fix |
|---|---|---|---|
| NEW-2 | CRITICAL | pull-yahoo.js (~348) | ADR trading-currency detection fell back to nothing on full pulls (`snap.price` only exists on the price-only fast-path), so ADR `marketCap` was scaled by the **reporting** FX factor (~32× off for TWD-reporting ADRs like TSM). Now falls back to `snap.meta.tradingCurrency`. |
| NEW-3 | HIGH | pull-yahoo.js (~431) | Same root cause: analyst `targetMean/MedianPrice` `scaleTrading()` was a no-op on full pulls → analyst-upside wrong for every ADR. Fixed by the same line-348 change. |
| NEW-4 | MED | pull-yahoo.js (~436) | `annual.annualShares` is a unit-less share COUNT but was FX-scaled, corrupting `dcf-intrinsic-value` per-share math for non-USD reporters and desyncing from unscaled `meta.sharesOutstanding`. Now skipped in the scale loop. |
| NEW-6 | HIGH | detect-changes.js (~287) | `METHOD_RECOVERED` signal silently lost after ≥2 consecutive incomputable runs — the generic `else` dropped the sticky `wasComputable:true` marker. Now preserved while incomputable. |
| NEW-7 | MED | scripts/picks-regression-check.js (~138) | Absolute-minimum collapse guard (`total picks < 5 → hard fail`) sat *after* the `< MIN_HISTORY_RUNS` early return, so a total 0/0/0 pipeline collapse passed green when history was thin. Guard hoisted above the early return. |

## VERIFIED-REAL but NOT fixed (≥2/3 skeptics, need a decision or have blast radius)
- **NEW-1 / NEW-10 (HIGH, 3/3) — TOP PRIORITY.** `normalizeMethodScore` over-credits composite QC methods that fail on a non-`value` criterion: `margin-quality` (value=gmMedian) and `earnings-stability` (value=maxDecline) score ~0.99 on their 0.20 QC weights while `pass:false`, because the curve scores value-vs-threshold distance and assumes that's the only failure reason. The morning's F-ME-201 fix only patched the `maxDecline<=0` sub-case; `0 < maxDecline < 0.50` and the whole `margin-quality` gte case remain. Inflates QUALITY_COMPOUNDER scores → non-compounders reach A/B/NEAR_MISS. **Fix = make `normalizeMethodScore` return a penalized low score when `methodResult.pass === false` (only when pass is explicitly false; leave pass===undefined continuous scoring intact). This changes real screener output and WILL move the tag28 fixture-hash → requires `ALLOW_FIXTURE_CHANGE=1` rebaseline + ideally wiring up the anchor test (NEW-18). Deferred for sign-off.**
- **NEW-27 (MED, 3/3).** TURNAROUND scoring ignores mode `acceptValues`: a STABLE compounder scores Tier-A in TURNAROUND (profitability-state/trend `.pass` true for STABLE/FLAT) and can become the displayed headline mode in the screener detail panel. Fix touches scoring semantics → fixture rebaseline. Deferred for sign-off.
- **NEW-5 (MED, 2/3).** ADR `enterpriseValue` scaled by reporting factor not trading factor (magic-formula earnings-yield). Ambiguous currency basis (EV mixes trading-ccy mcap + reporting-ccy debt/cash) and the field may be absent from `metrics.*`; needs confirmation before touching.
- **NEW-25 (MED, 3/3).** Rolling-12m sector-median maturity gate (`ROLLING_MIN_WEEKS=12`) trips after ~2.4 calendar weeks: cron runs 5×/week and dedup is same-day only, so 12 samples ≈ 2.4 weeks, not 12. Prematurely overrides region-aware medians. Fix = require 12 distinct ISO-weeks (intent decision).
- **NEW-8 (LOW, 3/3).** `pull-prices-bulk.js` writes RAW close into `prices/history.json` while `pull-historical-prices.js` writes split/dividend-ADJUSTED close — same file, two price bases; a backfilled ticker spanning a corporate action gets a phantom step in backtests. Manual CLI only.
- **NEW-11 (LOW, 3/3).** Rolling-median per-metric entries never expire when a single metric drops below minN while its sub-profile survives → stale frozen median still trusted.
- **NEW-22 (MED, 2/3).** `generate-screener` (gate #3) does 2 serial blocking `readFileSync` per ticker (score-history + r40rx-history) in the build loop — not migrated to the 32-way batched loader. Performance only.

## Test-coverage gaps surfaced (verified real; these are missing tests, not bugs)
- **NEW-18 (HIGH, 2/3).** `tests/integration-anchor-test.js` (the "never reject a known true-positive" guard) is run by **no** workflow.
- **NEW-19 (MED, 2/3).** If wired in as-is it would be green with zero coverage — gitignored snapshots make all 10 anchors `SKIP`, not `FAIL`. Must run after the pull AND hard-fail on `skip>0`.
- **NEW-16 (MED, 3/3).** Fixture-hash can't detect changes to `SOFT_GUARD_PENALTY` / `RED_FLAG_RULES` (the fixture stock triggers none of them).
- **NEW-17 (MED, 2/3).** Fixture-hash covers only HG + QC; TURNAROUND and BUFFETT weights are untested.

## NOT done — STOP-class (need explicit approval per the audit's stop rules)
No commit/push was made. CI-architecture (F-CI-003/004/005/006), the dead SEC-XBRL workflow (F-CI-001/002), and the `prices/history.json` data backfill (F-BT-001/002 root cause; the *code* freshness gates are already in and verified correct) all require operator decisions.
