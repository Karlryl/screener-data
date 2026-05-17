# Tag 217c — Older Methods Audit (N–Z)

Date: 2026-05-17
Scope: ~34 older method files in `methods/` starting with letters N–Z that
were NOT covered by the Tag 209–215 finding cycles or the Tag 216 audit.
Mode: read-only, code review against the 10 standard bug categories plus
method-specific concerns (anchor-safety, IPO-age, sector adjustments,
dataGuard correctness).

## 1. Executive summary

- 34 files audited.
- 6 findings: 1 HIGH, 3 MEDIUM, 2 LOW.
- 28 clean files (no actionable issues at this audit pass).
- Headline finding (HIGH): `opinc-margin-spike.js` skips the `_unwrap` helper
  and reads `revs[0].value` / `ois[0].value` directly. Today every snapshot
  delivers these as envelopes so the method works, but the moment Yahoo
  changes shape for any field (it already did for `annualSBC` — plain
  number) the method goes silently incomputable. Sister-bug to F-ME-002 in
  sbc-revenue (already fixed); same family of envelope-vs-scalar trap.
- Hard-gates (q-spike-dataguard, single-quarter-dependency,
  pre-commerciality-megacap-guard) are sound. No anchor-killer pattern
  detected.

## 2. Methodology — files read in full

Files audited (alphabetic, excluding files already covered in Tag 209–216
audits — those skipped are marked in the prompt):

```
net-income-volatility-guard.js   operating-cashflow-coverage.js
operating-leverage.js            operating-margin-acceleration.js
opinc-margin-spike.js            peg.js
piotroski-f-score.js             pre-commerciality-megacap-guard.js
premium-compounder-proof.js      profitability-state.js
profitability-trend.js           q-spike-dataguard.js
quality-compounder-roic.js       quarter-concentration-guard.js
quarterly-earnings-stability.js  quarterly-revenue-acceleration.js
r40-sanity-cap.js                reinvestment-rate.js
revenue-acceleration-yoy.js      revenue-growth-3y.js
revenue-quality.js               revenue-shock-guard.js
revenue-volatility-guard.js      roic.js
roic-trend.js                    rule-of-40.js
rule-of-x.js                     sbc-growth-ratio.js
sbc-revenue.js                   sbc-trend.js
single-quarter-dependency.js     stable-quarterly-growth.js
volatility-annualized.js         working-capital-anomaly.js
```

Cross-validated envelope/scalar assumptions against fresh snapshots
(NVDA, MSFT, PLTR, META, COST, GOOG, AVGO, MELI, V, CRDO). Observed:
`annualRev[i]`, `annualOpInc[i]`, `annualNetIncome[i]`, `annualFCF[i]`
arrive as `{value: N}` envelopes; `annualSBC[i]` arrives as a plain
number (or `null`); `annualBalance[i].{totalAssets,totalDebt,totalCash}`
arrive as plain numbers. Mixed shapes confirmed live, which makes the
envelope-vs-scalar bug class real.

## 3. Findings

### F-217c-01 — HIGH — opinc-margin-spike.js:21-23 — envelope-vs-scalar bug

- File: `methods/opinc-margin-spike.js`, lines 20-23.
- Bug class: 5. Object envelope ({value:x} vs scalar).
- Description: All four field reads use bare envelope access without an
  `_unwrap` helper:
  ```
  const revT  = revs[0] && revs[0].value;
  const revT1 = revs[1] && revs[1].value;
  const oiT   = ois[0]  && ois[0].value;
  const oiT1  = ois[1]  && ois[1].value;
  ```
  If any of those positions is delivered as a plain `Number` rather than
  the `{value: N}` envelope, the `.value` access returns `undefined`,
  the subsequent `null`-check sends the method into `computable:false`
  silently, and the OpInc-Margin spike check is skipped — including the
  classes (M&A bookings, one-time gains) the guard exists to catch.
- Mechanism: Yahoo already mixes shapes (annualSBC is plain number in
  the current snapshots; annualRev/annualOpInc are envelopes). One more
  schema drift on annualRev / annualOpInc and this method dies silently.
- Current production status: works today because all live snapshots use
  envelopes for rev/oi. Latent until upstream shape changes.
- Suggested fix: inline an `_unwrap` mirroring the canonical helper used
  in `net-income-volatility-guard.js`, `revenue-acceleration-yoy.js`,
  etc.; replace the four bare accesses with `_unwrap(revs[i])` /
  `_unwrap(ois[i])`. Two-line change.

### F-217c-02 — MEDIUM — sbc-revenue.js:27 — envelope-gap on `rev`

- File: `methods/sbc-revenue.js`, line 27.
- Bug class: 5. Object envelope ({value:x} vs scalar).
- Description: F-ME-002 (Tag 179) hardened the SBC read with both
  envelope-unwrap and `Math.abs`. The `rev` read one line below was
  missed:
  ```
  const rev = revArr[0] && revArr[0].value;   // <-- bare envelope access
  ```
  If `revArr[0]` is a plain number (Yahoo already does this for SBC),
  `rev` collapses to `undefined`, the method goes incomputable, and the
  dilution diagnostic — referenced by `capital-allocation-quality` —
  goes dark. Twin of F-217c-01, same fix shape.
- Suggested fix: replicate the `_unwrap` helper used for SBC and apply
  it to rev. Lift the helper to a module-level function for clarity.

### F-217c-03 — MEDIUM — revenue-growth-3y.js:49 — description / threshold mismatch

- File: `methods/revenue-growth-3y.js`, line 49 (module.exports `description`).
- Bug class: 9. Citation/threshold mismatch.
- Description: Tag 201c lowered the threshold from 25% → 22% to admit
  AVGO (24.4%) and NOW (22.4%) into HG. The exported `description`
  still reads:
  ```
  description: 'Revenue Growth 3-Year-CAGR ≥ 25% (...)'
  ```
  The number-vs-text mismatch leaks into the UI scorecard tooltip and
  the methods-history JSON, where users see "≥25%" while the
  classifier uses 22%. Pure metadata drift, no computational impact.
- Suggested fix: update description to `≥ 22%` to match `THRESHOLD = 22`.

### F-217c-04 — MEDIUM — volatility-annualized.js:34-40 — weekly-detection samples only the last 2 points

- File: `methods/volatility-annualized.js`, lines 34-40.
- Bug class: method-specific (frequency-detection fragility).
- Description: The daily-vs-weekly heuristic sniffs only the gap
  between `series[length-2]` and `series[length-1]`:
  ```
  const d0 = Date.parse(series[length-2].date);
  const d1 = Date.parse(series[length-1].date);
  const avgDaysBetween = (d1 - d0) / DAY_MS;
  if (avgDaysBetween >= 4) { ... weekly ... }
  ```
  A US-holiday-extended weekend (e.g. Thu close → following Tue) can
  push the last gap to 5 days even for genuine daily series, flipping
  the path to weekly (lookback=52, annualFactor=52). The resulting
  annualized vol drops by sqrt(252/52) ≈ 2.2×, which can move a high-
  vol stock falsely into the pass band (THRESHOLD=0.50). The inverse
  also exists: a single missing weekly bar makes a real weekly series
  look daily.
- Mechanism: relying on a single inter-bar gap is brittle. Median or
  mean of the last N gaps is the standard fix.
- Suggested fix: compute median gap over the last 10 bars (or count
  bars per 30-day window) before deciding daily-vs-weekly. Keep the
  ≥4-day cutoff but apply it to the median.

### F-217c-05 — LOW — quarterly-revenue-acceleration.js (whole file) — no seasonality adjustment

- File: `methods/quarterly-revenue-acceleration.js`, full file.
- Bug class: method-specific (seasonality blindspot).
- Description: The method computes raw Q/Q-1 ratio with no Q/Q-4
  baseline. A retailer's Q4 → Q1 is naturally negative for non-
  seasonality-adjusted businesses; the method will flag them as
  decelerating even when the YoY seasonal pattern is intact.
- Mitigation: this is a DIAGNOSTIC (not a SCORE_WEIGHTS hard-gate)
  and other methods (quarter-concentration-guard, q-spike-dataguard,
  revenue-shock-guard) already carry seasonality awareness for the
  important sectors. Marked LOW because the failure mode is "wrong
  diagnostic signal", not "wrong pass/fail on a hard gate".
- Suggested fix (optional): compare Q[0] to Q[4] (year-ago same Q)
  rather than Q[0] to Q[1], or carve out the seasonal-industry list
  used in q-spike-dataguard.

### F-217c-06 — LOW — revenue-volatility-guard.js:73 — `||` falls through on `revenueTTM = 0`

- File: `methods/revenue-volatility-guard.js`, line 73.
- Bug class: 1. Operator precedence (`||` zero-fallthrough).
- Description:
  ```
  const ttmRev = H.metricValue(stock, 'revenueTTM') || (Number.isFinite(revY[0]) ? revY[0] : 0);
  ```
  If `revenueTTM` is exactly 0 (a real, if rare, value for a pre-rev
  company), the `||` falls through to the annual rev fallback. For
  this guard the consequence is benign: ttmRev ends up either 0 or
  the annual value, both of which produce reasonable behaviour
  (immaterial-pass or run the full check). But the same pattern in
  any other method where 0 is a meaningful signal would be a bug.
- Mechanism: classic Tag 179 F-ME-009 family.
- Suggested fix: replace `||` with explicit `metricValue !== null ?
  metricValue : ...` for consistency with the rest of the codebase.
  Low priority because the downstream behaviour is harmless here.

## 4. Clean files (no actionable issues this pass)

```
net-income-volatility-guard       operating-cashflow-coverage
operating-leverage                operating-margin-acceleration
peg                               piotroski-f-score
pre-commerciality-megacap-guard   premium-compounder-proof
profitability-state               profitability-trend
q-spike-dataguard                 quality-compounder-roic
quarter-concentration-guard       quarterly-earnings-stability
r40-sanity-cap                    reinvestment-rate
revenue-acceleration-yoy          revenue-quality
revenue-shock-guard               roic
roic-trend                        rule-of-40
rule-of-x                         sbc-growth-ratio
sbc-trend                         single-quarter-dependency
stable-quarterly-growth           working-capital-anomaly
```

Notable robustness observations during review:

- `single-quarter-dependency.js`, `quarter-concentration-guard.js`,
  `revenue-shock-guard.js` all use raw positional arrays with explicit
  finite-checks at the indices they read — a clean pattern that
  prevents the calendar-misalignment bug class.
- `profitability-state.js` correctly handles the y0 == 0 (breakeven)
  edge case after the Bug #37 fix; persistent-loss-veto logic is
  defensible against ALNY-style spikes.
- `q-spike-dataguard.js` pattern-based quantum-stage detector (Tag
  206n) is a good replacement for the prior ticker-list and still
  spares CRDO/PLTR (verified by sniff-testing the rule against the
  snapshots).
- `premium-compounder-proof.js` correctly treats check #6 (OCF +
  R&D) as soft-N/A when source data is missing rather than auto-
  failing.

## 5. Patterns observed

1. Envelope-vs-scalar drift is the dominant latent risk class. Two of
   the five reviewed methods (`opinc-margin-spike`, `sbc-revenue`) still
   carry the bare `arr[i] && arr[i].value` pattern. The other ~30 files
   reviewed already use either `_unwrap` (local) or `H.metricValue` /
   `H.latestAnnual` / `H.latestBalance` (helpers). Recommend a one-
   shot grep+fix sweep targeting `&& [a-z]+\[\d?\]\.value` patterns to
   close the class.

2. Description-vs-threshold drift after Tag 201c retunes (`revenue-
   growth-3y` description still says 25%). A small `npm test`
   assertion that `module.exports.description` mentions the same
   number as `THRESHOLD` would catch these.

3. The hard-gate DATAGUARDs (`q-spike-dataguard`, `single-quarter-
   dependency`, `pre-commerciality-megacap-guard`, `revenue-shock-
   guard`, `revenue-volatility-guard`, `r40-sanity-cap`) all show
   anchor-safety design — every one explicitly lists the named
   anchors (NVDA / MSFT / PLTR / META / COST / etc.) it deliberately
   passes, and the snapshot-derived numbers in the docstrings hold.

4. Hot path uses `Math.ceil` → `Math.round` for window-scaled
   thresholds (already fixed in `piotroski`, `quarterly-earnings-
   stability`); pattern is consistent.

5. Helper-pattern divergence: 7 files inline their own `_unwrap`
   (correctly), 5 files use `H.metricValue` (correctly), 2 files use
   bare `&& .value` (F-217c-01 + F-217c-02). Lifting `_unwrap` into
   `_helpers.js` would make the right pattern the path of least
   resistance.
