# /audit — Precision Stock Quality Audit & Continuous Improvement

You are auditing the screener's classifications stock-by-stock with surgical precision.
Your job: ensure only LEGITIMATE companies appear in each tab — without losing the
true high-performers. This is a precision task. False negatives are as bad as false positives.

---

## TIME MANDATE — WORK FOR 3-4 HOURS MINIMUM, UNINTERRUPTED

**This is a deep audit task. You will work autonomously for AT LEAST 3-4 hours.**

Rules:
1. **Do not stop after the first checkbox passes.** The Definition of Done is the floor, not the ceiling.
2. **Do not ask for confirmation.** Make every decision yourself. Document your reasoning in code comments.
3. **Do not idle.** If a test or build is running, use the wait time to research (Phase 6).
4. **Commit every 20-30 minutes.** Each fix = its own commit. Frequent commits = bisectable history.
5. **When you finish all checkboxes:** start a new improvement cycle. Loop the audit. Find the next layer of bugs.
6. **Track total elapsed time** in your todo list. If you've worked less than 3 hours when "done":
   - You missed something. Re-audit borderline cases.
   - Research a new method from Phase 6 and implement it.
   - Run audit-classifications.js again and check the next 20 borderline stocks.
   - Add the next anchor (AMZN, TSLA, GOOG, AMD, TSM, LULU, ULTA — research and pick valid ones)
   - Add the next quarantine signature (high-SBC, negative shareholder equity, etc.)

**You must produce at minimum:**
- 8+ commits over the session
- 2+ new methods implemented
- 1+ research finding documented and adopted
- 20+ borderline classifications resolved
- Audit report with before/after for every anchor and quarantine stock

If you reach a natural stopping point before 3 hours: that's a signal that you should
go DEEPER, not stop. Re-read this section and continue.

---

## CORE PRINCIPLE — THE TWO ERRORS

Every classification has two failure modes. You must hunt both:

**FALSE POSITIVE (Type I):** A company appears in a tab where it doesn't belong.
Example: IONQ in Hypergrowth-Quality because of a single-quarter revenue spike.
Example: A recent SPAC in Quality-Compounder because of one good year.

**FALSE NEGATIVE (Type II):** A legitimate company is missing from a tab where it should be.
Example: CRDO not in HG because a method requires 5 years of data and CRDO is too young.
Example: PLTR not in Pre-Breakout because Profitability-State misclassified it as LOSS.

**The mandate:** eliminate Type I errors WITHOUT introducing Type II errors.
If a fix would exclude a known true-positive, it is the wrong fix. Find a smarter signal.

---

## ANCHOR STOCKS — THESE MUST NEVER BE WRONGLY EXCLUDED

These are validated true-positives. If your audit excludes any of them, you broke something.
Trace back and fix the underlying logic.

### Must appear in HG or Pre-Breakout:
- **NVDA** (Nvidia) — established hypergrowth, AI compute leader
- **CRDO** (Credo Technology) — Pre-Breakout 2023 → HG 2024
- **PLTR** (Palantir) — Pre-Breakout/HG (recently profitable, accelerating)
- **ALAB** (Astera Labs) — Pre-Breakout 2024
- **AVGO** (Broadcom) — established compounder with growth
- **NOW** (ServiceNow) — durable SaaS compounder with hypergrowth
- **MELI** (MercadoLibre) — LATAM hypergrowth ecommerce/payments

### Must appear in QC:
- **MSFT** (Microsoft) — flagship quality compounder
- **ASML** (ASML Holding) — semiconductor litho monopoly
- **COST** (Costco) — durable compounder
- **V** (Visa) — payments oligopoly
- **MA** (Mastercard) — payments oligopoly
- **GOOG/GOOGL** (Alphabet) — should appear somewhere prominent
- **META** (Meta Platforms) — quality + growth hybrid

If ANY of these are missing from their expected category: the methods or filters are too strict.
Fix the methods, not the validation list.

---

## QUARANTINE LIST — KNOWN FALSE POSITIVE SIGNATURES

These companies have abnormal financial signatures that pollute rankings.
They must be excluded from HG / QC / SMALL CAP / R40 / PRE-BREAKOUT.
They may appear in WATCH only, tagged with the reason.

### Q-Spike / Single-Quarter Outliers (revenue jumped 100%+ in one quarter):
- **IONQ** (IonQ) — quantum hype, single-quarter contract spikes
- **SOUN** (SoundHound AI) — AI hype, lumpy revenue
- **RGTI** (Rigetti Computing) — quantum, micro-revenue volatility
- **BBAI** (BigBear.ai) — government contract lumpiness

### Pre-IPO / Insufficient History:
- Any company with `annualRev.length < 3` AND `marketCap > 1B`
- SPAC-acquired companies with restated financials

### Accounting Artifacts:
- One-time gains booked as revenue (rare but real)
- Massive deferred revenue recognition shifts

**Do not hardcode tickers into method logic.** Instead, build signatures that
catch the PATTERN. Hardcoded ticker exclusions are brittle.

---

## AUDIT WORKFLOW

### PHASE 1: INVENTORY

Run this first to understand current state:
```bash
node generate-screener.js
# Output should show counts per tab: HG, QC, SMALL, R40, PRE_BREAKOUT, WATCH
```

Read the generated `screener.html` and verify:
- Anchor stocks present in expected tabs
- Quarantine stocks NOT present in HG/QC/SMALL/R40/PRE-BREAKOUT
- Pre-Breakout tab has visible rows (not empty due to filter defaults)
- Filter defaults don't hide everything

### PHASE 2: PER-STOCK AUDIT (programmatic)

Write a one-off script `audit-classifications.js` that:

1. Loads every snapshot from `./snapshots/`
2. Runs every method against it
3. For each stock-tab combination, evaluates:
   - **Eligibility:** which methods caused the classification?
   - **Red flags:** Q-spike present? IPO-age < 3y? Data quality D?
   - **Score legitimacy:** is the score driven by 1 quarter or 8+ quarters?
4. Outputs a report `audit-report.json` and `audit-report.md` with:
   - Top 20 SUSPICIOUS classifications per tab (high score, weak underlying data)
   - Top 20 BORDERLINE classifications (just barely qualified)
   - Anchor stock report: which anchors are missing? Why?
   - Quarantine signature report: how many stocks match each signature?

The audit script is a TOOL for you to find bugs. Do not commit it to main.
It lives in the repo as `audit-classifications.js` in the root, gitignored.

### PHASE 3: BUG HUNTING — Q-SPIKE & DATA-QUALITY GATES

**Q-Spike detection improvement:**
Read `methods/q-spike-dataguard.js`. Verify:
1. It triggers on any quarter where `revQ[i] / median(revQ[i+1:i+8]) > 3.0`
2. It also triggers on `revQ[i] / revQ[i+1] > 2.5` (sudden quarterly doubling)
3. It triggers when `annualRev.length < 2` (insufficient history)

Apply q-spike-dataguard as a HARD GATE for HG/QC/SMALL/R40/PRE-BREAKOUT classification
in `generate-screener.js`. Stocks failing the gate go to WATCH only.

**Data-quality grade gate:**
Stocks with `_quality.grade === 'D'` must not appear in HG/QC/PRE-BREAKOUT.
Stocks with `_quality.grade === 'C'` may appear in WATCH/R40 but flagged.

**IPO-age gate:**
Stocks with `annualRev.length < 3` cannot be classified as Quality-Compounder
(which requires multi-year consistency). They may be HG or Pre-Breakout
candidates IF data is consistent across all available quarters.

### PHASE 4: ANCHOR REPAIR

For each anchor stock in the list above:
1. Check current classification: which tab is it in?
2. If wrong tab or missing: read its snapshot, run methods manually, trace WHY
3. Diagnose: is it a method bug? A threshold issue? A data-quality false-flag?
4. Fix the root cause. Document the fix in the relevant method's comments.

Common anchor-repair patterns to look for:
- CRDO/ALAB: young companies — q-spike-guard may over-trigger. Tune the guard
  to distinguish "growth-driven sequential revenue increase" from "one-off spike."
- PLTR: profitability-state classification — recent transition to profitable should
  be RECENT or TURNAROUND, not LOSS.
- Anchor missing from HG: hypergrowth-quality-class.js may require thresholds that
  the anchor barely misses. Investigate the threshold rationale.

### PHASE 5: NEW SAFEGUARDS

Implement these new guards (or update existing ones):

1. **`methods/single-quarter-dependency.js`** (new)
   - Returns FAIL if removing the top quarter from the TTM calculation
     would drop revenue growth by more than 50%
   - Catches companies whose growth is dependent on one anomalous quarter

2. **`methods/listing-age.js`** (new)
   - Returns the number of fiscal years of clean data available
   - Used by score-aggregator to penalize <3y history in QC scoring

3. **Update `q-spike-dataguard.js`:**
   - Add quarterly-relative threshold (not just annual-relative)
   - Add detection for revenue dropping >50% then recovering (V-shaped data)

4. **Update `score-aggregator.js`:**
   - Multiply final score by `(1 - q_spike_penalty)` where penalty is 0–0.5
   - Multiply by `min(listing_age_years / 5, 1.0)` for QC tab only

### PHASE 6: RESEARCH LOOP

While tests run / files compile / commits push, research:

1. "stock screener false positive elimination methodology"
2. "revenue quality robust scoring trimmed mean"
3. "single-quarter revenue spike detection algorithm"
4. "IPO age fundamental signal reliability"
5. site:ssrn.com "quality factor" "outlier handling"
6. site:github.com "stock screener" "outlier" "robust"
7. "winsorization financial metrics"
8. "median absolute deviation outlier detection finance"

For each finding: evaluate if it improves Phase 3 or Phase 5. If yes: implement.
If no: document in comment: `// RESEARCHED [date]: [finding] — rejected because [reason]`

---

## FILTER UI IMPROVEMENTS

The current screener.html is missing filters. Add them:

### Required filters (in this order, after existing State/Cap filters):

1. **Country dropdown**
   - Read `meta.country` from snapshots; fall back to `region-mapping.js` if absent
   - Sorted alphabetically, "All Countries" as first/default option
   - Right of Sector dropdown

2. **IPO-age filter (button row):**
   - `[All] [IPO <1Y] [IPO <2Y] [IPO <5Y] [Etabliert >5Y]`
   - IPO age = annualRev.length OR meta.ipoDate if available
   - Default: All active

3. **Data-Quality filter (button row):**
   - `[A+] [A] [B] [C] [D]` — multi-select
   - Default: A+/A/B active (C and D disabled)

4. **Profitability toggles:**
   - `[ ] Only GAAP-profitable` (Net Income TTM > 0)
   - `[ ] Only FCF-positive` (FCF TTM > 0)
   - Default: both off

5. **R40 Range slider:**
   - Min: 0, Max: 200
   - Two thumbs for [Min — Max]
   - Default: [0 — 200] (no filtering)
   - Lets user exclude unhealthy hot values like R40 > 100

6. **Sort-by dropdown:**
   - `Score ▼ | R40 ▼ | Rev Growth ▼ | FCF Margin ▼ | MCap ▼ | ΔScore ▼ | PB-Score ▼`
   - Default per tab: tab's primary score metric

### Pre-Breakout Tab specific fix:

CRITICAL: the tab-specific min-growth filter is hiding all 41 Pre-Breakout candidates.
- Default tab-specific filter value: 0 (not 25)
- Reset tab-specific filter to 0 whenever user switches tabs
- Pre-Breakout default sort: PB-Score descending (already correct)

---

## VALIDATION — DEFINITION OF DONE

After all changes, regenerate and verify:

```
[ ] node generate-screener.js completes without errors
[ ] Pre-Breakout tab shows ≥30 visible rows immediately on tab open
[ ] IONQ NOT in HG, QC, SMALL, R40, PRE-BREAKOUT (only WATCH if anywhere)
[ ] SOUN, RGTI, BBAI NOT in HG/QC/SMALL/R40/PRE-BREAKOUT
[ ] NVDA in HG with score ≥ 60
[ ] CRDO in HG or Pre-Breakout (NOT WATCH, NOT missing)
[ ] PLTR in HG or Pre-Breakout, profitability state ≠ LOSS
[ ] ALAB in HG or Pre-Breakout
[ ] MSFT in QC with score ≥ 60
[ ] ASML in QC
[ ] AVGO, NOW, MELI present in HG (or strong reason documented why not)
[ ] V, MA, COST in QC (or documented why not)
[ ] Country filter functional with all unique countries
[ ] IPO-age filter functional (5 buttons)
[ ] Data-Quality filter functional (5 grade buttons, default A+/A/B)
[ ] GAAP-profitable + FCF-positive toggles functional
[ ] R40 Range slider functional with min+max thumbs
[ ] Sort-by dropdown functional
[ ] q-spike-dataguard applied as HARD GATE
[ ] data-quality grade D excluded from HG/QC/PRE-BREAKOUT
[ ] IPO-age <3y blocked from QC tab
[ ] New methods/single-quarter-dependency.js created and integrated
[ ] New methods/listing-age.js created and integrated
[ ] q-spike-dataguard.js updated with quarterly-relative threshold
[ ] score-aggregator.js applies q_spike_penalty and listing_age multiplier
[ ] audit-classifications.js created (gitignored), generates audit-report.md
[ ] audit-report.md shows zero suspicious classifications in top 20 per tab
[ ] node tag28-tests.js passes
[ ] git commit as Tag 199 with message:
    "Tag 199: Precision audit — Q-spike hard gate, listing-age guard, anchor repair, expanded filters"
```

---

## OPERATING RULES

1. **Never exclude an anchor stock to pass a guard.** If a guard excludes CRDO, the guard is wrong, not CRDO.
2. **Hardcoded ticker exclusions are forbidden.** Build pattern-based signatures.
3. **Every method change must include a comment explaining the failure mode it prevents.**
4. **Run the audit script after every method change** — verify no anchor regressed.
5. **Commit frequently** — every fixed bug = one commit. Easier to bisect later.
6. **When in doubt about a threshold:** look at what value WOULD include the anchor stocks
   and exclude the quarantine stocks. That's your range. Pick a value in the middle.

---

## CONTINUOUS IMPROVEMENT AFTER TAG 199

After Tag 199 ships, do NOT stop. Continue:

1. Re-run audit-classifications.js → review top 20 borderline per tab → refine
2. Research one topic from Phase 6 → implement one improvement → commit
3. Look for the next anchor that should be added to the list (e.g. AMZN, TSLA, GOOG)
4. Look for the next quarantine signature (e.g. companies with massive SBC/Revenue ratios)
5. Loop forever — every iteration improves precision without sacrificing recall

---

*This skill lives at `.claude/commands/audit.md`. Type `/audit` in Claude Code to invoke.*
*Combine with `/goal` for persistent goal-tracking: `/goal Complete /audit until all DEFINITION OF DONE checkboxes pass`*
