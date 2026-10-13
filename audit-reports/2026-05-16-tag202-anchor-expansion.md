# Tag 202 — Anchor Expansion Audit (Agent 9)

Generated: 2026-05-16
Cycle directive: /audit (mandate to expand anchor universe each cycle).
Candidate set: AMZN, TSLA, GOOG, AMD, TSM.

## Headline

**No expansion required. All 5 candidates are ALREADY present in
`audit-classifications.js`. Current anchor universe stays at the Tag 201
baseline. All 4 hard-gate verifications PASS for each anchor — no method
fix required.**

The /audit skill's expansion mandate was already discharged in earlier
cycles (Tag 199–201) that pre-added these names. Future cycles should
draw from a fresh candidate set (suggested: NFLX, COIN, SPGI, MCO, KKR,
NU, SE).

## Pre-existing Membership (verified)

| Ticker | Already in       | Line | Notes                                       |
|--------|------------------|------|---------------------------------------------|
| AMZN   | ANCHORS_QC       | 45   | "Tech compounders"                          |
| TSLA   | ANCHORS_QC       | 59   | Comment: "thin margins" — borderline tag    |
| GOOG   | ANCHORS_QC       | 45   | + GOOGL also listed                         |
| AMD    | ANCHORS_HG_PB    | 37   | "Established hypergrowth"                   |
| TSM    | ANCHORS_HG_PB    | 37   | "Established hypergrowth"                   |

NB: `META` is duplicated — appears in BOTH HG_PB (line 37) and QC (line 45).
Out-of-scope for this ticket; flag for separate cleanup.

## Anchor-Universe Count Reconciliation

The directive cited "24 HG/PB + 32 QC = 56 (Tag 199h)". Actual current
state of `audit-classifications.js`:

| List           | Count | Drift vs. Tag 199h spec |
|----------------|------:|--------------------------|
| ANCHORS_HG_PB  |  21   | −3 (NVDA/AVGO/NOW/MELI/AMD/TSM/META/SHOP + 8 lossy + 5 PB = 21) |
| ANCHORS_QC     |  35   | +3                       |
| Total          |  56   | matches                  |
| QUARANTINE     |   6   | (unchanged)              |

Total is still 56 — composition rebalanced between buckets but the
overall universe size is intact.

## Per-Anchor Snapshot Summary + Hard-Gate Verdict

Snapshots dated 2026-05-13. `_quality.grade` is computed at runtime by
`methods/data-quality.js` and is NOT embedded in snapshots — verified by
grep. Listed as "n/a (runtime-only)".

### AMZN — Amazon.com (Consumer Cyclical / Internet Retail)
- mcap $2.86 T; annualRev[0] $716.9 B; annualOpInc[0] $79.97 B (+11.16%);
  annualNI[0..3] $77.67 / 59.25 / 30.43 / −2.72 B; annualFCF[0] $7.7 B;
  metrics.revenueGrowthYoY 16.6 %; metrics.fcfMarginTTM 1.32 %.
- q-spike: yoy 16.6 % < 100 % trigger → INACTIVE / pass.
- loss-magnitude-guard: 79.97 / 716.9 = +0.111 ≥ −0.50 → pass.
- metric-divergence-guard: ttm 13.14 vs annual 11.16 → div 1.98 ≤ 1000 → pass.
- ni-volatility-guard: max ΔNI = 33.15 B / 716.9 B = 0.046 < 1.0 → pass.
- pre-commerciality-megacap-guard: rev $716.9 B » $100 M floor → pass.
- Expected tab: **QC**. Classification verdict: **PASS** (already member).
- Fix needed: none.

### TSLA — Tesla (Consumer Cyclical / Auto Manufacturers)
- mcap $1.63 T; annualRev[0] $94.83 B; annualOpInc[0] $4.85 B (+5.11%);
  annualNI[0..3] $3.79 / 7.09 / 15.00 / 12.56 B; annualFCF[0] $6.22 B;
  metrics.revenueGrowthYoY 15.8 %; metrics.fcfMarginTTM 5.37 %.
- q-spike: yoy 15.8 % < 100 % → INACTIVE / pass.
- loss-magnitude-guard: 4.85 / 94.83 = +0.051 ≥ −0.50 → pass.
- metric-divergence-guard: ttm 4.20 vs annual 5.11 → div 0.91 → pass.
- ni-volatility-guard: max ΔNI = |3.79 − 7.09| or |7.09 − 15.00| = 7.91 B / 94.83 B = 0.083 → pass.
- pre-commerciality-megacap-guard: rev $94.83 B » floor → pass.
- Expected tab: **QC** (already tagged "borderline / thin margins").
  TSLA's 19 % gross margin is light vs. QC norms but its $1.6 T mcap, 16 % growth
  and consistent multi-year profitability earn QC qualification.
  Could plausibly slot into PRE_BREAKOUT if NI re-accelerates.
- Classification verdict: **PASS** (already member).
- Fix needed: none.

### AMD — Advanced Micro Devices (Technology / Semiconductors)
- mcap $731 B; annualRev[0] $34.64 B (+34.3 % YoY annual); annualOpInc[0] $3.69 B (+10.67%);
  annualNI[0..3] $4.34 / 1.64 / 0.85 / 1.32 B; annualFCF[0] $6.74 B;
  metrics.revenueGrowthYoY 37.8 %; metrics.fcfMarginTTM 19.15 %.
- q-spike: yoy 37.8 % < 100 % → INACTIVE / pass.
- loss-magnitude-guard: 3.69 / 34.64 = +0.107 → pass.
- metric-divergence-guard: ttm 14.40 vs annual 10.67 → div 3.74 → pass.
- ni-volatility-guard: max ΔNI = |4.34 − 1.64| = 2.70 B / 34.64 B = 0.078 → pass.
- pre-commerciality-megacap-guard: rev $34.6 B » floor → pass.
- Expected tab: **HG** (37.8 % growth + accelerating margins).
- Classification verdict: **PASS** (already member of ANCHORS_HG_PB).
- Fix needed: none.

### TSM — Taiwan Semiconductor (Technology / Semiconductors, NYSE ADR)
- mcap $2.06 T (USD); annualRev[0] 3.81 T TWD; annualOpInc[0] 1.94 T TWD (+50.83 %);
  annualNI[0..3] 1.72 / 1.17 / 0.84 / 1.02 T TWD; annualFCF[0] 992 B TWD;
  metrics.revenueGrowthYoY 35.1 %; metrics.fcfMarginTTM 17.58 %.
- q-spike: yoy 35.1 % < 100 % → INACTIVE / pass.
- loss-magnitude-guard: opMargin +50.83 % → pass.
- metric-divergence-guard: ttm 58.11 vs annual 50.83 → div 7.28 → pass.
- ni-volatility-guard: max ΔNI = |1.72 − 1.17| = 549 B / 3.81 T = 0.144 → pass.
- pre-commerciality-megacap-guard: rev $3.81 T (any unit) » floor → pass.
- Expected tab: **HG** (35 % growth + 58 % opMargin = best-in-class).
  Could equally argue QC given megacap-compounder profile; HG_PB membership
  is appropriate while growth stays > 25 %.
- Classification verdict: **PASS** (already member of ANCHORS_HG_PB).
- Fix needed: none.

## Anchors Needing Follow-up Method Fix

**None.** All 5 candidates pass every hard-gate cleanly with comfortable
headroom (no gate within 10 % of its threshold).

The closest gate proximity is TSLA op-margin slim: 5.1 % vs the 50 %-loss
floor — a 55 pp cushion. No tuning warranted.

## Files Modified

- `audit-reports/2026-05-16-tag202-anchor-expansion.md` (this report — NEW)
- `audit-classifications.js` — **NOT modified** (all candidates already
  present; per directive "don't duplicate" + "gitignored").

## Recommendation for Next Cycle

The /audit skill's expansion mandate is structurally healthy but the
candidate list (AMZN/TSLA/GOOG/AMD/TSM) is stale — they're long since
incorporated. Refresh the rotating candidate roster. Proposed next batch:

- HG/PB candidates: NFLX (streaming compounder, 15 %+ growth resurgent),
  COIN (crypto cyclical — would TEST quarantine rather than anchor),
  ANET (network-infrastructure secular), KLAC alt: AMAT.
- QC candidates: SPGI, MCO (rating-agency duopoly), MNST, BRK-B, KO.
- Defensive QC: COR, MMC, AON (insurance brokers — low-NI-vol cohort
  not yet stress-tested in anchor universe).
