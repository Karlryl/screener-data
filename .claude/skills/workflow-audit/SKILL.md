---
name: workflow-audit
description: Deep audit of the GitHub Actions workflows. Use when a run fails, when the workflow changes, or when you want to check for timeout/retry/secret/size issues.
context: fork
agent: general-purpose
effort: high
---

ultrathink

# Workflow Audit — .github/workflows/

## Step 1 — Read all workflows

```!
cat .github/workflows/daily-pull.yml
```

```!
cat .github/workflows/monthly-sec-xbrl.yml
```

## Step 2 — Structural checks

### Hard-fail steps (no continue-on-error)

List every step that does NOT have `continue-on-error: true`. These abort the run on failure.

### Timeout analysis

The job timeout is 180 min. List each step with its own `timeout-minutes`. Calculate if the sum of hard-fail steps could exceed the job timeout.

### Step ordering

Check that every hard-fail step comes BEFORE the steps it guards. Specifically:
- Engine tests should run before Yahoo pull
- Quality gate should run after Yahoo pull
- Commit step should run last (after all generators)

## Step 3 — Secret / env var audit

List all `${{ secrets.* }}` references. Check each has a fallback or `continue-on-error` if the secret might be absent (e.g. `DISCORD_WEBHOOK`).

List all `env:` variables set at job vs step level. Check for mismatches (a script reading `PRICE_CONCURRENCY` when the job sets `PULL_CONCURRENCY`).

## Step 4 — Git commit / push resilience

Review the "Commit Snapshots" step:
- Does `git commit` failure get detected before the push loop?
- Does the push loop retry logic handle the case where GitHub rejects a file > 100 MB?
- Does the truncation guard permanently delete `methodHistory` (delete key) vs set to `{}` (key remains)?

## Step 5 — Deploy step

Review the "Deploy to GitHub Pages" step:
- Does `cp -r outputs/ _site/outputs/` create a double directory? (Should be `outputs/.`)
- Does the `if:` condition actually guard against deploying stale artifacts?
- Does `git push --force origin gh-pages` have branch protection risk?

## Step 6 — Repo size risk

Estimate daily growth from committed artifacts:
- `methods-history/` files per day × size
- `picks-history/` files per day × size
- `alert-state.json` post-strip size
- `snapshots/` directory

Flag anything on a trajectory to hit GitHub's 100 MB per-file or 1 GB repo limits.

## Step 7 — Synthesize

Report findings as a table:

| Step name | Issue | Severity | Fix |
|---|---|---|---|

Severity: CRITICAL (breaks runs now) / HIGH (will break within weeks) / MEDIUM / LOW.
