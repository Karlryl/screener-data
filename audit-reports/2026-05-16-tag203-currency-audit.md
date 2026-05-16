# Tag 203 — Currency-Coherence Audit (Agent 12)

Date: 2026-05-16
Scope: `_convertSnapshotToUSD` field-coverage + `meta.reportingCurrency` accuracy for non-USD anchors.

---

## 1. `_convertSnapshotToUSD` Field Inventory (pull-yahoo.js:231-312)

The function uses a **generic for-loop** over `snap.annual` and `snap.timeseries` keys (lines 294-303), so any array attached to those objects is scaled automatically. The `scale()` helper handles three shapes: raw `number`, `{value: number}`, and balance-sheet objects (`{totalCash, totalDebt, totalAssets}`).

### Explicitly scaled top-level fields
| Field | Line | Shape |
|-------|------|-------|
| `snap.marketCap` | 292 | `{value, source, ...}` |
| `snap.metrics.revenueTTM` | 293 | `{value, source, ...}` |
| `snap.annual.*` (all keys, if array) | 295-297 | varies |
| `snap.timeseries.*` (all keys, if array) | 299-302 | varies |

### Fields populated on `canonical.annual` (mapper line 526-531 + FTS merge 986-1017)
1. `annualRev` — `{value}[]`
2. `annualOpInc` — `{value}[]`
3. `annualNetIncome` — `{value}[]`
4. `annualGP` — `{value}[]`
5. `annualFCF` — `{value}[]`
6. `annualOCF` — `{value}[]`
7. `annualBalance` — `{totalCash,totalDebt,totalAssets}[]`
8. `annualSBC` — raw `(number|null)[]` (FTS, line 993)
9. `annualCapex` — raw `(number|null)[]` (FTS, line 995)
10. **`annualRnD` — raw `(number|null)[]`** (QS at 530, FTS overwrite at 1006/1009)

### Field-coverage verdict
**No gap.** Every annual array, including `annualRnD` (Tag 202a), is scaled because the loop iterates `Object.keys(snap.annual)` and `scale()` handles raw numbers (`typeof item === 'number'` branch, line 277). `annualRnD` does NOT need a dedicated conversion line. **The "1-line fix" for field-coverage is unnecessary** — Tag 202a is structurally safe.

### One latent concern (LOW)
`metrics.revenueTTM` is the only metric explicitly scaled. Other currency-denominated metric fields would be missed if added later (e.g., a hypothetical `metrics.fcfTTM` or `metrics.ebitdaTTM`). Today none exist, so this is forward-looking only.

---

## 2. Anchor Snapshot Inconsistency Table

All 10 snapshots are dated `2026-05-13` and **lack** `fxConverted`, `reportingCurrencyOriginal`, `fxRateApplied`, `_pullMode`, `_quality`, `meta.exchangeName`. This means the on-disk snapshots predate the Tag 134 conversion path entirely (they were written by an older mapper that never invoked `_convertSnapshotToUSD`). The bug is therefore not a missing field in the conversion — it is that current files were **never run through any conversion at all**.

| Ticker | meta.reportingCurrency | rcOriginal | annualRev[0] | marketCap (claimed USD) | rev/mcap | Implied actual ccy | Inconsistency |
|---|---|---|---|---|---|---|---|
| TSM       | USD | (none) | 3.81e12  | 2.06e12 | 1.85  | TWD (~31:1) | **HIGH** rc says USD, rev is TWD |
| BABA      | USD | (none) | 9.96e11  | 3.23e11 | 3.08  | CNY (~7:1)  | **HIGH** rc says USD, rev is CNY |
| 9988.HK   | HKD | (none) | 9.96e11  | 3.27e11 | 3.05  | CNY (rev) / HKD (price) | **HIGH** rc=HKD but rev value is CNY (BABA twin) |
| NHY.OL    | NOK | (none) | 2.08e11  | 1.88e10 | 11.05 | NOK (~10:1) | **MED** rc honest, but never converted |
| NESN.SW   | CHF | (none) | 8.95e10  | 2.19e11 | 0.41  | CHF         | **MED** rc honest, never converted |
| SAP.DE    | EUR | (none) | 3.68e10  | 1.80e11 | 0.20  | EUR         | **MED** rc honest, never converted |
| RMS.PA    | EUR | (none) | 1.60e10  | 1.79e11 | 0.09  | EUR         | **MED** rc honest, never converted |
| MC.PA     | EUR | (none) | 8.08e10  | 2.42e11 | 0.33  | EUR         | **MED** rc honest, never converted |
| OR.PA     | EUR | (none) | 4.41e10  | 2.07e11 | 0.21  | EUR         | **MED** rc honest, never converted |
| ASML.AS   | EUR | (none) | 3.27e10  | 5.27e11 | 0.06  | EUR         | **MED** rc honest, never converted |

**Pattern**: ADRs whose Yahoo `price.currency = "USD"` (TSM, BABA) get `meta.reportingCurrency = "USD"` from line 487 (`_y(pr, 'currency')`), but their statement currency is TWD/CNY. `_convertSnapshotToUSD` then early-returns at line 236 (`if (origCurrency === 'USD') return snap;`), so `annualRev` stays in local units. 9988.HK is an additional surprise: same rev figure as BABA (parent group), so the Yahoo FTS source serves CNY-denominated financials regardless of the HKD listing — Yahoo's `financialCurrency` field would be needed to detect this.

---

## 3. Severity Assessment by Method-Type

| Method type | Severity | Why |
|---|---|---|
| Ratio methods (fcf-yield, ev-ebitda, ROIC, gross/op-margin, price-sales) | **HIGH** for TSM/BABA-class | `fcf/mcap` mixes TWD over USD → ~30× inflated yield. Score corruption silent. |
| Ratio methods (NESN.SW etc., where mcap *and* statements are both unconverted) | **LOW** | Same currency on both sides cancels (CHF/CHF). |
| Growth methods (YoY %) | **LOW** all anchors | Pure ratio across same-currency series — immune. |
| `pre-commerciality-megacap-guard` ($1B mcap, $100M rev floors) | **LOW** (safe direction) | rev in TWD is 30× above $100M floor → falsely passes. Wrong-but-safe. No false fails observed. |
| Walk-forward backtest / absolute-USD return calc | **MED** | If portfolio-value reads `mcap` as USD but `rev` from same snapshot for sizing, silent skew. |
| Tag 202a `annualRnD` field | **LOW** | Conversion loop handles it correctly when `_convertSnapshotToUSD` is invoked; problem inherits from #2, not from a coverage gap. |

---

## 4. Concrete Fix Proposals

### Fix A — `meta.reportingCurrency` source (root cause of TSM-class)
In `mapYahooToCanonical` line 487, replace
```
const rcOriginal = _y(pr, 'currency') || 'USD';
```
with a 3-tier preference that consults the **financial-statement currency** first:
```
const rcOriginal = _y(yahoo.price, 'financialCurrency')
                || _y(yahoo.summaryDetail, 'financialCurrency')
                || _y(pr, 'currency')
                || 'USD';
```
Yahoo's `price.financialCurrency` is the canonical field for statement reporting currency (separate from the trading-quote `price.currency`). For TSM it returns `"TWD"`; for BABA `"CNY"`; for 9988.HK `"CNY"`; for true USD-reporters it matches `price.currency`. This single change makes `_convertSnapshotToUSD` actually run on ADR tickers and fixes downstream ratios automatically. Add a one-shot migration: any existing snapshot lacking `fxConverted` should be invalidated from cache so the next pull re-derives it.

### Fix B — Field-coverage gap (non-issue, but harden against future drift)
`_convertSnapshotToUSD` is already complete for current fields. To prevent future regressions, add an explicit allow-list assertion at the end of the function: enumerate `EXPECTED_ANNUAL_FIELDS = ['annualRev','annualOpInc','annualNetIncome','annualGP','annualFCF','annualOCF','annualBalance','annualSBC','annualCapex','annualRnD']` and emit a `WARN` if `snap.annual` contains an unknown key (suggests a new currency-denominated field was added without audit). Same for `metrics.*` currency-denom fields (currently only `revenueTTM`). This is a 5-line change in pull-yahoo.js (~line 303) with no functional impact today but catches Tag 204+ slippage early.

### Fix C — Backfill (one-shot script, not in pull-yahoo.js)
Since existing snapshots were written by pre-Tag-134 code, a small script `scripts/repair-snapshot-currency.js` should:
1. Read each snapshot lacking `meta.fxConverted`.
2. Use the **price/marketCap ratio** to back-compute the statement currency: if `marketCap >> rev0` and ticker is a known ADR list (TSM, BABA, ...), re-fetch `price.financialCurrency` from Yahoo and re-run `_convertSnapshotToUSD`.
3. Alternative: invalidate the snapshots/_manifest entry to force a fresh full-pull on next CI run.

---

## 5. Bottom Line

The on-disk audit reveals a **bigger problem than the Agent 9 finding suggested**: not only TSM but every snapshot in `snapshots/` lacks `fxConverted` markers, meaning `_convertSnapshotToUSD` never touched them. This is a code-vs-data drift — the function itself is correct and field-complete (including `annualRnD`); the issue is (a) ADR detection via `price.currency` is wrong for ADRs, and (b) all 4000+ snapshots need a forced refresh once Fix A lands.
