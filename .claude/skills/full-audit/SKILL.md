---
name: full-audit
description: Comprehensive audit of the screener-data project. Use when asked to review, audit, or find bugs in the project. Covers code quality, correctness, workflow, data integrity, and performance.
context: fork
agent: general-purpose
effort: high
---

ultrathink

# Full Audit — screener-data

You are auditing the `screener-data` stock-screener project. Read broadly before drawing conclusions.

## Step 1 — Orient yourself

```!
git log --oneline -15
```

```!
ls -1 *.js scripts/*.js methods/*.js 2>/dev/null | head -60
```

## Step 2 — Read critical files

Read ALL of the following:
- `package.json` (dependencies, node version requirement)
- `watchlist.json` (first 30 lines — universe size)
- `methods/index.js` (full — method registry)
- `methods/runner.js` (full — how methods are evaluated)
- `methods/score-aggregator.js` (full)
- `methods/strategy-modes.js` (full)
- `generate-modes-report.js` (full)
- `pull-yahoo.js` (first 120 lines — entry point + concurrency)
- `.github/workflows/daily-pull.yml` (full)
- `.gitignore` (full)

## Step 3 — Targeted checks

### A. Method registry vs filesystem consistency

Count files in `methods/` that export a method (`module.exports.*id`), compare against entries in `methods/index.js`. Any mismatch causes tag28-tests.js to fail and aborts the entire run.

```!
grep -l "module.exports" methods/*.js | wc -l
```

```!
grep -c "file:" methods/index.js
```

List any `.js` files in `methods/` that are NOT referenced in `methods/index.js`:

```!
for f in methods/*.js; do base=$(basename $f); if ! grep -q "$base" methods/index.js; then echo "UNREGISTERED: $f"; fi; done
```

### B. Hard-fail steps without continue-on-error

Steps that fail without `continue-on-error: true` abort the entire workflow. Check every step in `daily-pull.yml`.

### C. Yahoo-finance2 instantiation pattern

Every file that does `require('yahoo-finance2')` must use `new YF()` if `.default` returns a class. Check:

```!
grep -rn "require('yahoo-finance2')" *.js scripts/*.js discovery/*.js 2>/dev/null
```

### D. loadStocks / filter(Boolean) crash risk

Any `filter(Boolean)` that may pass non-object values (strings, numbers) to method code accessing `.annual` or `.meta` is a crash risk.

```!
grep -n "filter(Boolean)" *.js scripts/*.js methods/*.js 2>/dev/null
```

### E. outputs/ directory guard

Scripts that write to `outputs/` must either create it first or the directory must exist. Check:

```!
grep -rn "outputs/" scripts/*.js *.js 2>/dev/null | grep -v "test\|spec" | head -30
```

```!
ls -la outputs/ 2>/dev/null || echo "outputs/ missing"
```

### F. Node version consistency

`package.json` engines field vs workflow `node-version`:

```!
grep -A2 '"engines"' package.json
```

```!
grep "node-version" .github/workflows/*.yml
```

### G. Env var mismatch — PULL_CONCURRENCY vs script-specific names

The workflow sets `PULL_CONCURRENCY` at the job level. Scripts may read different names (`PRICE_CONCURRENCY`, `EARNINGS_CONCURRENCY`). Check:

```!
grep -n "CONCURRENCY" .github/workflows/daily-pull.yml
```

```!
grep -rn "process.env.*CONCURRENCY" *.js scripts/*.js 2>/dev/null
```

### H. Secret / key exposure

Check for hardcoded API keys, tokens, or secrets in source:

```!
grep -rn "api.key\|apiKey\|API_KEY\|secret\|token" *.js scripts/*.js discovery/*.js 2>/dev/null | grep -v "process.env\|secrets\.\|//\|test\|spec" | head -20
```

### I. alert-state.json methodHistory leak

After Tag 150, the truncation step should `delete s.methodHistory` not `s.methodHistory = {}`.

```!
grep -A5 "Truncate alert-state" .github/workflows/daily-pull.yml
```

### J. Git repo size health

```!
git count-objects -vH 2>/dev/null | grep -E "count|size|in-pack"
```

### K. methods-history/ committed size

```!
du -sh methods-history/ 2>/dev/null || echo "methods-history/ not found"
ls methods-history/ | wc -l
```

## Step 4 — Synthesize findings

For each finding, report:
- **Severity**: CRITICAL / HIGH / MEDIUM / LOW
- **File:Line** where the issue lives
- **What breaks**: describe the failure mode concretely
- **Fix**: one-sentence remedy

Sort by severity. Start with CRITICAL. Be concise — skip anything that is already correctly implemented.
