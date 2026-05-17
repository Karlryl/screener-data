# Tag 227c — Under-Audited Modules Bug-Hunt

**Scope:** Three modules untouched by the Tag 215-225 audit cycle —
`methods/score-aggregator.js`, `generate-modes-report.js`,
`snapshot-methods-history.js` (+ the `methods-history/*.json` pipeline).

**Lens:** Operator precedence, field-name case mismatches, object-envelope
bugs, threshold direction, NaN propagation, silent fallbacks, try/catch
swallows, off-by-one, date math.

## Findings Summary

| ID | Severity | File | Status |
|----|----------|------|--------|
| F-227c-01 | HIGH | snapshot-methods-history.js:56 | FIXED Tag 227c-1 |
| F-227c-02 | HIGH | methods/score-aggregator.js:270 | FIXED Tag 227c-2 |
| F-227c-03 | MEDIUM | methods/score-aggregator.js:236 | documented |
| F-227c-04 | MEDIUM | methods/score-aggregator.js:331-335 | documented |
| F-227c-05 | LOW | methods/score-aggregator.js:326 | documented |
| F-227c-06 | LOW | snapshot-methods-history.js:121 | documented |
| F-227c-07 | LOW | generate-modes-report.js:534 | documented |

**Severity total:** 2 HIGH (both fixed), 2 MEDIUM, 3 LOW.

---

## HIGH (fixed)

### F-227c-01 (HIGH, FIXED Tag 227c-1) — methods-history pollution from `_manifest-full.json`

**File:** `snapshot-methods-history.js:56`

**Evidence:**
```js
const fileList = fs.readdirSync(args.snapshots)
  .filter(f => f.endsWith('.json') && f !== '_manifest.json');
```

`generate-modes-report.js:82` (Tag 220, audit F-GR-002 HIGH) was patched to
`!f.startsWith('_')` but the same fix was never applied here. `pull-yahoo`
writes both `_manifest.json` AND `_manifest-full.json` to `snapshots/` — the
latter slips through, gets handed to `Runner.evaluateStock({pulled_at, ...})`,
returns 3 computable-but-meaningless results, and is written into the daily
methods-history file under the basename ticker `_manifest-full`.

Empirically confirmed:
```
2026-05-08 (clean)
2026-05-13 (clean)
2026-05-14 _manifest-full   ← contaminated
2026-05-15 _manifest-full   ← contaminated
```

**Downstream impact:** `scripts/method-effectiveness.js:219-230` iterates
`file.stocks` and counts tickers with no price-history match into
`droppedTotal` — so the ghost biases the analytics' missing-data ratio. No
functional crash but ongoing data integrity drift.

**Fix:** mirror generate-modes-report.js Tag 220 — `!f.startsWith('_')`.

---

### F-227c-02 (HIGH, FIXED Tag 227c-2) — q-spike penalty mis-triggers at `spikeShare === 1`

**File:** `methods/score-aggregator.js:270`

**Evidence:**
```js
var shareRaw = qSpikeRes.components.spikeShare;
// components.spikeShare is already in percent (0-100); normalize.
var share = shareRaw > 1 ? shareRaw / 100 : shareRaw;
if (share > 0.40) { /* up to 50% score penalty */ }
```

`q-spike-dataguard.js:252,268` always returns `Math.round(spikeShare * 100)`
— integer percent 0-100. The defensive conditional was meant to skip
double-normalization but mis-handles the boundary value `1`: `1 > 1` is
false, so `share` stays at `1.0`, treated as 100% spike concentration,
maxing the 50% penalty on a stock that actually has *uniform* quarterly
revenue.

Distribution check today (3527 stocks): spikeShare values present span
{26, 27, ..., 87} — no stock currently hits the bug. But the path runs in
production whenever `AUDIT_SCORE_MULTIPLIERS=1` (dashboard + score-history
steps in daily-pull.yml).

**Fix:** `var share = shareRaw / 100;` (unconditional — matches contract).

**Fixture-hash safety:** the multiplier branch is env-gated and never
exercised by `tag28-tests.js` (which doesn't set
`AUDIT_SCORE_MULTIPLIERS`), so the fixture hash is unchanged. Confirmed
155/155 pass after fix.

---

## MEDIUM (documented)

### F-227c-03 (MEDIUM) — SOFT_GUARD_PENALTY `|| 5` fallback hides registration drift

**File:** `methods/score-aggregator.js:236`

**Evidence:**
```js
softGuardPenalty += SOFT_GUARD_PENALTY[sgId] || 5;
```

`net-debt-ebitda` is registered as a soft-guard in TURNAROUND
(`methods/strategy-modes.js:143`) but is **not present** in the
`SOFT_GUARD_PENALTY` table — so it silently uses the 5-point default
instead of the explicit weights for other guards (6-10 points). Two issues:
1. The `|| 5` masks any future typo'd guard ID (a misspelled guard quietly
   receives 5 instead of failing loudly).
2. A guard explicitly weighted at `0` (none currently, but conceivable for
   purely informational soft-guards) would be overridden to 5.

**Fix sketch:** swap `||` for `??` so explicit `0` is preserved, and warn
once if `sgId` is missing from the table:
```js
var p = SOFT_GUARD_PENALTY[sgId];
if (p == null) {
  if (!_warnedMissing[sgId]) {
    console.warn('[score-aggregator] soft-guard ' + sgId + ' has no penalty mapping; using 5');
    _warnedMissing[sgId] = true;
  }
  p = 5;
}
softGuardPenalty += p;
```

Not fixed in this audit cycle — would shift `softGuardPenalty` for
`net-debt-ebitda`-triggering Turnaround candidates only if we register it
in the table at the same time. Out of scope for a surgical bug-hunt.

---

### F-227c-04 (MEDIUM) — `dataQualityCapped` misses NEAR_MISS-already-applied case

**File:** `methods/score-aggregator.js:331-335`

**Evidence:**
```js
} else if (cap === 'NEAR_MISS' && (tier === 'A' || tier === 'B')) {
  tier = 'NEAR_MISS';
  dataQualityCapped = true;
}
```

If `tier` is already `NEAR_MISS` (e.g. red-flag downgrade from line 319)
AND `cap === 'NEAR_MISS'` (Grade C), the conditional branch is skipped, so
`dataQualityCapped` remains `false`. The cap WAS logically applied (it's a
no-op only because the redundant cap matched), but downstream UI loses the
audit trail — a stock that's red-flag-downgraded AND grade-C-capped looks
"only red-flag" in modes-report.

**Fix sketch:** treat the NEAR_MISS branch as "would-have-capped":
```js
} else if (cap === 'NEAR_MISS') {
  if (tier === 'A' || tier === 'B') tier = 'NEAR_MISS';
  dataQualityCapped = true;  // flag regardless — cap is informational
}
```

Gated behind `DATAQUALITY_ENFORCE=1` which is currently OFF — no production
impact today. Document for if/when Karl flips that switch.

---

## LOW (documented)

### F-227c-05 (LOW) — `DATAQUALITY_ENFORCE` strict `=== '1'` check

**File:** `methods/score-aggregator.js:326`

**Evidence:**
```js
if (process.env.DATAQUALITY_ENFORCE === '1' && dataQuality && ...) {
```

Same pattern as `AUDIT_SCORE_MULTIPLIERS` (fixed Tag 206l): strict string
equality means `true`, `yes`, `on`, `01` silently disable the gate even
when the user intends to enable it. Karl will hit this the moment he flips
the flag without reading the source.

**Fix sketch:** reuse the truthy-set pattern already in place above
(line 262-263):
```js
var _dqVal = (process.env.DATAQUALITY_ENFORCE || '').toString().toLowerCase();
if ((_dqVal === '1' || _dqVal === 'true' || _dqVal === 'yes' || _dqVal === 'on')
    && dataQuality && dataQuality.grade) { ... }
```

---

### F-227c-06 (LOW) — `allPass` accounting includes null-result methods in denominator

**File:** `snapshot-methods-history.js:102-121`

**Evidence:**
```js
for (const [mid, r] of Object.entries(results)) {
  if (!r) continue;           // skip null results
  ...
}
...
if (computableCount === Object.keys(results).length && passCount === computableCount) allPass++;
```

The `allPass` denominator is `Object.keys(results).length` — which still
includes any methods that returned `null`/falsy (skipped by the `if (!r)`
guard). Today `runner.evaluateStock` always returns a wrapped result via
`H.wrapEvaluate`, so no `null` entries exist in practice and `allPass`
correctly tracks "every method computable & passes." Bookkeeping is robust
to the current state but fragile to a future method that's allowed to
return null.

**Fix sketch:** count only the methods iterated, not the original key count:
```js
let totalEval = 0;
for (const [mid, r] of Object.entries(results)) {
  if (!r) continue;
  totalEval++;
  ...
}
if (computableCount === totalEval && passCount === computableCount) allPass++;
```

---

### F-227c-07 (LOW) — `dateLabel` locale-dependent, ignores RUN_DATE_UTC

**File:** `generate-modes-report.js:534`

**Evidence:**
```js
const generatedAt = runDate ? (runDate + 'T00:00:00.000Z') : new Date().toISOString();
...
const dateLabel = new Date(generatedAt).toLocaleDateString('de-DE', { day:'2-digit', month:'long', year:'numeric' });
```

`new Date(generatedAt).toLocaleDateString('de-DE', ...)` converts UTC midnight
to local timezone on the renderer — on a CI runner in UTC, that's still
the same date, but locally in `Europe/Berlin` during DST a UTC-midnight
date becomes "previous day" because the runner displays its local time. For
the `2026-05-17` UTC RUN_DATE_UTC, `new Date('2026-05-17T00:00:00.000Z')`
toLocaleDateString in CET prints "16. Mai 2026" — off by one day.

Today CI runs in UTC so the header is correct in production, but local
runs by Karl (`Europe/Berlin`) print the wrong date in the header
("yesterday"). Cosmetic, not data integrity.

**Fix sketch:** force UTC formatting:
```js
const dateLabel = new Date(generatedAt).toLocaleDateString('de-DE',
  { day:'2-digit', month:'long', year:'numeric', timeZone: 'UTC' });
```

---

## Non-Findings (verified safe)

Checked and dismissed as false alarms:

- **`b.value.toFixed(1)` chip render** (generate-modes-report.js:353):
  every method in `SCORE_WEIGHTS` returns numeric `.value` (verified on
  AAPL snapshot — all 18 weighted methods return `typeof === 'number'`).
  `b.value != null` guard handles the null-when-incomputable case.
- **`existing.stock.meta.ticker` access in dedupeByCompany** (line 186):
  stocks without `meta` produce `key === ''` and `continue` at line 182,
  so they never reach the existing-comparison branch.
- **`evaluateStock` envelope confusion** in snapshot-methods-history:
  initially suspected `for (const [mid, r] of Object.entries(results))`
  iterated `{results, disqualified, ...}` envelope, but `runner.js:90`
  exports `evaluateStockLegacy` which returns the flat `out.results` map.
  Safe.
- **RED_FLAG_RULES NaN guard** (score-aggregator:313): `fr.value != null`
  permits NaN, but `NaN > threshold` is always false for both HIGH_DEBT
  and EXTREME_SLOAN rules — no false-positive red-flag.
- **`annualFCF` field-name case** (snapshot-methods-history:76): matches
  `pull-yahoo.js` output (8 occurrences, uppercase FCF; 0 lowercase).
- **insufficient-coverage exit** (score-aggregator:218-225): correctly
  short-circuits with `score: null`; downstream filters in
  `topByScore`/`blockedByOneMust` handle null appropriately.

---

## Coverage statement

All three target modules read end-to-end (score-aggregator 358 lines;
generate-modes-report 1240 lines; snapshot-methods-history 154 lines).
Spot-checks ran against current `snapshots/` (3527 stocks) and last seven
`methods-history/` vintages. Test suites: `tag28-tests.js` 155/155
(fixture-hash stable), `engine-cli-tests.js` 10/10,
`tests/integration-anchor-test.js` 10/10 — all green pre and post the two
HIGH fixes.
