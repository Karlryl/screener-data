---
name: methods-audit
description: Audit all method files in methods/. Use when adding new methods, debugging scoring, or checking method registry consistency.
context: fork
agent: Explore
effort: high
---

ultrathink

# Methods Audit — methods/

## Step 1 — Registry vs filesystem

```!
ls methods/*.js | grep -v runner.js | grep -v index.js | grep -v score-aggregator.js | grep -v strategy-modes.js | sort
```

```!
grep "file:" methods/index.js | sort
```

For each `.js` in `methods/` that exports an `id`: verify it appears in `methods/index.js`. List any that are missing (→ tag28-tests will fail).

## Step 2 — Read runner and index

Read `methods/runner.js` and `methods/index.js` in full. Understand:
- How METHODS array is built
- How `evaluate()` is called
- How thresholds are applied

## Step 3 — Per-method consistency checks

For each method file, check:

1. **Export shape**: must export `{ id, evaluate, threshold, thresholdOp }` (or similar). Missing `id` → runner skips it silently.

2. **Threshold units**: `threshold: 0.15` means 15% (ratio). If value returned by `evaluate()` is a percentage (0–100), the threshold comparison is wrong.

3. **Data guards**: does the method handle missing `stock.annual`, missing `stock.meta`, empty arrays gracefully? An uncaught TypeError in any method crashes `runner.js` for that stock.

4. **GBp pence handling**: methods that use `stock.meta.marketCap` or price data should not assume USD. Check if currency conversion is upstream (in pull-yahoo.js snapshot) or needs to be inside the method.

## Step 4 — Score aggregator

Read `methods/score-aggregator.js`. Check:
- `computeScore()` signature and `methodRegistry` parameter: is it ever called with `null`?
- Sloan ratio threshold: should be `> 0.30` (ratio), not `> 30` (percentage)
- Weights sum: do all mode weights add up correctly?

## Step 5 — Strategy modes

Read `methods/strategy-modes.js`. Check:
- `_getMethodRegistry()` — does it correctly load the registry or return null?
- `acceptValues` component key lookup: `profitability-state` uses `components.state`, `profitability-trend` uses `components.trend`. Does the code check both?
- `evaluatedTickers` population: is it filled from `loadStocks()` universe (not just one mode's loop)?

## Step 6 — Tag28 test compatibility

Read `tag28-tests.js` (first 80 lines). Understand what it counts and compares. Confirm the count in the test matches the number of method files registered in `methods/index.js`.

## Step 7 — Synthesize

| Method file | Issue | Severity | Fix |
|---|---|---|---|

Flag CRITICAL for anything that causes tag28-tests to fail (aborting the whole run).
Flag HIGH for anything that causes incorrect scoring or silent data corruption.
