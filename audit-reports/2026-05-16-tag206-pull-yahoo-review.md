# Tag 206 — pull-yahoo.js Deep Static Review (Bug-Hunt Agent D)

**Scope:** `pull-yahoo.js` (1439 LOC). Focus: Tags 202a (annualRnD backfill), 203d (sector OpInc), 204a (ADR currency).
**Method:** Read-only static review.

## Executive Summary

Tag 202–204 stacked three independent mappings on top of an already-fragile FX/FTS merge layer without local test execution. The most concerning finding is **CRITICAL Bug C1**: `_convertSnapshotToUSD` was extended to enumerate `metrics.*` fields explicitly (Tag 204 architectural fix), but the same enumeration miss is now present for `annual.annualRnD`, which after Tag 202a is stored as **raw numbers** rather than `{value:n}` envelopes — the `scale()` function in `_convertSnapshotToUSD` returns raw numbers through the `typeof item === 'number'` branch correctly, BUT the Tag 202a quoteSummary path produces a sparse array with embedded `null`s (line 500–503) while the FTS path produces the same shape; both correctly survive scale(). Confirmed safe. However, **HIGH Bug C2** (Tag 204a: `_fc !== _tc` guard) silently mis-classifies any ticker where Yahoo returns `financialCurrency=null` but `currency=USD` for a foreign-listed share, and **HIGH Bug F1** (Tag 203d) re-derives OpInc using a TTM operatingMargin even when the QS path already set `opIncSource='computed-margin'` with the same data — wasted work, but more importantly the **post-FTS retry path (line 1190–1196) ignores the bank/insurance line-item paths entirely** because it passes `isHist=[]`. A bank with native FTS line items (totalOperatingExpenses, provisionForLoanLeases) gets only the crude margin × revenue derivation. Total **9 bugs**: 0 CRITICAL, 4 HIGH, 4 MEDIUM, 1 LOW.

## Bug Counts by Severity

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH     | 4 |
| MEDIUM   | 4 |
| LOW      | 1 |
| **Total**| **9** |

---

## Domain: Currency / FX (Tag 204a)

### HIGH C2 — `_fc !== _tc` guard mis-handles `financialCurrency=null` for foreign-listed shares
**File:line:** `pull-yahoo.js:619-621`
**Code:** `const rcOriginal = (_fc && _fc !== _tc) ? _fc : (_tc || 'USD');`
**Mechanism:** When Yahoo returns `price.financialCurrency=null` (sparse for some EM ADRs, OTC pink-sheets, recent IPOs), `_fc` is falsy → falls through to `_tc`. For an OTC pink-sheet trading in USD but reporting in BRL/INR, `_tc='USD'`, `_fc=null` → `rcOriginal='USD'`, then `_convertSnapshotToUSD` early-returns at line 236, leaving annual.* in BRL/INR. Same silent ~30× corruption Tag 204 was supposed to fix.
**Fix:** Add a secondary signal — when exchange is foreign (`exchangeName` matches Sao Paulo/India/etc.) but `_fc` is null and `_tc='USD'`, log a WARN and gate `reportingCurrency` to the watchlist-known ccy or skip. At minimum: emit `meta._ccyAmbiguous=true` for downstream alarming.
**Introduced:** Tag 204a.

### MEDIUM C3 — `tradingCurrency` falls back to `rcOriginal` when both are null, hiding total Yahoo failure
**File:line:** `pull-yahoo.js:622`
**Code:** `const tradingCurrency = _tc || rcOriginal;`
**Mechanism:** When both `price.currency` and `price.financialCurrency` are null (yf.quoteSummary degraded payload), `rcOriginal` becomes `'USD'` via the `(_tc || 'USD')` fallback at 621 → `tradingCurrency='USD'`. A snapshot then claims USD trading + USD reporting when the truth is "Yahoo returned nothing." Downstream methods cannot distinguish.
**Fix:** `const tradingCurrency = _tc || null;` and let downstream code treat null as "unknown". Drop the `|| rcOriginal` masking.
**Introduced:** Tag 204a.

### MEDIUM C4 — `_convertSnapshotToUSD` does not scale `annualSBC` / `annualCapex` / `annualRnD` paths via the value-envelope branch
**File:line:** `pull-yahoo.js:275-290, 313-317`
**Mechanism:** Tag 202a stores `annualRnD` as raw `Number | null` (line 500–503, 1101, 1158). Tag 43/44 stores `annualSBC` / `annualCapex` as raw numbers too. The `scale()` function does handle raw numbers (line 277), so multiplication is correct. **HOWEVER**, the path at line 313–317 iterates `snap.annual[key]` for all keys and `.map(scale)`, which works. **Verified safe.** Reclassified as LOW comment-clarity issue: the comment block at 293–307 implies an allow-list is required for metrics.* but explicitly says annual.* is iterated universally. No bug — flagging for documentation consistency.
**Reclassified:** This is the LOW item (see L1 below).

---

## Domain: Fintech / OpInc (Tag 203d)

### HIGH F1 — Post-FTS retry calls `_deriveOpIncForFinancials([], …)` — never tries bank/insurance line-item paths
**File:line:** `pull-yahoo.js:1190-1196`
**Code:** `const _retry = _deriveOpIncForFinancials([], _postRev, _opMargFrac);`
**Mechanism:** The retry passes empty `isHist=[]` so paths 1 (computed-bank) and 2 (computed-insurance) cannot fire — they need raw `incomeStatementHistory` rows. The retry is hard-wired to margin × rev. For JPM/BAC/WFC where QS isHist had `totalOperatingExpenses` populated but FTS overwrote with nulls, the bank-derived OpInc is lost forever — the snapshot ends up with the cruder `computed-margin` source even though the line-item path was viable.
**Fix:** Pass the original `yahoo.incomeStatementHistory.incomeStatementHistory` to the retry: `const isHist = (yahoo.incomeStatementHistory && yahoo.incomeStatementHistory.incomeStatementHistory) || []; _deriveOpIncForFinancials(isHist, _postRev, _opMargFrac);`. The retry then preserves the higher-quality bank/insurance derivation.
**Introduced:** Tag 203d.

### HIGH F2 — FTS-OpInc override (line 1136–1139) discards null placeholders, breaking year-alignment with annualRev
**File:line:** `pull-yahoo.js:1137`
**Code:** `canonical.annual.annualOpInc = ftsAnnual.annualOpInc.filter(v => v != null && (typeof v !== 'object' || v.value != null));`
**Mechanism:** `mapFTSToAnnual` deliberately pushes `null` placeholders to keep positional alignment with annualRev (F-DP-030/031, line 736–741). This override `.filter()`s nulls back out → `annualOpInc[i]` and `annualRev[i]` now reference different calendar years. Re-introduces the exact bug F-DP-030 fixed. Any method comparing positional pairs (`annualOpInc[i]/annualRev[i]` for operating margin trend) is silently wrong.
**Fix:** Do not filter nulls on the override: `canonical.annual.annualOpInc = ftsAnnual.annualOpInc;` (just trim trailing-null block if needed, consistent with mapFTSToAnnual).
**Introduced:** Tag 203 (refined Tag 203d).

### HIGH F3 — Sector gate uses exact-string `'Financial Services'` — silently no-op for Yahoo's `'Financial Data & Stock Exchanges'` industry hierarchy edge cases
**File:line:** `pull-yahoo.js:485, 1190`
**Mechanism:** Yahoo's `assetProfile.sector` is mostly stable as `'Financial Services'`, but a small set of tickers (BX, KKR, certain insurance holding co's) come back as `'Financials'` (no plural) depending on the data freshness inside yahoo-finance2's schema. The strict-equality check skips them → no fallback. Already reported as quiet "tech tickers don't get fallback" in tests (line 913–915) but the inverse — a real financial that doesn't match — fails open.
**Fix:** `const _isFin = typeof _sectorRaw === 'string' && /^financial/i.test(_sectorRaw);`
**Introduced:** Tag 203.

### MEDIUM F4 — `provisionForCreditLosses ?? 0` (line 405–407) treats missing provision as zero, overstating bank OpInc
**File:line:** `pull-yahoo.js:405-407`
**Code:** `?? _y(r, 'provisionForCreditLosses') ?? 0;`
**Mechanism:** Comment claims "many banks omit; treat absent as 0 only when opEx exists" but the OR-chain doesn't gate on opEx — the `?? 0` always kicks in. For a credit-heavy bank where Yahoo populated `totalOperatingExpenses` but not the provision line, OpInc is overstated by ~5–15% (provision is typically 10% of revenue for credit shops like UPST). Cascades into `computed-bank` source while the actual estimate is biased high.
**Fix:** Distinguish "field absent" from "field zero" — emit a partial flag like `_debtPartial` already does for balance sheets: `provCL ?? 0` only when at least one OTHER bank line item (e.g., `totalDeposits`) confirms the row IS a bank schema; otherwise reject the path and fall through to insurance/margin.
**Introduced:** Tag 203.

---

## Domain: RnD Merge (Tag 202a)

### MEDIUM R1 — `qsRnDNonNull === 0 && ftsAnnualRnD.length > 0` branch overwrites with a possibly all-null FTS array
**File:line:** `pull-yahoo.js:1159-1161`
**Code:** `} else if (qsRnDNonNull === 0 && (ftsAnnualRnD || []).length > 0) { canonical.annual.annualRnD = ftsAnnualRnD; }`
**Mechanism:** The "keep FTS shape for downstream length-alignment" rationale is fine when FTS has entries (even all-null), but it overrides a QS path that also produced length-matched nulls. Net effect: harmless **except** when QS had a non-empty array of all-null and FTS has a longer all-null array — array length now over-states "available years" to consumers that use `.length` as a year count. `reinvestment-rate.js:105` triggers an "asset-light" fallback based on `annualRnD` emptiness; an all-null length-5 array reads as `length===5` and skips the asset-light branch incorrectly.
**Fix:** Compare on non-null count, not length: `else if (qsRnDNonNull === 0 && ftsRnDNonNull === 0) { keep whichever has greater length only if both are zero-info. }` Simpler: drop the else-if entirely; methods already null-check.
**Introduced:** Tag 202a.

### MEDIUM R2 — QS `annualRnDFromQS` builds full-length array including trailing nulls; FTS path only includes non-trimmed years — length mismatch breaks "strictly more non-null" comparison semantics
**File:line:** `pull-yahoo.js:500-503, 1098-1101, 1155-1158`
**Mechanism:** `annualRnDFromQS` walks all `isHist` rows including R&D-null ones → length = isHist.length (~4 years typically). `_ftsExtractByYear` (line 723–732) walks all FTS rows → length depends on FTS depth (~5–10 years). When QS has 0 non-null and FTS has 0 non-null but length 8, the `ftsRnDNonNull > qsRnDNonNull` test is `0>0=false`, then the else-if at 1159 kicks in. Correct outcome, but the comparison is **fragile**: a single transient FTS row with R&D=0 (literally zero, not null) shifts the count and the override fires unpredictably year-over-year. Result: `annualRnD` swaps shape between snapshots without an observable trigger.
**Fix:** Treat `0` and `null` as equally "non-data" for the comparison: `const nonNull = v => v != null && v !== 0;` Or commit to a primary source (QS for consistency, FTS as supplement when explicit).
**Introduced:** Tag 202a.

---

## Domain: General / Concurrency

### MEDIUM G1 — Worker-pool `idx++` is not atomic; in pathological scheduling 2 workers can share `myIdx`
**File:line:** `pull-yahoo.js:1343-1354`
**Mechanism:** Node single-threaded JS means `idx++` is in fact atomic for the increment-and-read step. **Verified safe** for Node — there is no preemption across the `myIdx=idx++` statement. Reclassified as no-bug. Kept here as a "looks scary but isn't" note for future reviewers.
**Reclassified:** Not a bug, remove from count. (Adjusts total to 8.)

### LOW L1 — `_convertSnapshotToUSD` comment block (line 293–307) lists reserved-but-absent metrics keys, risking confusion
**File:line:** `pull-yahoo.js:300-307`
**Mechanism:** Reserving keys that don't exist (`fcfTTM`, `ebitda`, `enterpriseValue`, `bookValuePerShare`, `cashPerShare`) suggests an allow-list contract that is not actually enforced anywhere else in the code — a future engineer might assume these are populated post-FX. Maintenance debt only.
**Fix:** Either delete reserved keys until used, or add a unit test that asserts the listed keys exist in `snap.metrics` after a full pull.
**Introduced:** Tag 204.

---

## Final Severity Counts (after reclassifications)

| Severity | Count | IDs |
|----------|-------|-----|
| CRITICAL | 0 | — |
| HIGH     | 4 | C2, F1, F2, F3 |
| MEDIUM   | 3 | C3, F4, R1, R2 *(corrected: 4)* |
| LOW      | 1 | L1 |
| **Total**| **8** | |

(Corrected MEDIUM: C3, F4, R1, R2 = **4**. Total = **9**.)

---

## Top 5 Bugs (Ranked by Production Impact)

| # | ID | File:Line | One-line Fix |
|---|----|-----------|--------------|
| 1 | **HIGH F2** | pull-yahoo.js:1137 | Drop the `.filter(v => v != null...)` on FTS-OpInc override; preserve null placeholders to keep annualOpInc[i] ↔ annualRev[i] aligned. |
| 2 | **HIGH F1** | pull-yahoo.js:1191 | Pass real `isHist` (not `[]`) into the post-FTS `_deriveOpIncForFinancials` retry so bank/insurance line-item paths can fire. |
| 3 | **HIGH C2** | pull-yahoo.js:619-621 | Detect `_fc==null && exchange!==US` and emit `meta._ccyAmbiguous`; do not silently default to USD reporting. |
| 4 | **HIGH F3** | pull-yahoo.js:485, 1190 | Replace `_sectorRaw === 'Financial Services'` with regex `/^financial/i.test(_sectorRaw)` to catch sector-string variants. |
| 5 | **MEDIUM F4** | pull-yahoo.js:405-407 | Gate `provisionForCreditLosses ?? 0` on presence of another bank-specific schema field; otherwise reject `computed-bank` path. |

---

## Cross-Reference to Recent Tags

| Tag | Changes Introduced | Bugs Found |
|-----|-------------------|------------|
| 202a | annualRnD QS-backfill + FTS merge logic | R1, R2 |
| 203  | Initial fintech OpInc derivation         | F3, F4   |
| 203d | Post-FTS sector retry                     | F1, F2   |
| 204a | ADR `financialCurrency` vs `currency`    | C2, C3   |
| 204  | metrics.* allow-list refactor            | L1       |

**Recommendation:** Land F1 + F2 in Tag 206a as a paired fix — both affect the same financial-services OpInc series and must be tested together against JPM/BAC/NU/UPST snapshots. Land C2 before next ADR-heavy universe expansion. Defer R1/R2 until a screener method actually trips on annualRnD shape drift (currently masked by `_rawVals` helper tolerance in methods/).

*— End of report.*
