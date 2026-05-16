# Tag 203 — Q_SPIKE_FAKE Escape Investigation

**Agent:** Audit Agent 15
**Date:** 2026-05-16
**Trigger:** Tag 201 Agent 1 — `300033.SZ` (Hithink RoyalFlush) classified
`Q_SPIKE_FAKE` by `hypergrowth-quality-class` but landed in the **QC** tab.

---

## Part 1 — `300033.SZ` (Hithink RoyalFlush, CN A-share)

| Field | Value |
|---|---|
| Sector / Industry | Financial Services / Financial Data & Stock Exchanges |
| Market cap | 25.7 B CNY |
| TTM revenue | 6.33 B CNY (material) |
| YoY growth (snapshot) | **40.8%** |
| `revenueQ` (latest first) | 1053M, **2768M**, 1031M, 748M, 1852M |
| `spikeShare` (max/sum last-4Q) | **49.4%** (2768 / 5601) |
| `annualOpInc[0,1]` | 3478M, 1739M — profitable, 2x grew |
| 3y annual revenue change | +69% (no decline) |

### Why the gates disagree

`q-spike-dataguard` exits at line 125 with `NOT_HYPERGROWTH_CASE` because
`yoyGrowth (40.8%) < HYPERGROWTH_TRIGGER (100%)`. Even if it did engage,
49.4% < `SPIKE_SHARE_HARD (55%)` and the company is profitable, so OI-Severity
never fires. Net: `pass=true`, `qSpikeFail=false`.

`hypergrowth-quality-class` reaches the `Q_SPIKE_FAKE` branch via
`isSpikeConc (49.4 > 45) && breadthOk && strongQ <= 1` (line 154). With only
5 quarterly entries the breadth check falls back to annual revY, and the
year-over-year growths are 44% / 17% / 0.1% — `strongQ = 0` (no year >50%).
The 49% single-Q concentration combined with weak broad-based growth correctly
trips Q_SPIKE_FAKE.

**Verdict:** The classifier is right. The bug is downstream — `classifyTabs`
never consumed the verdict as a hard gate. `Q_SPIKE_FAKE` was only used
**negatively** to deny HG-tab promotion (line 306 admits only
`REAL_HYPERGROWTH_*`), so QC/SMALL/R40/PRE_BREAKOUT had no defense.

---

## Part 2 — A-share spot check

Computed `spikeShare = max(revQ[0..3]) / sum(revQ[0..3])` from snapshot JSON
(no node executed — pure data inspection):

| Ticker | spikeShare | YoY | Sector | Would Q_SPIKE_FAKE? |
|---|---|---|---|---|
| 300033.SZ | **49.4%** | 40.8% | Financial Data | **YES** (escape) |
| 300750.SZ (CATL) | 31.3% | 52.4% | Electrical Equip | no (<45%) |
| 600519.SS (Moutai) | 29.3% | 6.5% | Beverages | no |
| 000001.SZ (PA Bank) | 26.3% | 3.9% | Banks | no |
| 002594.SZ (BYD) | 31.3% | -11.8% | Auto | no |

**Pattern:** No systemic A-share leak. 300033.SZ is idiosyncratic — Q2 prints
~2.6× the Q3/Q4 average (likely an annual-bonus / settlement-fee seasonality
for an information-services brokerage). Other A-shares cluster at 26–32%,
inside the safe zone. The recommended fix therefore targets the *signal*
(classifier verdict) and is sector-agnostic.

---

## Part 3 — Recommendation: **Option C** (hgClass as hard-gate co-signal)

**Patch (1-line addition to the hard-gate chain in `classifyTabs`):**

```js
const hgClassFail = r.hgClass === 'Q_SPIKE_FAKE';
const hardGated = r.qSpikeFail || r.lossMagFail || r.metricDivFail
                 || r.niVolFail || r.preCommFail || r.cetFail
                 || r.dqGrade === 'D' || hgClassFail;
// ...
if (hgClassFail) reasons.push('Q-SPIKE-FAKE');
```

**Why C over A/B:**
- **A** (new `seasonal-revenue-pattern-guard`) duplicates the logic already
  inside `hypergrowth-quality-class`. The classifier already encodes the
  `isSpikeConc && weak-breadth` rule; wrapping it in a second method adds a
  registry entry, a JSON field, and zero new information.
- **B** (tighten 55→50) is a single-ticker tune by another name — exactly
  what Tag 134's threshold-discipline doc forbids. It would not even fix
  300033.SZ (49.4% < 50%) and would risk anchor regressions.
- **C** is zero-threshold, zero-new-method, and uses an existing classifier
  output that's already on the row (`r.hgClass`). The classifier was designed
  to disqualify these stocks (`RANK.Q_SPIKE_FAKE = 0`, hard-coded lowest);
  honoring that verdict at the tab-classification step is overdue.

---

## Part 4 — Anchor safety

`spikeShare` < 45% means the `isSpikeConc` gate inside
`hypergrowth-quality-class` cannot fire, so `Q_SPIKE_FAKE` is unreachable for
that stock regardless of breadth or OI direction.

| Anchor | spikeShare | < 45%? | hgClass branch reachable? |
|---|---|---|---|
| NVDA | 31.5% | yes | No (REAL_HYPERGROWTH_*) |
| MSFT | 26.0% | yes | No |
| PLTR | 31.4% | yes | No |
| ALAB | 31.7% | yes | No |
| CRDO | 38.1% | yes | No (4/4 strong Q, OI flip-positive) |

**No anchor regression possible** from this change.

---

## Files modified

- `generate-screener.js` — added `hgClassFail` to the hard-gate chain in
  `classifyTabs` and `Q-SPIKE-FAKE` to the `watchReasons` list. WATCH badge
  rendering already handles new reason codes via the generic mapping.

## Files created

- `audit-reports/2026-05-16-tag203-q-spike-escape.md` (this report).

## No changes to

- `SCORE_WEIGHTS` (constraint)
- `q-spike-dataguard.js` thresholds (no tuning)
- Method registry (no new method file)
- `hypergrowth-quality-class.js` (classifier logic already correct)
