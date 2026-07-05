<!-- eval-oracle-fix plan (run wf_b6517c40-be5). is_plan_safe=false / abandon_safe=true. 5 blocking objections must be folded in before implementing. -->

# Eval-Oracle-Fix — Plan + adversariale Prüfung

## Review-Verdikt
NOT SAFE TO IMPLEMENT AS WRITTEN. The plan's decoupling, blast-radius, read-only-fitness, and abandon-safe claims are all verified TRUE — this change genuinely cannot regress scoring, pick selection, or fixture-hash, and methodology-report's null-handling is crash-safe. But two of the three core fixes are defeated by realities the plan never accounts for: (1) a 142 MB cache-replay path (method-effectiveness.js:210-233) serves the dominant vintage population by replaying pre-computed returns WITHOUT re-resolving dates, so the root-cause entryDate===exitDate delete never touches the already-cached degenerate zeros and the canonicalFrac gate is structurally uncomputable on cache entries (their shape lacks any canonical/fallback flag). The gate will keep certifying the 16 known-degenerate methods from cache for up to 90 days. (2) The fitness 'headline deliverable' (realized naive-vs-conservative rankIC) is unachievable, not pending: the oldest picks-history vintage carrying both evaluatedTickers and per-pick score is 2026-05-19, and with prices ending 2026-06-16 the 84d horizon can never realize and 28d only borderline — no vintage <=2026-03-24 exists. Plus the freeze script's input assumptions are factually wrong (TURNAROUND=52 not 100; old vintages lack score). Additionally the continue-on-error flip is at the stale-price boundary TODAY (3 of max 3 business days), so the next price-pull hiccup will hard-abort the whole pipeline mid-flight and discard the day's upstream artifacts because the eval steps precede archive/commit. The fail-loud edits (exit 0 -> exit 1) and the evidenceGate sanity-rule design are sound in principle and should proceed, but ONLY after: cache rebuild + per-entry resolution flag, moving the gate logic to the bucket-push (both cache and fresh paths), reordering or guarding the CI fail-loud flip so a stale-price abort can't nuke good upstream work, and either deferring or data-backfilling the fitness deliverable. Fix the five blocking objections first.

## BLOCKING OBJECTIONS (müssen vor Umsetzung gelöst sein)

### BO1
CACHE REPLAY PATH IS INVISIBLE TO THE ENTIRE FIX (defeats metric_changes #1 and sanity_gate #4). method-effectiveness.js has a cache-replay branch at lines 210-233 that reads pre-computed forward returns from outputs/method-effectiveness-cache.json (verified 142 MB on disk; log line 358 literally says 'all vintages served from cache') and pushes the stored `ret` straight into pass/fail buckets WITHOUT ever recomputing entry/exit dates, calling nearestTradingDay, or touching the price map. (a) The plan's root-cause delete (null out p0/p1 when entryDate===exitDate, lines 300-308) only executes on the FRESH-LOAD path (lines 235-334). It does NOT purge the millions of already-cached degenerate zeros. Cache retention is 90 days (CACHE_RETENTION_DAYS prune at lines 146-168), so the 16 confirmed degenerate-zero methods keep being certified from cache for up to 90 days after the fix ships. (b) The cache entry shape is {ticker, methodId, ret, pass, quality} (verified at line 330) — there is NO field recording whether a row resolved via the canonical branch vs the nearestTradingDay fallback. Therefore sanity_gate rule #4 (canonicalFrac >= 0.80) is STRUCTURALLY UNCOMPUTABLE for cached rows, which are the dominant population. The fix MUST either (i) invalidate/rebuild the cache as part of this change (re-derive ret with the entryDate===exitDate guard and persist a canonicalResolved boolean per entry), or (ii) move the degenerate-zero rejection and canonicalFrac tracking to the consumption point (the _getMethodBucket push in BOTH the cache-replay loop at 220-231 AND the fresh-load loop at 320-331), not only the price-resolution block. As written, the plan fixes a path that production almost never takes.

### BO2
ZERO-FRACTION GATE (sanity_gate #2) CANNOT DISTINGUISH MANUFACTURED ZEROS FROM REAL FLAT RETURNS ON CACHED DATA, AND THE entryDate===exitDate DELETE DOES NOT COVER THE CANONICAL BRANCH. The canonical-date branch (lines 300-302: map.has(canonicalEntry) && map.has(canonicalExit)) can ALSO yield p0===p1===same price => ret exactly 0 for a legitimately flat or thinly-traded ticker, but the plan only nulls entryDate===exitDate in the FALLBACK else-branch (lines 303-308). A genuine 0.00% 28d return (possible for low-vol names) is indistinguishable from a snap artifact by value alone. Gating on max(zeroFrac) > 0.10 will therefore also reject some legitimately-flat-but-real groups, and on the cache path (no date info) there is no way to tell which zeros are artifacts. The gate's stated purpose ('a >10% exact-zero share is a snap-to-stale-price artifact') is only true if zeros can be attributed to the fallback path — which requires the per-entry resolution flag that the cache does not store. Add a `resolvedVia` discriminator to cache entries and gate on fallback-zero fraction, not raw exact-zero fraction.

### BO3
FITNESS HEADLINE DELIVERABLE IS UNACHIEVABLE WITH CURRENT DATA — not 'pending', impossible. Verified: the oldest picks-history vintage carrying BOTH `evaluatedTickers` AND per-pick `score` is 2026-05-19 (2026-05-08.json has neither: no evaluatedTickers key, picks have NO score field). Newest price date is 2026-06-16. From t0=2026-05-19 the 84d horizon exits ~2026-08-11 => ALWAYS PENDING_PRICES; the 28d horizon exits ~2026-06-16/17 => borderline/PENDS by a day. The plan instructs frozenAt <= ~2026-03-24 'so horizons realize' — but NO usable vintage exists before 2026-05-19, so that instruction cannot be followed. Using latest.json (t0=2026-06-12, which DOES have score+evaluatedTickers) makes BOTH horizons PEND. Net: the 'un-breaking-the-oracle output' (naive vs conservative rankIC/cohortSpread) cannot be produced now under any choice. The plan must either (a) state this deliverable is deferred until prices/history extends past ~2026-08-11, or (b) backfill evaluatedTickers+score into an old-enough vintage first. Shipping the freeze-full-baseline.js as-is produces only PENDING_PRICES — the wiring is proven but the claimed result is vaporware.

### BO4
freeze-full-baseline.js INPUT ASSUMPTIONS ARE FACTUALLY WRONG. The plan states picks-history modes are 'arrays of 100 picks each' for HYPERGROWTH/QUALITY_COMPOUNDER/TURNAROUND. Verified in latest.json: HYPERGROWTH=100, QUALITY_COMPOUNDER=100, TURNAROUND=52 (NOT 100). More importantly the per-mode top score is 100 in every mode (per-mode normalized rank, not a cross-mode-comparable cardinal score) — so the plan's 'dedupe by ticker keeping max score' will pool every mode's 100-scorers at the top and produce a degenerate, scale-mixed ranking exactly as the plan's own risk #5 warns, except the risk is understated: the scores are not merely 'maybe not comparable', they are per-mode-normalized to the same [.,100] band and pooling them is meaningless. The freeze script must either emit three per-mode baselines (the plan's stated fallback) or use a genuinely cross-comparable raw score that does not exist in picks-history. Do not ship the single-pooled-ranking v1.

### BO5
BENIGN-CRON ABORT RISK IS AT THE THRESHOLD RIGHT NOW, NOT HYPOTHETICAL. Verified: with prices ending 2026-06-16 and today 2026-06-20, businessDaysSince = 3, and MAX_PRICE_STALENESS_BUSINESS_DAYS = 3 — exactly AT the limit, exit(1) does not fire today but ONE more business day of a flaky Yahoo price-pull (or a Monday holiday) tips staleness to 4 > 3 and fires the exit(1) at method-effectiveness.js:131/137. Once L490/L496 are flipped to continue-on-error:false, that exit(1) hard-fails the ENTIRE daily-pull build, including all downstream steps after L508 (Elliott CSV, Pull-Stats, Method-Drift, Diff-Report, Dashboard, Archive, Strip methodHistory, and the final commit/push). The plan's risk note calls this 'acceptable and desired' but understates that (a) the margin is zero today, so this will trigger on the very next price-pull hiccup, and (b) because the eval steps sit mid-pipeline, a stale-price abort now ALSO loses the day's archive/commit of legitimately-produced artifacts from earlier steps. Required mitigation before flipping continue-on-error: either move the eval steps to the END of the job (after Archive/commit) so a stale-price abort cannot discard good upstream work, OR keep the eval steps' artifact/commit consequences idempotent, OR gate the staleness exit on a separate 'is this a real data outage vs weekend' check. Do not flip L490/496/502/508 to false while the eval steps run before the archive/commit steps.

## Übersehene Consumer

- scripts/methodology-report.js significant-table SORT and RENDER: at line 124 `significant.sort((a,b) => b.d.alpha - a.d.alpha)` runs over the filter `ciLo95 != null && ciLo95 > 0` (line 112). The plan sets alphaVal=null when evidenceGate!=='ok' but its claim (consumer_blast_radius point c) that ciLo95 is ALSO null for the new gate states depends on the bootstrap `ci` being suppressed for those states. In current code (lines 376-380) `ci` is suppressed ONLY on insufficientVintages||insufficientSamples — NOT on the new degenerate-zero/implausible-median/unmatured states. If the plan extends the alphaVal null-condition but FORGETS to extend the `ci`-suppression condition identically, a degenerate-zero method can have ciLo95>0 (from a bootstrap over contaminated zeros) AND alpha=null, landing it in the 'Significant positive alpha — earn their score weight' table with alpha rendered '—'. _fmtAlpha(null) and _fmtCi handle null safely (no crash, verified), so this is a silent-misrender, not a crash — but it puts a CONTAMINATED method in the human-facing 'earn their weight' recommendation table. The fix MUST gate the bootstrap `ci` computation on the SAME full set of not-'ok' states, not just alphaVal.

- method-effectiveness.js OWN markdown sort (lines 451-457): `(b.h.alpha || -Infinity) - (a.h.alpha || -Infinity)` — when alpha becomes null for the new gate states this coerces to -Infinity which is fine, but the `ciLo95 != null && ciLo95 > 0` significance flag at lines 453-456/481 has the same ci-suppression dependency as methodology-report; verify both producer and consumer suppress ci identically.

- method-effectiveness.json byQuality sub-buckets: _evalGroup is reused for byQuality A/B/C/D (line 419) and methodology-report renders byQuality alpha at line 167 via _fmtAlpha(d.byQuality.X && d.byQuality.X.alpha). The plan says plausibility bounds 'apply identically to byQuality' but the degenerate-zero/canonicalFrac logic must also be wired into the byQuality _evalGroup calls — and byQuality groups are far smaller (often <10), so the same cache-vs-fresh canonicalFrac uncomputability applies and may flip many byQuality buckets to not-ok, changing the byQuality render counts. Confirm the byQuality table at report line 160-168 still renders without all-'—' rows.

## Ursprünglicher Plan (vor Revision)

# Un-Break the Eval Oracle — Implementation Plan (screener-data, Project 1)

**Repo:** `C:\Users\Karlr\OneDrive\Dokumente\GitHub\screener-data` (NOT screener-fix)
**Node:** `C:\Program Files\nodejs\node.exe` (not on PATH)
**Abandon-safe:** YES — eval is fully decoupled from scoring/score-aggregator/fixture-hash; the only reader of the eval JSON is a render-only Markdown report.

---

## 0. Ground truth verified against the live tree
- `method-effectiveness.js` catch -> `process.exit(0)` at **line 489**; `walk-forward-perf.js` at **line 857**.
- `evidenceGate` set by elimination at **lines 398-402** (only `vintages>=4` + both groups `>=10`).
- Degenerate-zero injection in the fallback price block, **lines 303-308**; canonical-date branch at **lines 300-302**.
- Confirmed live: **16** of the current 28d `ok`-gate methods have `medianReturnFail===0`.
- Sole consumer: `scripts/methodology-report.js` reads `evidenceGate`/`alpha`/`ciLo95`/`ciHi95` at **lines 108-117**; never reads the medians.
- `fitness/measure.js` writes ONLY `fitness/outputs/` (lines 38-39, 189); consumes `baseline.ranking`/`evaluatedTickers` at lines 64-76; full universe = `picks-history/latest.json.evaluatedTickers` (**4737**).
- Fixture-hash gate = test `'fixture-hash: score-aggregator output is stable'` in `tag28-tests.js:2788` reading `tests/fixture-hash.txt`.

---

## 1. Fail loud
**`scripts/method-effectiveness.js:489`** and **`scripts/walk-forward-perf.js:857`**: change `catch -> process.exit(0)` to `process.exit(1)` with a `::error::` prefixed message and full stack. The existing price-staleness `exit(1)` (method-effectiveness `:131-137`, walk-forward `:587/596`) will now actually propagate.

**`scripts/methodology-report.js:187`** (recommended): catch -> `exit(1)`, but KEEP the graceful early-returns for legitimately-absent upstream artifacts (`:42-44`, `:147-148`) on exit 0.

**`.github/workflows/daily-pull.yml`** — flip to `continue-on-error: false`:
- **L490** Walk-Forward Performance
- **L496** Method-Effectiveness Audit
- **L502** Methodology Report (sole consumer)
- **L508** Pick Diff + Jaccard

Matches the Tag 218 precedent (the only existing `false`, L282). Keep ALL Class-B artifact/alert/data steps `true` (see ci_changes). Do not touch L282.

---

## 2. Delete the broken metric + replace the gate
**Root-cause delete (`:303-308`):** in the nearest-day fallback, reject `entryDate === exitDate` by nulling `p0/p1` so `ret==null` and the ticker drops — kills the manufactured-zero at source.

**`_evalGroup` (`:371-403`):** keep `medianReturnPass`/`medianReturnFail` as DESCRIPTIVE fields (no external reader), add `zeroFracPass`/`zeroFracFail` (= exact-`0` count / length), and rebuild `evidenceGate` so `'ok'` requires ALL of: vintages>=4, both groups>=10, max(zeroFrac)<=0.10 AND not (failMed===0 with failedN>=10), medians within plausibility bounds, canonicalFrac>=0.80. Make `alphaVal=null` whenever `evidenceGate!=='ok'` (extend the existing line 382-384 null-condition) so the markdown sort (`:451-457`) and the report never rank on a contaminated alpha.

New gate strings (priority order): `insufficient-vintages-need-4`, `insufficient-samples-need-10-per-group`, `degenerate-zero-returns`, `implausible-median-return`, `unmatured-nearest-day-snapped`, else `ok`.

---

## 3. Eval-sanity gate (concrete thresholds)
Constants near `:49-50`: `MIN_VINTAGES=4`, `MIN_SAMPLES_PER_GROUP=10`, `ZERO_FRAC_MAX=0.10`, `CANONICAL_FRAC_MIN=0.80`, `MAX_PLAUSIBLE_MEDIAN_28D=60`, `MAX_PLAUSIBLE_MEDIAN_84D=150` (percent).

1. **Vintage/sample:** never `ok` below 4 vintages or 10 per group.
2. **Non-degeneracy:** never `ok` if `max(zeroFracPass,zeroFracFail) > 0.10`, or if `failMed===0 && failedN>=10` (kills today's 16 cases).
3. **Plausibility:** per-horizon, never `ok` if `|medianReturnPass|` or `|medianReturnFail|` exceeds the bound (60 @28d, 150 @84d). A +1642% median -> `implausible-median-return`. Applies identically to `byQuality` sub-buckets.
4. **True maturation:** track `canonicalFrac` (rows resolved via the `:300-302` canonical branch vs fallback); never `ok` if `< 0.80` -> `unmatured-nearest-day-snapped`. Keep the future-date skip at `:206`.
5. **Stale/empty artifact:** in `main()`, if `Object.keys(out).length===0` (or no method has any non-null horizon), write nothing and `process.exit(1)` with `::error::`.

---

## 4. Wire fitness/ rank-IC READ-ONLY over the FULL universe
Create `freeze-full-baseline.js` (mirror `freeze-fabless-baseline.js`) reading `picks-history/latest.json` (verified shape: `modes.{HYPERGROWTH,QUALITY_COMPOUNDER,TURNAROUND}` = arrays of 100 `{ticker,score,...}`; `evaluatedTickers[4737]`).
- `ranking[]` = pooled picks across modes, dedupe by ticker keeping max score, sort score desc, tie-break `localeCompare`.
- `evaluatedTickers` = all 4737; `universeSize=4737` (exercises the real 0.90 coverage gate at `measure.js:140`).
- **t0 must be PAST** (`frozenAt <= newestPrice - 84d`, i.e. `<= ~2026-03-24`) so horizons realize; else artifact correctly stays `PENDING_PRICES`.
- `preRegistration.horizonsDays=[28,84]`, `survivorshipKey='evaluatedTickers'`.

Run read-only: `"C:\Program Files\nodejs\node.exe" fitness/measure.js fitness/baselines/full-universe-<frozenAt>.json` — **no measure.js change**. Writes only `fitness/outputs/measure-<id>.json`. Deliverable = diff `naive{}` vs `conservative{}` rankIC/cohortSpread (`measure.js:170-184`) to quantify survivorship bias. Do NOT add to daily-pull in this project; when wired later, gate publish on `status==='ok'`.

---

## 5. Blast radius
Sole programmatic reader = `methodology-report.js` (render-only). It keys on `evidenceGate`/`alpha`/`ciLo95`/`ciHi95` (`:108-117`), never the medians. New not-`ok` states fall into `insufficientEvidence`, drop out of `neutral` — partition holds. `score-aggregator.js` + `methods/*.js` never read eval outputs; `effectivenessWeights` does not exist. fitness/ has zero current consumers. `index.html:60` is a static link only. Fix cannot regress scoring or fixture-hash.

---

## 6. Verification (absolute Node path)
1. `"C:\Program Files\nodejs\node.exe" tag28-tests.js` -> 155/155 incl. the fixture-hash test.
2. `"C:\Program Files\nodejs\node.exe" engine-cli-tests.js` -> 10/10.
3. `"C:\Program Files\nodejs\node.exe" tests/integration-anchor-test.js` -> 10/10 anchors.
4. `git diff --quiet tests/fixture-hash.txt` (byte-identical).
5. Eval-specific: exit 1 on empty/corrupt input; 0 ok-gate methods with `medianReturnFail===0`; a >60% median -> `implausible-median-return`; methodology-report regenerates and buckets partition; `fitness/measure.test.js` 29/29; measure.js touches only `fitness/outputs/`.

Every method/eval change includes a comment naming the failure mode it prevents (CONTEXT.md binding rule). Never edit `methods/index.js` from parallel agents; never `--no-verify`; never push unless Karl asks.
