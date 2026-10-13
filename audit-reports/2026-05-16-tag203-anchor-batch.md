# Tag 203 — META Dedup + Next Anchor Batch

Date: 2026-05-16
Agent: Audit Agent 13
Scope: dedup META across `ANCHORS_HG_PB` / `ANCHORS_QC`; verify next batch
(NFLX, COIN, ANET, SPGI, MCO, KO, MMC, AON) against the 6 hard-gates.

## PART 1 — META Dedup

Confirmed: META was listed in BOTH `ANCHORS_HG_PB` and `ANCHORS_QC`
(audit-classifications.js, gitignored). Profile (Communication Services,
~22% YoY growth, ~41% opMargin, ~29% FCF margin, ~$1.4T mcap) fits BOTH
profiles by mechanical thresholds, but classically:

- HG list = newer/faster names where growth dominates the thesis.
- QC list = durable compounders with mature margins and operating
  leverage. 22% growth at 40%+ margins and $1.4T scale is the
  canonical QC profile.

Action: **removed META from `ANCHORS_HG_PB`**; retained in `ANCHORS_QC`.

## PART 2 — Next Anchor Batch Verification

Source: `snapshots/{NFLX,COIN,ANET,SPGI,MCO,KO,AON}.json` (MMC missing).
Hard-gate inputs computed directly from each snapshot's `annual.*` and
`timeseries.revenueQ` arrays + `metrics.*` (no node execution).

### Per-anchor verdict

| Ticker | Sector | MCap | YoY% | opM% | fcfM% | lossMag ratio | NI-vol ratio | metricDiv (pp) | Q-largest share | DQ | Verdict | Tab | Action |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|
| NFLX | Comm Services / Entertainment | 369B | 16.2 | 32.3 | 55.4 | +0.295 | 0.050 | 2.8 | 26% | A (proxy) | ALL PASS | QC | **ADDED** |
| COIN | Financial Services / Exchanges | 55B | -30.8 | -7.1 | 38.3 | +0.203 | 0.379 | 27.4 | 28% | A | ALL PASS but profile-fail | (WATCH) | **SKIPPED** |
| ANET | Technology / Hardware | 179B | 35.1 | 42.7 | 44.9 | +0.428 | 0.073 | 0.1 | 28% | A | ALL PASS | QC (HG-dual) | **ADDED** to QC |
| SPGI | Financial / Data Oligopoly | 126B | 10.4 | 44.3 | 33.7 | +0.403 | 0.040 | 4.0 | 27% | A | ALL PASS | QC | **ADDED** |
| MCO  | Financial / Ratings Oligopoly | 79B | 8.1 | 45.7 | 28.8 | +0.448 | 0.052 | 0.8 | 27% | A | ALL PASS | QC | **ADDED** |
| KO   | Consumer Defensive / Beverages | 344B | 12.1 | 35.1 | 6.3 | +0.310 | 0.052 | 4.1 | 26% | A | ALL PASS | QC | **ADDED** |
| MMC  | (no snapshot) | — | — | — | — | — | — | — | — | — | NO_SNAPSHOT | QC (expected) | **SKIPPED** (Tag 204) |
| AON  | Financial / Insurance Brokers | 68B | 6.5 | 35.8 | 19.1 | +0.274 | 0.061 | 8.4 | 28% | A | ALL PASS | QC | **ADDED** |

Hard-gate column key:
- `lossMag ratio` = annualOpInc[0]/annualRev[0] (threshold ≥ -0.50)
- `NI-vol ratio` = max(|Δ annualNetIncome|)/annualRev[0] (threshold ≤ 1.0)
- `metricDiv` = |TTM opM − annual opM| in pp (threshold ≤ 1000)
- `Q-largest share` = max(quarterly rev) / sum(last 4Q rev) (q-spike not
  triggered because none of these have YoY > 100%)
- Closed-end-trust guard: not applicable (no trust-style industry).
- Pre-commerciality-megacap guard: not applicable (all have material rev).

### Notes per ticker

- **NFLX**: clean QC. Op-margin expanding (32% TTM vs 29.5% annual),
  FCF margin 55%, mature 16% YoY. Anchor-grade compounder.
- **COIN**: hard-gates clean (no spike, lossMag passes due to +20% annual
  op-margin; NI-vol 0.38 against threshold 1.0). But YoY = **-30.8%**
  (rev decline year-over-year), and TTM opMargin reports -7.1% vs
  annual +20.3%. This is a cyclical/transactional revenue base, not a
  durable compounder. Tab 203 decision: do **not** anchor — would
  pollute the QC reference set and isn't HG either. WATCH-grade.
- **ANET**: hard-gates clean, YoY 35% places it on the HG/QC border.
  Council preference: anchor in QC (matches stated profile: high opM,
  durable). If later HG-coverage is wanted, ANET can be added to HG too.
- **SPGI / MCO**: ratings/data oligopoly. Textbook QC profile.
- **KO**: classic Buffett compounder. Hard-gates clean. (FCF margin 6.3%
  is artifact of a high-capex year — TTM not annual; not a hard-gate.)
- **AON**: insurance broker oligopoly. Clean QC.
- **MMC**: **no snapshot exists** at `snapshots/MMC.json`. Cannot evaluate.

## PART 3 — Anchor Counts

| Set | Before (Tag 202) | Change | After (Tag 203) |
|---|---:|---:|---:|
| ANCHORS_HG_PB | 21 (incl. META) | -1 (META → QC only) | **20** |
| ANCHORS_QC    | 35 (incl. META) | +6 (NFLX, ANET, SPGI, MCO, KO, AON) | **41** |
| Total anchors | 56 | +5 (META dedup; +6 new) | **61** |
| QUARANTINE    | 6 | 0 | 6 |

## PART 4 — Follow-up tickets

Tickets that should pass but are currently blocked by something other
than the guards themselves:

1. **Tag 204 — Seed MMC snapshot.** MMC (Marsh & McLennan, insurance
   broker oligopoly, $100B+ mcap, clean QC profile) is missing from
   `snapshots/`. Either the universe-pull list does not include it or
   the last pull dropped it. Action: verify MMC is in the seed
   universe (workflow / scripts/build-universe.*) and force a fetch
   for next pull. Once the snapshot lands, MMC should add cleanly to
   `ANCHORS_QC` (it is an AON-twin).

2. **Tag 204 (optional) — COIN classification policy.** COIN passes
   all 6 hard-gates but presents a profile (-30.8% YoY rev, -7% TTM
   opMargin against +20% annual opMargin) that doesn't fit any of the
   anchor archetypes. Decide whether the audit tool should grow a
   `WATCH-ANCHOR` list for cyclicals so we have one volatile-revenue
   reference instead of silently ignoring it.

3. **Tag 204 (optional) — ANET dual-list policy.** ANET (YoY 35%,
   opM 43%) is genuinely both HG and QC. Current convention treats
   the anchor lists as mutually exclusive (post-META-dedup). If we
   want HG-bench coverage of "HG that has already matured into QC,"
   add a small `ANCHORS_DUAL` set and seed it with ANET, then META if
   the same condition recurs.

## Files modified

- `audit-classifications.js` (gitignored, root) — META dedup + 6 new
  QC anchors + Tag 203 inline rationale comments.
- `audit-reports/2026-05-16-tag203-anchor-batch.md` (this file).

No git-tracked code touched. No node run. The audit-classifications.js
gitignore status was re-verified via `git check-ignore` before edits.
