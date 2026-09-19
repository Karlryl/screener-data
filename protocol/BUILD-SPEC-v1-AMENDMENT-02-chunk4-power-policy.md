# BUILD-SPEC v1 — AMENDMENT 02: chunk-4 power policy, and chunk 4 to the graveyard (2026-09-19)

Status: hashed addendum to `BUILD-SPEC-v1.md` (sha256 `af483fae6a1676476894fab05c1863a6a757e439c60ad8d6ccfd9bf5326a961a`)
and to **File C** `protocol/druckenmiller_alfred_registered_20260919.json` (sha256
`a2b647477ef2559d7a058aec6cdb777c28cb1904809495b0c2fc79394b372c30`). The spec file and File C are
**untouched**: this addendum supersedes clauses of File C by naming them, it never edits them.
Sibling addendum: AMENDMENT 01 (sha256 `61d4c8ef4d89785128db1c0115c3ad52797e347087fccad1a71054c6df9503c1`),
whose barrier law this test inherited and which stays in force for the scoreboard.

Ratified by: **Rat 13** (option B accepted 3:1 and carried to its outcome; chair ~62 %),
`Jarvis/Knowledge/Trading/druckenmiller/research-2026-09-13/COUNCIL13-CHUNK4-VERDICT-2026-09-19.md`
(Jarvis commit `280392d`). Case file: `CHUNK4-REGISTRATION-DRAFT-v2-2026-09-19.md` (all 9 MUSS and
3 SOLL of the Codex blind critique `CHUNK4-CODEX-CRITIQUE-2026-09-19.md` applied).
Written by: Daylauf 4 (Lane E), screener-data branch `druckenmiller/chunk4-grave`.

**Post-inspection provenance — the sentence that governs how this document may be read:** this
amendment was written **after** outcome information of the SPY leg had been inspected, and it cannot
retroactively establish outcome blindness. §6 reproduces the access ledger verbatim. What it does
establish is narrower and checkable: the **predictor–outcome contrast has never been computed**, in
either direction, permuted or unpermuted.

---

## 1 · The power policy (the citable point)

> **AMENDMENT 02 §1 — power policy.** The predictor–outcome contrast is computed only if a
> registered, dependence-valid power calculation shows **≥ 0.80 at the 5-pp bar** (Holm-adjusted α,
> Control-S block structure). Until such a calculation exists and reaches that threshold, no contrast
> is computed, no vintage is fetched, and no transform may be displayed.

This supersedes File C's admission rule as a *sufficient* condition. File C's `minBlocks` clause
stays in force as what it actually is — a substrate rule — and is re-labelled in §4.

## 2 · The calculation, on the case file's own inputs

Inputs, all from the case file and its preserved script (`CHUNK4-power-inputs-2026-09-19.js`,
sha256 `57c8d97d9ba206c9e574ec8c4b86f6eaf82ea8b1a6d1d7f004a51c3acdb3051f`, input digest of
`prices-max/SPY.json` `d6025d46272c0212c3250b89845d9850c2a361428307cd4d190591b4055bd594`):
748 eligible units, 276 upper-first, success share p = 276/748 = 0.368984, balanced sign groups,
β-relevant α = Holm-worst 0.05/3 = 0.016667 one-sided (z = 2.1280).

Scenario: **the optimistic one — all 748 units treated as independent.** The case file marks this
assumption as known to be false (the registered 26-week block length exists precisely because the
units are not independent). It is used here because it is an **upper bound on power**: every
realistic dependence assumption lowers it.

```
SE  = sqrt( p·(1−p) · (1/374 + 1/374) )
    = sqrt( 0.368984 · 0.631016 · 0.0053476 )
    = 0.035286            →  3.53 pp
power(Δ) = Φ( Δ/SE − z_{1−α} )
```

| Bar | Δ/SE | Φ(Δ/SE − 2.1280) | **achieved power** |
| --- | ---: | ---: | ---: |
| **5 pp** (trading bar) | 1.4170 | Φ(−0.7111) | **0.239 = 23.9 %** |
| **3 pp** (knowledge bar) | 0.8502 | Φ(−1.2779) | **0.101 = 10.1 %** |

At the uncorrected α = 0.05 (not the registered level, shown only so the gap cannot be blamed on
Holm): 41.0 % at 5 pp and 21.3 % at 3 pp. Still far below 0.80.

What 0.80 at the 5-pp bar would require: SE ≤ 0.05 / (2.1280 + 0.8416) = **1.68 pp**, i.e.
**≈ 3,285 independent units** — **4.39 ×** the 748 this substrate has, and the substrate does not
have 748 independent units either (it has 59 non-overlapping 63-bar blocks and 28 bootstrap blocks
of 26 weeks).

## 3 · Finding

**No scenario in the case file reaches the policy threshold of §1, and none can.** The three
registered scenarios give MDEs of 10.5 / 37.2 / 54.2 pp at 80 % power (Holm-worst); the best of them
is already ~2.1 × the trading bar and ~3.5 × the knowledge bar, and it rests on an independence
assumption the case file itself refuses. The tipping condition the council named for keeping option B
open — "the recomputed power at 5 pp under the optimistic scenario comes out near 0.80" — **does not
fire**: it comes out at 23.9 %.

Consequence, per Rat 13: the policy of §1 fires immediately and chunk 4 goes to the graveyard
**unread**.

## 4 · Graveyard entry — Druckenmiller chunk 4 (ALFRED retrospective)

| | |
| --- | --- |
| **Buried** | 2026-09-19, by Rat 13 (3:1 in the option, 4:0 in the outcome) |
| **Cause of death** | achieved power 23.9 % at the 5-pp bar under the most favourable assumption available; policy §1 not met and not meetable on this substrate |
| **Read spent** | **none.** No vintage fetch was ever built; the predictor–outcome contrast was never computed |
| **What was inspected** | the SPY outcome leg only: 276 upper-first / 155 lower-first / 317 no-touch over 748 units. Disclosed in §6, not retracted |
| **Sunk cost, booked** | File C (design registration, hashed 2026-09-19, `a2b64747…`); AMENDMENT 01 (barrier law, `61d4c8ef…` — **not sunk**, it remains in force for the scoreboard); the access-ledger discipline (draft v1 → Codex blind critique → draft v2 with 9 MUSS + 3 SOLL → this amendment) |
| **Not built, therefore not sunk** | the ALFRED/FRED vintage fetch (Tag-208 plumbing was never revived), the analysis script, the result file |
| **Display consequence** | T1 (the net-liquidity composite) **remains undisplayable** — neither as level nor as change. T2/T3 keep their raw-series display ("FRED-Rohreihe <ID>, Referenz — keine Regime-Aussage"); no derived transform of any of the six series may be shown |

**Lesson, to carry into the Druckenmiller spec maintenance:** *the ≥ 20-block admission gate measures
substrate, not power.* On this substrate the gate passes comfortably — 59 non-overlapping 63-bar
blocks against a bar of 20 — while the achieved power at the trading bar is 23.9 %. A gate on the
count of blocks can never stand in for a power statement, and any future registration that carries a
block-count admission rule must carry a power rule beside it.

**Second lesson, kept as a citation:** the entry bar. Both the H.4.1 and H.15 releases are published
**after** the equity close (16:30 and 16:15 ET against a 16:00 close), so a "Thursday close" entry
would have carried look-ahead. The corrected timestamp-based entry wording of the case file (§4 of
draft v2) is recorded here as the wording any successor design must adopt. It is a lesson, not a
live clause: there is no design left to apply it to.

## 5 · Re-open clause

This point is re-opened **only** by a *new*, pre-registered design whose power calculation is
registered in advance and shows **≥ 0.80 at the 5-pp bar** under a dependence-valid procedure.
Explicitly excluded: any repair, extension, re-parameterisation or re-reading of File C; a widened
span; a different barrier; a different multiplicity correction. **File C is closed, not paused.**

No sunset clause is attached, because nothing remains open (Rat 13, point 3). The council's second
named tipping condition stands as the only realistic path: if another chunk needs FRED vintages for
its own reasons, the plumbing is built there, and a successor design may then be proposed under the
first sentence of this section — never as a revival of this one.

## 6 · Access ledger, verbatim from case file v2 §1

What outcome information has been inspected, by whom, before which decision. This is a record, not a
defence: it exists so that any later amendment cannot be read as preceding all outcome access.

| # | When (local) | What was computed | Predictor involved? | Who saw it |
| --- | --- | --- | --- | --- |
| 1 | before today | chunk 0–3 work (logger, scoreboard, 13F). No SPY first-passage quantity at all. | no | — |
| 2 | 2026-09-19 ~15:38 | On cached SPY, within the registered span: 3 767 in-span bars, 758 Thursday grid points, **748 eligible units**, 59 non-overlapping 63-bar blocks, 28 bootstrap blocks of 26 weeks, and the **outcome distribution: 276 upper-first, 155 lower-first, 317 no-touch** (resolution 57.6 %, up-share among resolved 64.0 %). | **no** | this session; the master (message + heartbeat); Karl (file sent); the day log |
| 3 | 2026-09-19 ~15:45 | Unit count under the shifted-entry reading: 748 → 747. **Eligibility only, no outcome recomputation.** | no | as above |
| 4 | 2026-09-19 ~16:2x (for this v2) | Re-arithmetic of the same counts under the all-eligible estimand (p = 276/748 = 0.3690); unit date range **2011-07-07 … 2026-04-16**; the 10 Thursdays excluded for an incomplete window. No new inspection of the price series beyond eligibility dates. | no | this session, the master |
| 5 | 2026-09-19 15:49 | Codex blind critique. Brief = the v1 draft text plus the seven invariants. **No data, no repository access**, read-only scratch folder. | no | this session, the master |

**Decisions that were still open when row 2 was measured:** the A/B/C choice; both File C forks
(entry bar, underpowered rule); whether chunk 4 runs at all. **Decisions that were already closed:**
File C itself (hashed at the end of chunk 2, before any of this) and Amendment 01.

**What has NOT been computed, and why the claim is checkable:** no statistic that conditions the SPY
outcome on the sign of T1, T2 or T3 — in either direction, permuted or unpermuted. This is stronger
than a promise: §7 shows that **no vintage of any of the six FRED series exists anywhere on this
machine**, so the contrast is not merely uncomputed, it is not computable today.

**v1 wording withdrawn:** "costs no read, and cannot produce a result" (§AT A GLANCE, §10 Option B)
and "no read consumed". Replacement wording, used throughout v2: *"the unpermuted predictor–outcome
contrast has not been computed"*.

**Wall placement.** This retrospective sits **outside** the Market-Structure discovery / validation /
lockbox split: SPY is not in `data/`, and the price file is the screener's own `prices-max/SPY.json`.
Its wall is therefore File C plus this ledger, and nothing else. Consequence, stated in Codex's
words and adopted: **permission to display a transform is not validation.** A pass here earns a
panel element; it does not certify a finding, and it may not be cited as an out-of-sample result.

## 7 · What lapses with the grave

The case file listed eight File C amendment items (draft v2 §9). With chunk 4 buried, **A1–A7 lapse
unexecuted** — there is no run for them to govern. Only two survive, and only as the lessons quoted
in §4: the entry-bar wording (A1) and the re-labelling of the block gate as a substrate rule (A4).
The five open TODOs of the case file (FRED unit assertion, per-state pooling weights, establishable
release timestamps, the dependence-valid power calculation, the unadjusted-close diagnostic) lapse
with them; none was measured, and none is claimed as measured.

The five-member family rule, the scoreboard, the candidates ledger, the 13F viewer and the raw FRED
series display are **untouched** by this amendment.
