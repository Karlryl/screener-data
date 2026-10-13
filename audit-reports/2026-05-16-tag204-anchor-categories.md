# Tag 204 — WATCH-ANCHOR + ANCHORS_DUAL Lists

**Date:** 2026-05-16
**Agent:** Audit Agent 18
**Scope:** `audit-classifications.js` (gitignored, local-only)
**Problem solved:**
- Tag 203c gap 1: No way to TRACK cyclicals (e.g. COIN) that SHOULD live in WATCH.
- Tag 203c gap 2: HG/QC dual-fit stocks (ANET, META) duplicated across both lists, triggering false-positive WRONG_TAB on whichever side they didn't appear in.

---

## 1. New array — `ANCHORS_WATCH`

Stocks tracked as anchors but EXPECTED in WATCH (cyclical revenue or transactional fee income — hard-gates fail by design). Success criterion: lands in WATCH and does NOT leak into HG / QC / SMALL / PRE_BREAKOUT.

```js
const ANCHORS_WATCH = [
  'COIN',  // crypto exchange, revYoY -30.8% (cyclical fee income)
  'RCL',   // cruise operator, FCFm still negative post-COVID
  'NCLH',  // cruise operator, FCFm -15%, capex-heavy cyclical
  'HOOD',  // retail brokerage, transactional/cyclical revenue
  'PYPL',  // mature payments, slowing growth (7%) — borderline cyclical
  'ON'     // semi-cyclical (4.7% YoY), well-known operator
];
```

Per-stock rationale (snapshot KPIs, source `snapshots/<t>.json` 2026-05-13):

| Ticker | revYoY | opM | FCFm | Reason WATCH (not HG/QC) |
|---|---:|---:|---:|---|
| COIN | -30.8% | -7.1% | 38.3% | Crypto-cycle volatility; YoY negative disqualifies HG/QC. |
| RCL  | 11.3%  | 26.2% | -1.1% | Cruise cycle; FCF still flipping negative — fails QC FCF gate. |
| NCLH | 9.6%   | 10.5% | -15.0% | Heavily-levered cruise cyclical; negative FCF. |
| HOOD | 15.1%  | 38.5% | n/a   | Transactional brokerage; revenue tied to retail-trading volume. |
| PYPL | 7.2%   | 18.0% | 12.1% | Mature/decelerating payments; no longer a compounder. |
| ON   | 4.7%   | 18.2% | 21.1% | Semi-cycle bottoming; legitimate operator but sub-HG growth. |

---

## 2. New array — `ANCHORS_DUAL`

Stocks that legitimately satisfy BOTH HG (growth) AND QC (margins+compounder). Success criterion: in AT LEAST ONE of HG / QC / PRE_BREAKOUT. Being in BOTH is intentional and no longer flagged as a duplication bug.

```js
const ANCHORS_DUAL = [
  'ANET',  // revYoY 35%, opM 43%, FCFm 45% — HG growth + QC margins
  'META'   // revYoY 33%, opM 41%, grossM 82% — HG growth + QC compounder
];
```

Per-stock rationale:

| Ticker | revYoY | opM | FCFm | Why DUAL |
|---|---:|---:|---:|---|
| ANET | 35.1% | 42.7% | 44.9% | Hypergrowth-rate AND QC-grade margins; was QC-only in Tag 203, now allowed in either. |
| META | 33.1% | 40.6% | 11.9% | Tag 203c removed from HG list (mature-22%-grower theory) but YoY actually 33% — true HG/QC overlap. |

Note: META remains listed in `ANCHORS_QC` (Tag 203 batch). The new dedupe in the iteration helper (`Array.from(new Set([...]))`) ensures META is reported only once, and `isDual` takes precedence over `ANCHORS_QC.includes(tk)` so the expected-tab set is `['HG','QC','PRE_BREAKOUT']` instead of `['QC']` only.

---

## 3. Helper-function changes

In `audit-classifications.js`, `main()` → anchor-report loop:

1. **Dedupe**: iteration source changed from `[...ANCHORS_HG_PB, ...ANCHORS_QC, ...QUARANTINE]` to `Array.from(new Set([...ANCHORS_HG_PB, ...ANCHORS_QC, ...ANCHORS_WATCH, ...ANCHORS_DUAL, ...QUARANTINE]))`.
2. **Classification precedence**: DUAL > WATCH > QUARANTINE > HG/PB > QC. A ticker present in `ANCHORS_DUAL` is treated as DUAL regardless of co-membership in `ANCHORS_QC` (META case).
3. **New statuses**:
   - `OK_DUAL` — DUAL ticker landed in at least one of HG/QC/PB.
   - `OK_WATCH` — WATCH ticker landed in WATCH and nowhere else (no leak).
   - Existing `OK`, `OK_QUARANTINED`, `LEAKED_INTO_NON_WATCH`, `WRONG_TAB`, `EXCLUDED_FROM_ALL_TABS`, `MISSING_SNAPSHOT` preserved.
4. Variable `status` changed from `const` (single ternary) to `let` (multi-branch if/else) — syntactically clean (`node --check` passes).

---

## 4. Candidates evaluated but NOT anchored

| Ticker | Reason rejected |
|---|---|
| RIVN | grossM 1.0%, opM -64% — not a legitimate operating business yet; covered by Q-Spike/Loss-Mag patterns. |
| LCID | grossM -96%, opM -337% — failed/cash-burn; not worth anchoring. |
| MSTR | opM -11641%, FCFm -1774% — bitcoin-holding-vehicle distortion; not an operating-business anchor. |
| GLD  | snapshot not present (ETF, intentionally excluded from universe). |

---

## 5. Updated anchor counts

| List | Previous (Tag 203) | New (Tag 204) | Delta |
|---|---:|---:|---:|
| ANCHORS_HG_PB | 20 | 20 | 0 |
| ANCHORS_QC    | 41 | 41 | 0 |
| ANCHORS_WATCH | (n/a) | **6** | +6 |
| ANCHORS_DUAL  | (n/a) | **2** | +2 |
| QUARANTINE    | 6 | 6 | 0 |
| **Total unique anchors tracked** | **67** | **75** | **+8** |

(Dedupe note: META appears in both `ANCHORS_QC` and `ANCHORS_DUAL`, so unique-anchor count adds 8 not 10. The 61-stock figure cited in the task prompt — 20 HG/PB + 41 QC — omits QUARANTINE; the new total comparable on that basis is 20 + 41 + 6 + 2 = 69 unique HG/QC/WATCH/DUAL anchors.)

---

## 6. Files modified

- `audit-classifications.js` (gitignored) — added `ANCHORS_WATCH`, `ANCHORS_DUAL`, updated anchor-report iteration.
- `audit-reports/2026-05-16-tag204-anchor-categories.md` — this report.

No git-tracked file was modified. No method was modified.
