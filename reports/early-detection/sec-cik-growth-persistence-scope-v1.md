# SEC-CIK Growth Persistence Study — Scope V1

Status: `DRAFT_PRE_OUTCOME`

Protocol: `SEC-CIK-GROWTH-PERSISTENCE@1.0.0`

## Purpose

This is a new, no-cost, public-evidence study. It tests whether a fully
pre-anchor SEC revenue/cash-flow trigger is associated with later *verifiable
filing persistence* of high revenue growth.

It is not an amendment, rerun, substitute result, or continuation result of
the sealed Growth-Screener Early-Detection V4 study. Original V4, its 13 gates,
its outcome ledger, and the completed Public-AI coverage path remain unchanged.

## Unit and source boundary

- Unit: one SEC registrant history identified by CIK.
- CIK is an SEC registrant identifier, not a permanent security identifier and
  not proof that the economic firm is unchanged through reorganizations.
- Source: the existing read-only SEC Financial Statement Data compact ledger,
  restricted to the earliest observed payload for each FSD quarter.
- Eligible forms: original `10-Q` and `10-K` only. Amendments are excluded.
- Eligible facts: consolidated, `coreg IS NULL`, USD facts using the frozen
  `FEM-SEC-CONCEPT-MAP@1.0.0` revenue and operating-cash-flow roles.
- Tickers, listing snapshots, prices, adjusted OHLCV, corporate actions,
  terminal sessions, and delisting returns are not inputs to this study.

## Cohort and anchor

- Common observation cutoff: `2014-06-30T23:59:59Z`.
- The exposure pass may query only SEC facts accepted no later than the common
  cutoff. This makes the information boundary identical for every CIK.
- For each CIK, choose the most recent fully computable fiscal quarter whose
  period end is no more than 183 days before the cutoff.
- The required pre-cutoff sequence is the current fiscal quarter plus eight
  preceding, exact fiscal quarters. Ambiguous, duplicated, discontinuous, or
  non-positive revenue bases fail closed.
- Every eligible CIK is included. There is no outcome-informed sample,
  replacement, ticker repair, or post-anchor eligibility decision.

This is therefore a coverage-bounded sample of seasoned, standard-concept-
computable SEC registrants. It is not all SEC registrants and not the US stock
market.

## Frozen exposure

For anchor quarter `q`, define quarterly revenue growth as year-over-year
growth against `q-4`. `TRIGGER_POSITIVE` requires all of:

1. revenue growth at `q` is at least 20 percent;
2. revenue growth at `q` exceeds the median of the four preceding quarterly
   year-over-year growth rates by at least 5 percentage points; and
3. the sum of operating cash flow for `q-3` through `q` is positive.

`TRIGGER_NEGATIVE` requires the same complete inputs with at least one
condition false. Missing or ambiguous inputs are pre-outcome exclusions, never
negative exposure.

## Frozen endpoint

The post-cutoff window is `(2014-06-30T23:59:59Z, cutoff + 455 days]`.
The four exact next fiscal quarters must be reconstructed only from SEC filings
accepted after the anchor.

- `VERIFIED_PERSISTENT`: at least three of the four next fiscal quarters have
  revenue growth of at least 20 percent, and last-four-quarter operating cash
  flow at the fourth quarter is positive.
- `VERIFIED_NOT_PERSISTENT`: all four next fiscal quarters are ascertainable
  and the persistence condition is false.
- `NO_VERIFIABLE_4Q_SEQUENCE`: the exact four-quarter endpoint cannot be
  verified within 455 days.

The third state remains visible for every anchor. It is not described as
business failure. For the primary *verifiable filing persistence* rate, only
`VERIFIED_PERSISTENT` is one; both other states are zero and remain separately
reported.

## Frozen primary analysis

Primary quantity: the risk difference

`P(VERIFIED_PERSISTENT | TRIGGER_POSITIVE) - P(VERIFIED_PERSISTENT | TRIGGER_NEGATIVE)`

over the complete sealed anchor cohort. Use the two-sided 95 percent Newcombe
confidence interval for the difference of two independent proportions.

- `SUPPORT`: lower confidence bound is greater than zero.
- `REJECT`: upper confidence bound is less than zero.
- `INCONCLUSIVE`: otherwise.

Any verdict is forced to `INCONCLUSIVE` if there are fewer than 40 trigger-
positive anchors, fewer than 80 trigger-negative anchors, or less than 90
percent four-quarter ascertainment. SIC summaries are descriptive only.

## Pre-outcome barrier

Before any post-anchor fact is read or materialized, a remote checkpoint must
bind the exact bytes of this scope, the claim contract, source-line manifest,
concept map, selector, tests, complete anchor/exposure cohort, three distinct
Codex-agent audits, and the still-empty study-specific outcome ledger.

The exposure pass must reject or quarantine every post-anchor fact. The endpoint
pass is a separate command and is forbidden until that checkpoint verifies.

## Mandatory claim locks

Every output must state:

- public SEC evidence only;
- coverage-bounded SEC registrants only;
- AI-audited, never HUMAN-attested;
- no stock returns, investability, breakout, H-LATE, H-FEM, or Original-V4
  conclusion;
- not full-market and not survivorship-safe;
- no claim that CIK is a permanent security identifier.
