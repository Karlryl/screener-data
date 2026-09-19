# BUILD-SPEC v1 — AMENDMENT 01: barrier scaling per arm (2026-09-19)

Status: hashed addendum to `BUILD-SPEC-v1.md` (sha256 `af483fae6a1676476894fab05c1863a6a757e439c60ad8d6ccfd9bf5326a961a`).
The spec file itself is **untouched**. This addendum is dated **before the first scored entry** of the
Druckenmiller scoreboard (no entry has been scored yet; the candidates ledger holds warm-up rows only).

Ratified by: Rat 9, Teil 2a (chair decision ~65 %, council split 2:2 + Codex for the literal reading),
`Market Structure research/reports/2026-09-19_council9_teil2a_barrier_verdikt.md`.
Implemented by: Daylauf 4, screener-data branch `druckenmiller/chunk-2`.

## Amendment text (verbatim, as ratified)

> Barrier width per arm h ∈ {63, 126} bars: σ_h = σ_daily · √h, where σ_daily is the 63-day trailing
> daily vol at entry and k = 1 is unchanged. Only the horizon-scaling law of the barrier is added; the
> σ estimation window is untouched. Rationale: under the literal same-σ barrier both arms resolve as a
> ~3-bar event (measured 2026-09-19 on historical bars, shard 0: 95 % resolved within 63 bars, median
> 3 bars, 19 % on bar 1), which voids the decisive-arm/BH-over-arms design and the censoring rule the
> spec was written for. Disclosed: the reading was chosen after that measurement; the measurement
> touched historical price bars only, never a scored forward entry.

## Disclosure of prior access (condition 2 of the verdict)

- Date of the measurements: 2026-09-19, 13:0x–13:5x local.
- Data touched: `screener-data/prices` shard 0 (687 tickers with ≥ 270 bars for the first measurement;
  shards 0–3, 3,234 tickers for the scaling check), historical bars only. **No scored forward entry, no
  validation split, no lockbox.**
- Evaluations seen before the choice: first-passage resolution counts and median resolution times under
  the literal reading (σ_daily) and under the horizon-scaled reading (σ_daily·√h); afterwards the
  scaling check and the arm-collapse sample below. No estimand, no CONFIRMS-minus-WEAK difference and no
  L/MDE was computed on any sample at any point.
- Consequence: this reading is registered as an **amendment with disclosure**, not as "it was in the
  text all along".

## Scaling check (condition 3; documentation, not a gate)

Realised h-bar SD against the predicted σ_daily·√h, on historical bars (shards 0–3, entry every 21
bars, 63-day trailing σ at entry):

| h | n | realised SD of h-bar log return | mean σ_daily·√h | ratio realised/predicted |
|---|---|---|---|---|
| 63 | 26,281 | 0.4878 | 0.4485 | **1.088** |
| 126 | 17,585 | 0.6694 | 0.6110 | **1.095** |

The tipping condition of the verdict ("realised 126-bar SD deviating by more than ~30 % from
σ_daily·√126 → switch to K") is **not met**: the deviation is +9.5 %. H stands.

## Arm-collapse guard (condition 4)

Fixed sample: `screener-data/tests/druckenmiller/fixtures/arm-collapse-sample.json` (shard 0, every 63rd
bar as entry, resolution under H).

| arm | resolved | censored | median bars | p25 | p75 |
|---|---|---|---|---|---|
| 63 | 1,172 | 1,265 | 31 | 18 | 45 |
| 126 | 942 | 784 | 58 | 33 | 84 |

KS two-sample D = 0.450, D·√n_eff = **10.28** against the registered 1 % threshold 1.63; median ratio
58/31 = **1.87** against the registered minimum 1.25. The arms do not collapse under H.

## Scope sentence (condition 5, carried into Datei B and onto the panel)

Under H the barrier **width** and the observation **length** vary together, so a difference between the
two arms is not attributable to the horizon alone.

## What this addendum does not change

k = 1, the σ estimation window (63 bars), the horizons {63, 126}, cool-off = horizon, the decisive-arm
rule, the label boundaries, the read schedule, and the retirement rule all stay exactly as registered.
The 126-bar arm **stays** (no retraction). Every other constant of §0.4 is untouched.
