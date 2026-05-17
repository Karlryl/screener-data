# Tag 229c — Infra-Modules Audit

**Date**: 2026-05-17
**Branch**: main
**Scope**: `methods/data-quality.js`, `detect-changes.js`,
`scripts/refresh-fx.js`, `discovery/sec-tickers.js`.

This audit continues Tag 227c's coverage of under-audited infrastructure
modules.

---

## Summary

| Severity | Findings | Fixed in 229c | Documented |
|----------|----------|---------------|------------|
| CRITICAL | 0        | —             | —          |
| HIGH     | 3        | 3             | —          |
| MEDIUM   | 6        | 1 (CIK)       | 5          |
| LOW      | 2        | 0             | 2          |
| **Total**| **11**   | **4**         | **7**      |

### Fixed (separate commits)

- **Tag 229c-1**: METHOD_RECOVERED event in `detect-changes.js` (HIGH).
- **Tag 229c-2**: `discovery/sec-tickers.js` redirect hardening + null CIK on
  missing source (HIGH + MEDIUM).
- **Tag 229c-3**: surface fx-rates.json corruption in `scripts/refresh-fx.js`
  (HIGH).

---

## refresh-fx.js — special-attention review (Tag 226c-4 cross-check)

**Result: refresh-fx.js is NOT the root cause of the Tag 226c-4 finding**
(1,640 international snapshots show no `fxConverted`/`fxRateApplied`).

Evidence: `fx-rates.json` (committed) shows TWD, HKD, JPY, CNY, KRW all
present with fresh `lastSuccessAt: 2026-05-15T10:51:24.743Z` and rates
matching expected magnitudes (TWD=0.0318, HKD=0.1277, JPY=0.00631,
KRW=0.00067). The 32-currency CURRENCIES list at `scripts/refresh-fx.js:24-43`
covers every currency that appears in the affected international tickers
(.HK→HKD, .T→JPY, .KS→KRW, .L→GBp/GBP, .PA/.AS→EUR, .SW→CHF, .TW→TWD).

The actual root cause must be in `pull-yahoo.js _convertSnapshotToUSD` /
`mapYahooToCanonical` reading the wrong field name for non-US reporting
currencies (the post-Tag-220 schema only landed on US tickers; intl pulls
still skip the conversion call or skip the snapshot rebuild). That work
belongs in a follow-up agent focused on the puller — out of scope here.

---

## methods/data-quality.js (153 lines)

### F-229c-04 — **MEDIUM**: `gradeSnapshot` includes non-deterministic `computedAt` in returned object

**File**: `methods/data-quality.js:99, 123`
**Evidence**:
```js
return { grade: 'D', nanRatio: 1.0, missingFields: ['<invalid-snapshot>'],
         computedAt: new Date().toISOString() };
// ...
return {
  grade,
  nanRatio: Math.round(nanRatio * 1000) / 1000,
  missingFields: missing,
  computedAt: new Date().toISOString()
};
```
**Mechanism**: Every call returns a fresh ISO timestamp. `pull-yahoo.js:1627`
embeds the returned object into `canonical._quality`, which is then
serialized into the snapshot JSON. The result: even when **nothing has
changed about the snapshot's data quality**, the `_quality.computedAt`
field rotates on every pull → every snapshot file shows as "modified"
in git diff even on price-only updates. Compounds with the price-only
path's `gradeSnapshot` no-rerun (F-DQ-004 in findings/data-pipeline.json):
when fresh full-pull does write `computedAt`, but stale price-only updates
preserve the prior timestamp.
**Impact**: Cosmetic noise in git diffs (~3.5k snapshot files churn per
pull), bloats commit size. Not a correctness issue. Could mask real
quality regressions by drowning them in noise.
**Fix sketch**: Drop `computedAt` from the returned object. The
snapshot-level `meta.asOf` already carries the timestamp. Alternatively,
omit it on full-pull but return `computedAt: snapshot.meta.asOf` so it's
deterministic per snapshot.

### F-229c-05 — **MEDIUM**: `_arrLen` counts non-envelope objects as present without value-check

**File**: `methods/data-quality.js:83-89`
**Evidence**:
```js
return arr.filter(x => {
  if (x == null) return false;
  if (typeof x === 'number') return Number.isFinite(x);
  if (typeof x === 'object' && 'value' in x) return Number.isFinite(x.value);
  // Other objects (balance rows etc.) count as present
  return true;
}).length;
```
**Mechanism**: Balance-sheet rows like `{ totalCash, totalDebt, totalAssets }`
fall through the third branch and unconditionally count as "present" —
even if all their numeric subfields are NaN/null. The CRITICAL_FIELDS
entry `annual.annualBalance>=2` (weight 0.5) checks for >=2 rows but those
rows can be `{totalCash:null, totalDebt:null, totalAssets:null}` and still
pass.
**Impact**: Stocks with junk balance-sheet rows (all-null fields) inflate
data-quality grade. With DATAQUALITY_ENFORCE off this is dormant. If Karl
enables enforcement, a Yahoo balance-sheet schema flap could let bad
data ride at A/B grade.
**Fix sketch**: Add a presence check inside the object branch — count the
row only if at least one numeric subfield is finite.

### F-229c-06 — **LOW**: D-grade is unreachable from threshold math

**File**: `methods/data-quality.js:60-66, 113-118`
**Evidence**: `GRADE_THRESHOLDS.C = 1.00`. With finite weights,
nanRatio ∈ [0, 1] always. The `if (nanRatio <= 1.00) grade='C'; else
grade='D'` branch can only reach D when nanRatio > 1.0 — impossible
under current logic. Only the null-snapshot guard (line 99) emits 'D'.
**Mechanism**: Documented inconsistency: `tierCapForGrade('D')` returns
'REJECT' but D is functionally unreachable except via the
`<invalid-snapshot>` guard. The flow at line 281 of tag28-tests.js
(`heavily-empty snapshot -> grade C`) confirms a snapshot missing every
critical field still lands at C, not D.
**Impact**: Cosmetic — operators reading the docstring see "D: >50%
fehlend" but actual mapping is C up through 100% missing. No functional
defect.
**Fix sketch**: Either tighten C to `nanRatio < 1.0` and route 1.0 → D,
or update the docstring to match (C absorbs 60–100% missing; D reserved
for invalid-snapshot only).

---

## detect-changes.js (449 lines)

### F-229c-07 — **MEDIUM**: `prev.value.toFixed(2)` throws on non-numeric stored values

**File**: `detect-changes.js:163, 170, 183`
**Evidence**:
```js
message: `${methodId}: ${prev.value != null ? prev.value.toFixed(2) : '?'} → ${result.value != null ? result.value.toFixed(2) : '?'} (now PASS)`
```
The guard `prev.value != null` allows any truthy non-null value through,
including strings or objects from a schema migration. `.toFixed(2)`
throws TypeError on non-numbers.
**Mechanism**: A future migration that stores `value` as a different
shape (e.g. `{raw, normalized}` object) would crash every diff
computation, killing the entire alert pipeline. Today all writers
go through `detectMethodDiffs` which writes plain numbers, but the
sticky `wasComputable: true` marker (line 188) sits next to `value:
null` and shows the file has multiple shapes already.
**Impact**: Single bad ticker × method record from migration corruption
crashes alert-state.json processing for ALL tickers. Hard-fail mode.
**Fix sketch**: Replace `prev.value.toFixed(2)` with
`Number.isFinite(prev.value) ? prev.value.toFixed(2) : '?'` (matching
the result.value branch which already uses Number.isFinite at line 205).

### F-229c-08 — **MEDIUM**: `wasComputable` test fails for value=0 vs missing field

**File**: `detect-changes.js:152`
**Evidence**:
```js
const wasComputable = prev && prev.value != null;
```
**Mechanism**: `prev.value === 0` (e.g. FCF margin exactly 0) makes
`0 != null` true → `wasComputable=true`. That's correct. But a method
that legitimately had value=0 and then becomes incomputable in this
run triggers METHOD_INCOMPUTABLE event with message
`was 0.00 (FAIL) → now NOT COMPUTABLE`. That's fine. No bug.

Crosscheck for the **opposite** case: prev was the post-METHOD_INCOMPUTABLE
record `{value: null, pass: false, wasComputable: true}`. Now
`prev.value === null`, so `wasComputable = (prev && null != null) =
false`. Combined with `isComputable=true`, this should land in the
METHOD_PASS_NEW branch — but `!prev` is false (prev exists). It falls
through to the final ELSE. **This is the bug fixed by Tag 229c-1.**
Documented here for cross-reference only.

### F-229c-09 — **LOW**: redundant `wasComputable` check still uses `prev.value != null` after Tag 229c-1

**File**: `detect-changes.js:152`
**Evidence**: After Tag 229c-1, the prev shape includes a sticky
`prev.wasComputable === true` marker for METHOD_INCOMPUTABLE records.
The `wasComputable` variable now has dual meaning: derived from
`prev.value != null` for normal records, vs the marker for recovery
detection. A future cleanup could rename for clarity (e.g.
`prevHadValue` vs `prevWasComputableMarker`).
**Impact**: None functional — purely readability.
**Fix sketch**: Defer to a follow-up refactor when METHOD_RECOVERED
ships to prod.

### F-229c-10 — **MEDIUM**: `_saveMethodHistory` failure does not abort `saveState`

**File**: `detect-changes.js:57-64, 133-138`
**Evidence**:
```js
// F-SM-008: write sidecar first, then committed state (sidecar failure won't skew stores)
_saveMethodHistory(state.methodHistory || {});
// Atomic write via tmp+rename (was already done; preserved from existing code)
const tmp = statePath + '.tmp.' + process.pid;
fs.writeFileSync(tmp, JSON.stringify(committed));
fs.renameSync(tmp, statePath);
```
`_saveMethodHistory` wraps in `try/catch` and only logs WARN. If it
fails (disk full, permission denied, EROFS), the alert-state.json still
gets the new lastRun timestamp. Next run: trend signals lost (no
history written), but alert-state thinks history was updated.
**Mechanism**: F-SM-008 comment claims "sidecar failure won't skew stores"
— but it DOES skew the trend pipeline. Trend-history detection (used
by methods/trend.js) relies on the committed sidecar. Silent loss
of an N-day window of trend data.
**Impact**: Up to one CI run's worth of trend signal lost per failure.
Multi-day failure compounds.
**Fix sketch**: Surface sidecar write failure as a process exit code 2
(non-blocking — alert-state still saved) so CI annotates the run.
Alternatively, abort saveState entirely on sidecar failure so the next
run reprocesses the same window.

---

## scripts/refresh-fx.js (158 lines)

### F-229c-11 — **MEDIUM**: stale currencies persist forever after removal from CURRENCIES list

**File**: `scripts/refresh-fx.js:76-77`
**Evidence**:
```js
const rates = Object.assign({ USD: 1.0 }, existing);
const currencyMeta = Object.assign({}, existingMeta);
```
**Mechanism**: When a currency is removed from the CURRENCIES list
(e.g. if Karl drops VND because no VND tickers remain), the existing
rate and meta entries for VND remain in fx-rates.json forever via
Object.assign carrying them through each refresh. The rate ages
indefinitely without warning because no fetch attempt is ever made.
pull-yahoo loadFx then loads the ancient rate as if it were live.
**Impact**: Low-severity — only triggers if a currency is removed from
CURRENCIES. Currently the list only grows. But a re-trim would silently
keep stale rates active.
**Fix sketch**: After the fetch loop, prune `rates` and `currencyMeta`
entries that are NOT in `CURRENCIES` (preserving USD always).

### F-229c-12 — **MEDIUM**: half-failed run still writes file before exit(1) on critical blackout

**File**: `scripts/refresh-fx.js:117-131`
**Evidence**:
```js
writeFileAtomic(outPath, JSON.stringify(out, null, 2));
console.log('Wrote fx-rates.json with ...');
// ...
if (criticalFailed.length >= 3) {
  console.error('::error::Critical FX blackout: ...');
  process.exit(1);
}
if (failed.length > CURRENCIES.length / 2) process.exit(1);
```
**Mechanism**: When critical FX blackout triggers, the partial result
has ALREADY been written to disk. Subsequent steps in CI that read
fx-rates.json (e.g. if a downstream job re-uses the workspace) will
see the half-baked rates. The exit(1) only stops the GH Actions step
— it doesn't roll back the file write.
**Impact**: Low — daily-pull.yml fails fast on the FX step so downstream
steps don't run. But if anyone re-orders steps or adds a parallel job
that reads fx-rates.json, they'd see the broken file.
**Fix sketch**: Move the critical-blackout check before writeFileAtomic.
Or write to a `.partial` filename when the check fails, requiring an
explicit promotion step.

---

## discovery/sec-tickers.js (already fixed in 229c-2)

All findings rolled into Tag 229c-2:
- HIGH: relative-Location URL crash (fixed)
- HIGH: socket leak on redirect (fixed)
- MEDIUM: unbounded redirect recursion (fixed via MAX_REDIRECTS=5)
- MEDIUM: synthetic CIK '0000000000' on missing source field (fixed)
- LOW: 307/308 redirects ignored (fixed by adding to status list)

---

## Cross-module: Tag 226c-4 root-cause hypothesis (out-of-scope deeper dig)

The Tag 226c-4 finding (1,640 intl snapshots un-fx-converted) is NOT in
any of the four modules audited here. Evidence chain:

1. `fx-rates.json` has all required currencies fresh (verified line by
   line: TWD/HKD/JPY/CNY/KRW all at 2026-05-15).
2. `refresh-fx.js` covers all 32 currencies, including every currency
   appearing in suffixed intl tickers.
3. `pull-yahoo.js _convertSnapshotToUSD` correctly applies the rate
   when reportingCurrency is set (verified by TSM.json's clean
   conversion envelope).

Root cause is upstream of `_convertSnapshotToUSD`: either
(a) `mapYahooToCanonical` doesn't populate `meta.reportingCurrency` for
non-US Yahoo responses (so the function early-returns at line 252 as
"already USD"), or
(b) the price-only fast-path bypasses the full mapper entirely for
intl tickers, and the original full pull happened before the Tag 220
schema landed.

Tag 226c-4 evidence ("every intl snapshot fetched 2026-05-13 lacks the
post-Tag-220 schema; the one fresh snapshot from today (TSM, 2026-05-17)
has it") strongly suggests (b): full pulls now write the new schema, but
the price-only path is preserving stale pre-Tag-220 envelopes for intl
tickers, never triggering a re-conversion. Recommend a Tag 229d agent
focused on the `_priceOnlyUpdate` / `_quality` recompute path.

---

## Verification

All three test suites pass after the three fix commits:
- `tag28-tests.js` → 155/155 (fixture-hash stable)
- `engine-cli-tests.js` → 10/10 (API surface intact)
- `tests/integration-anchor-test.js` → 10/10 (anchor stocks tier-stable)
