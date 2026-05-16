# Tag 206 — generate-screener.js Deep Static Review

**Scope:** `C:/Users/Karlr/OneDrive/Dokumente/GitHub/screener-data/generate-screener.js` (1283 lines).
**Mode:** READ ONLY. No node executed. No code modified.

---

## Severity Totals
- **CRITICAL:** 0
- **HIGH:** 4
- **MEDIUM:** 5
- **LOW:** 6
- **Total:** 15

---

## R40-Sanity-Cap Integration Checkpoints

| # | Checkpoint | Result | Note |
|---|---|---|---|
| 1 | `buildRow` extracts `r40SanityFail` from `r40-sanity-cap` | **PASS** | L268-269. `!!(r40Sanity && r40Sanity.computable && r40Sanity.pass === false)` matches the pattern of the other gates. |
| 2 | Field included in row payload | **PASS** | L334. |
| 3 | `classifyTabs` includes it in `hardGated` chain | **PASS** | L399. |
| 4 | `watchReasons` pushes `'R40-SANITY'` badge | **PASS** | L411. String matches the WATCH tab explainer (L797 mentions "R40-Sanity-Cap"). |
| 5 | CLIENT_JS modal/row renders R40-SANITY badge | **PARTIAL — see Bug H-2** | The WATCH tab shows it via `r.watchReasons.join(',')` (L783). Modal Section A (`sigBadges`, L892-908) renders Q-SPIKE, LOSS>50%REV, METRIC-DIV, TRUST — but **omits r40SanityFail, niVolFail, preCommFail**. User opening modal of an R40-SANITY-failed stock sees no explicit badge. |

**Overall: PARTIAL PASS** — payload + admission logic + WATCH-row rendering are correct end-to-end. Modal header badge bar is missing the new gate.

---

## Score-History Rendering Checkpoints

| # | Checkpoint | Result |
|---|---|---|
| 1 | `readScoreHistory` memoised | PASS (L83 `_scoreHistoryCache`) |
| 2 | `_buildScoreHistoryPayload` handles missing/empty entries | PASS (L127-130 short-circuit) |
| 3 | `findEntryAtOrBefore` tolerates weekends/missed pulls | PASS (L105-115) |
| 4 | Delta returns null when prior == today (self-compare) | PASS (L137-138) |
| 5 | Payload `{deltaScore7d, deltaScore30d, history}` reaches client | PASS (L312 → L337 → modal L944) |
| 6 | Spark series order correct (newest-first reversed) | PASS (L958 `slice().reverse()`) |
| 7 | Day-1 fallback ("≥2 snapshots") | PASS (L955-962) |

**Overall: PASS**

---

## Bugs

### HIGH

**H-1 — Missing DATAGUARDs in hardGated chain (silent leakage)**
File/Line: `generate-screener.js:399`
Description: The `hardGated` chain references q-spike, loss-mag, metric-div, ni-vol, pre-comm, cet, r40-sanity. But `methods/` ships additional DATAGUARDs: **`revenue-shock-guard`** (header self-declared "DATAGUARD"), `revenue-volatility-guard`, `quarter-concentration-guard`, `deceleration-guard`, `forecast-contamination-guard`. Their `pass === false` verdict is silently ignored by classifyTabs — a stock failing only `revenue-shock-guard` is admitted to HG/QC/R40. Per the file's own comment style (Tag 199 hardgates), any DATAGUARD whose `pass=false` is a hard signal must be wired in.
Fix: Extract booleans for each (`revShockFail`, `revVolFail`, `qConcFail`, `decelFail`, `forecastFail`), include them in `hardGated`, and push corresponding reason strings (`REV-SHOCK`, `REV-VOL`, etc.). If a method is intentionally scoring-only (not hard-gate), document that in its header — otherwise wire it in.

**H-2 — Modal sigBadges missing 3 hard-gate signals**
File/Line: `generate-screener.js:902-905`
Description: Modal shows `Q-SPIKE`, `LOSS>50%REV`, `METRIC-DIV`, `TRUST` badges but omits `niVolFail`, `preCommFail`, `r40SanityFail`. Click into a row hard-gated only by R40-SANITY → modal looks healthy, audit signal invisible. Inconsistent with WATCH row reason text which does show all of them (L405-413).
Fix: Add three more `if (r.xxxFail) sigBadges.push(...)` lines for ni-vol / pre-comm / r40-sanity.

**H-3 — WATCH tab can contain duplicate row entries**
File/Line: `generate-screener.js:415, 462`
Description: A stock that fails a hard-gate is pushed to `tabs.WATCH` at L415, then `continue`s. **But** a NEAR_MISS-tier QC/HG stock pushed at L462 is fine alone. The bug occurs differently: a hard-gated stock with `hgTier='NEAR_MISS'` does `continue` so no dup. However the `r.watchReasons = reasons` mutation at L414 mutates the shared row object — the same row is referenced from `rowsByTicker` (L1134) and from `tabsByTicker.WATCH` ticker-list. Currently no second mutation site for `watchReasons`, so observable damage is limited. **Real duplicate risk:** if a stock has `hgTier==='NEAR_MISS'` AND `qcTier==='NEAR_MISS'`, the OR at L461 pushes once (OK). But if classifyTabs were ever called twice on the same row arrays (no current caller does this), WATCH duplicates would result because no de-dup exists.
Fix: De-dup WATCH at end of classifyTabs: `tabs.WATCH = Array.from(new Map(tabs.WATCH.map(r => [r.ticker, r])).values());` Defense-in-depth.

**H-4 — R40 penalized-sort treats null `r40` as 0, breaks order vs. raw**
File/Line: `generate-screener.js:481`
Description: `((b.r40 || 0) * (1 - bPen)) - ((a.r40 || 0) * (1 - aPen))`. tabs.R40 is built with `Number.isFinite(r.r40)` guard (L452), so r40 is always a finite number there → null risk is mitigated. **However:** negative r40 (e.g. r40 = -20 for a deep-loss SaaS) is admissible. A penalty of 0.5 changes -20 to -10, which sorts HIGHER than raw -20. So a penalty for a quality-suspect stock with negative r40 actually promotes it in the ranking. Penalty should never improve rank.
Fix: Apply penalty only when `r40 > 0`. Replace with `const adj = (x) => x.r40 > 0 ? x.r40 * (1 - computeR40Penalty(x)) : x.r40;` Then `return adj(b) - adj(a);`.

### MEDIUM

**M-1 — R40 hard-gate comment is misleading**
File/Line: `generate-screener.js:451-454`
Description: Comment says "subject to hard gates above — already filtered" but R40 admission only checks `Number.isFinite(r.r40)`. The "already filtered" claim is true ONLY because hard-gated rows hit `continue` at L416. If anyone refactors that `continue` out, R40 admits hard-gated rows silently. Comment should explicitly say "relies on `continue` at L416".

**M-2 — `niVolFail`, `preCommFail`, `cetFail`, `r40SanityFail` not surfaced as modal signal sets**
File/Line: `generate-screener.js:892-908`
Description: See H-2. Categorized MEDIUM here for the broader pattern: modal Section A is the audit window for human reviewers but lags whenever new hard-gates are added. Recommend a single helper `pushFailBadge(label, condition)` driven by a registry, so future gates are wired in one place.

**M-3 — `fmtP` sign handling is dead code / always "+"**
File/Line: `generate-screener.js:624`
Description: `return (v>=0?'':'')+(v).toFixed(...)+'%'`. The ternary is `v>=0 ? '' : ''` — both branches are empty string. Looks like an intended `'+' : ''` for positive sign. Currently negative values are signed by `toFixed` (works), positive values have no `+`. Doesn't break anything but ternary is dead.
Fix: `(v>=0?'+':'')` if positive-sign desired; else delete the ternary.

**M-4 — Tag-explainer dictionary missing HG and QC entries**
File/Line: `generate-screener.js:793-798`
Description: `TAB_EXPLAINERS` has PRE_BREAKOUT, WATCH, SMALL, R40 — missing HG and QC. L817 logic correctly hides element when key absent, so no crash, but UX inconsistency: switching back to the default HG tab clears any prior explainer.

**M-5 — Search results badge can show "QC" for hard-gated REJECT-tier stocks pushed to WATCH-only**
File/Line: `generate-screener.js:1030-1032`
Description: `badge` uses `h.qcTier && h.qcTier !== 'REJECT' ? 'QC' : ''`. A stock can have `qcTier='PRIME'` and still be hard-gated (WATCH-only). Search will tag it "QC" suggesting it's in the QC tab when it isn't. Consider deriving from actual `TABS` membership.

### LOW

**L-1 — `revPrev` defined and unused** — L917: declared but never referenced (yoyDelta is also declared but unused). Dead code.

**L-2 — `Math.max(0, growth)` and `Math.min(100, ...)` redundant clamp** — L219: `Math.min(100, Math.max(0, growth))` — Math.max only matters if growth<0; for SaaS R40 calc on negative growth, this hides decline. Acceptable for pbScore by design but worth a comment.

**L-3 — `if (!mcap)` treats negative mcap as null** — L616 `capBucket`: `if (!mcap) return null;` — 0 and NaN both null. Acceptable, but inconsistent with server-side `mcap > 0` check at L448. Minor.

**L-4 — `currentList` variable name reused for tab-membership state** — L613, L803: `currentList` is the active filtered list. navModal reads it (L1008), but on rapid tab switch a race could leave a stale list. JS is single-threaded → no actual race, but the global feels brittle. LOW.

**L-5 — `JSON.stringify` does NOT escape `</script>` reliably** — L1153: only escapes `</`, not `<!--`. A company name containing `<!--<script>` could comment out following script content. Extremely defensive, given names go through Yahoo Finance, but consider replacing `<` → `<` for full safety.

**L-6 — `findEntryAtOrBefore` is O(n) per call, called twice per stock per build** — L105: with 30 entries per ticker and ~3500 tickers = 210k comparisons. Fine today; if score-history grows to 365 entries, sort-once-then-binary-search would scale. LOW.

---

## Top 5 Bugs (quick reference)

| Rank | ID | File:Line | Severity | One-liner |
|---|---|---|---|---|
| 1 | H-1 | generate-screener.js:399 | HIGH | Several DATAGUARD methods (revenue-shock-guard, etc.) absent from hardGated chain. |
| 2 | H-2 | generate-screener.js:902-905 | HIGH | Modal sigBadges omits niVolFail/preCommFail/r40SanityFail — invisible audit signals. |
| 3 | H-4 | generate-screener.js:481 | HIGH | R40 sort penalty improves rank for negative-r40 stocks (sign-flip bug). |
| 4 | H-3 | generate-screener.js:415,462 | HIGH | No de-dup on tabs.WATCH; row reference shared across rowsByTicker. |
| 5 | M-3 | generate-screener.js:624 | MEDIUM | `fmtP` sign ternary is dead code (both branches empty string). |

---

## Notes on Things Checked and NOT Found
- JSON-in-script `</script>` injection: defended at L1153.
- Field name typos (e.g. `r40Sanity_fail`): not present; consistent camelCase throughout.
- Sort comparator stability for null r40 in tab construction: protected by `Number.isFinite` filter at L452.
- buildRow scoreHistory wired into row payload and modal: end-to-end OK.
- R40 penalty math `Math.min(0.95, pen)` clamp prevents zero-out: OK.
- ID character escaping in escHtml: covers `& < > " '` correctly.
