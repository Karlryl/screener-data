# Threshold-Discipline Policy

> **SUPERSEDED / WARNING (Stand 2026-07-19):** this policy predates the
> project's binding Hardcoded-Ticker-/Präregistrierungs-Invariante
> (`CONTEXT.md`, `CLAUDE.md`: "Hardcoded ticker exclusions are forbidden").
> The examples and instructions below that tell you to **add a named ticker**
> to a whitelist or exclude-list (e.g. "add-to-list IONQ", "add NVDA to
> whitelist for guard", the per-mode `excludeList` guidance) are **exactly
> that forbidden pattern — do not follow them.** No ticker identity may
> determine a rule parameter, neither as an exclude nor as a whitelist entry;
> use a pattern/regex-based signature instead, and route any resulting
> threshold change through pre-registration + walk-forward, not through which
> named ticker it fixes. The "Literature reference alone" justification
> (§ What counts as evidence, item 3) is likewise insufficient on its own — a
> literature-motivated threshold is a **hypothesis** that still has to clear
> the full Gauntlet/walk-forward validation before adoption, same as any
> other candidate. A full policy rewrite is deferred to Karl; until then,
> treat every ticker-identity instruction below as void. Paths below
> (`methods/*.js`, `methods/score-aggregator.js`) refer to a removed engine
> generation — the active engine is `src/scoring/`.

**Tag 129 — Behavioural rule, not enforced by code. Historical text below,
partially voided by the banner above.**

## Rule

Numeric thresholds in `src/scoring/` change **only** when triggered by multi-period, multi-ticker evidence confirmed out-of-sample. Single-ticker observations result in a regex-based sector/industry exclude — **never** a numeric adjustment and **never** a per-ticker whitelist/exclude entry (see banner above).

## Why

The data-snooping audit (`outputs/audits/01-bias-audit.md` — Phase 4) found that 10 of the last 50 commits adjusted numeric thresholds because a single ticker surfaced wrong. Each individual change was defensible. The cumulative effect is overfit-by-thousand-cuts against the observed universe.

Examples of how this rule classifies past changes:

| Past commit | Trigger | Disposition under this rule |
|---|---|---|
| Tag 113e (q-spike OI 3.0 → 2.0) | IONQ surfaced wrong | **Forbidden** under rule. Should have been: regex-exclude "quantum computing" or add-to-list `IONQ`. |
| Tag 113f (Annual-Revenue-Decline-Check) | IONQ persisted | **Forbidden.** Same. |
| Tag 121c (q-spike Hard → Soft → Hard) | IONQ thrash | **Forbidden.** Architecture should not be modulated by one ticker. |
| Tag 121e (revenue-volatility-guard) | SPHR surfaced wrong | **Borderline.** Numeric threshold but with logic generalisable; would have been better as exclude. |
| Tag 121e (Healthcare-Plans regex) | OSCR surfaced wrong | **Allowed.** Sector-shape change, not numeric. |
| Tag 116b (MIN_MCAP $2B → $1B) | Universe gap | **Allowed.** Universe-shape change, not threshold-tune. |
| Tag 120d (revenue-shock Hard → Soft) | NVDA invisible | **Forbidden under rule.** Should have been: add NVDA to whitelist for guard, or change guard scope by industry. |

## What counts as multi-period, multi-ticker evidence

A numeric threshold change is **allowed** when at least one of the following holds:

1. **3+ tickers** in different sub-industries show the same problem with the current threshold, and the proposed new value fixes all 3 without introducing new false positives.
2. **2 different periods** (e.g. running the screener against the 2023 universe and the 2025 universe both flag the same systematic miss) confirm the gap is structural, not noise.
3. **Literature reference** justifies a different value (e.g. updating Rule-of-40 to Rule-of-X based on Bessemer's analysis).
4. **First-principles correction** (the prior threshold was demonstrably wrong by order of magnitude — e.g. NaN-ratio 50% obviously too generous).

## What to do instead for single-ticker observations

| Scenario | Action |
|---|---|
| One stock has a unique business model that the screener mis-categorizes | Add to per-mode `excludeList` |
| Whole industry has a structural quirk (e.g. clinical-stage biotech, REITs) | Add regex to `excludeSectors` |
| Stock has a data-quality issue (Yahoo wrong) | Open Tag for `pull-yahoo.js` validation, not for the screening method |
| Stock has a one-off event (M&A, FDA approval) you want to treat differently | Use the soft-guard / launch-inflection mechanism (Tag 127), not a hard threshold |

## Enforcement

This is a behavioural policy. Not enforced by tooling.

When opening a Tag for a numeric threshold change, the commit message should include:
- The exact prior and new value
- The evidence (multi-ticker list OR period comparison OR literature ref)
- Why a regex/exclude-list was not sufficient

If those three lines are missing, the change is suspect under this policy and should be reverted or restructured.

## Self-check before commit

Before merging any change that touches a numeric constant in `src/scoring/` (formerly `methods/*.js` / `methods/score-aggregator.js`, removed):

```
[ ] Did this change originate from observing exactly one ticker?
[ ] If yes, can I instead add that ticker (or its industry) to an exclude list?
[ ] If I still want to change the threshold, do I have evidence from 3+ tickers or 2+ periods?
[ ] Does the commit message explain the evidence?
```

If the first two answers are "yes/no", the discipline is broken.
