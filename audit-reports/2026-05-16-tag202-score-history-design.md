# Tag 202 — Score-History Infrastructure (Design Doc)

**Audit Agent 10**, 2026-05-16. Design-only. No code changes in this tag.

## 1 · Problem

`generate-screener.js:783-786` (Section D of the detail modal) currently shows
only the *current* `hgScore` / `qcScore` / `pbScore` plus the placeholder
*"Score history accumulates as daily snapshots are retained (single snapshot
today)."* The Tag 176 dashboard spec requires a **ΔScore** badge (7d, 30d) per
ticker and a small sparkline of historical scores.

Existing infrastructure that *almost* solves this but doesn't:

- `picks-history/<YYYY-MM-DD>.json` — only the **top-100 picks per mode**.
  Tickers that drop out get no entry; we'd lose the "score went from 65 → 40"
  story for everything that flipped from QC to WATCH. **Not sufficient.**
- `methods-history/<YYYY-MM-DD>.json` — every ticker × every method's raw
  pass/value, ~14 MB/file. Has the *raw inputs* to recompute mode scores, but
  doesn't store the aggregated `hgScore`/`qcScore` itself (those are derived in
  `score-aggregator.js` and `generate-screener.js`, downstream of this file).
  Recomputing 30d of `hgScore` from `methods-history` on every dashboard build
  would be expensive and brittle (score-aggregator weights drift).
- `snapshots/<TICKER>.json` — per-ticker raw Yahoo data, no historical scores.

→ We need a **purpose-built, per-ticker, append-only score log**.

## 2 · File Structure / Schema

```
score-history/
  AAPL.json
  MSFT.json
  …
  _meta.json            ← schema version, last-run-date, ticker count
```

Each `<TICKER>.json` is a small array (last 30 entries, newest last):

```json
{
  "ticker": "AAPL",
  "schemaVersion": 1,
  "entries": [
    { "date": "2026-04-16", "hgScore": 62.3, "qcScore": 88.1, "pbScore": 41.0,
      "hgTier": "STRONG", "qcTier": "STRONG", "hgClass": null },
    { "date": "2026-04-17", "hgScore": 62.8, "qcScore": 88.4, "pbScore": 41.2,
      "hgTier": "STRONG", "qcTier": "STRONG", "hgClass": null },
    …30 entries max…
  ]
}
```

**Size budget** (validates the 50 MB GitHub cap):

- entry size: ~150 B JSON (6 numeric fields + date + 3 short strings).
- 30 entries × 150 B = 4.5 KB per ticker.
- 4 147 tickers (current `universeSize` from latest `picks-history`) ×
  4.5 KB ≈ **18.7 MB committed** — comfortably under 50 MB.
- With universe expansion to 13 000 (`MAX_UNIVERSE` in `daily-pull.yml:67`):
  13 000 × 4.5 KB ≈ **57 MB** — over budget. Mitigation: keep 14 entries (not
  30) for tickers outside the top-2 mode lists; full 30 only for the ~1 500
  tickers ever appearing in HG ∪ QC ∪ PRE_BREAKOUT. Decision deferred until
  universe actually exceeds 6 000.

`_meta.json` carries `{schemaVersion, lastRun, tickerCount, schemaHash}` so
generate-screener can detect schema drift and skip-with-warn rather than crash.

## 3 · Update Logic (single pass, append + prune)

New script: `scripts/snapshot-score-history.js`. ~80 LoC.

```
For each snapshot in snapshots/*.json:
  • compute hgScore, qcScore, pbScore, tiers, hgClass
    (reuse extractRow() from generate-screener.js — refactor into lib/score-row.js)
  • read score-history/<TICKER>.json  (or {entries:[]} if absent)
  • drop today's entry if it already exists (idempotent re-runs)
  • push {date: today, ...}
  • slice to last 30
  • writeFileAtomic via lib/atomic-write.js  (Tag 189 invariant)
For tickers in history but NOT in today's snapshots (delisted/dropped):
  • do nothing — the file ages out organically as new entries push old ones
For tickers in today's snapshots but not in history (new IPO/added):
  • create file with a single entry (ΔScore null until day 2)
```

Per-ticker atomic write is mandatory: a `SIGKILL` mid-loop must not corrupt the
30-entry tail for any single ticker. Pattern matches `snapshot-picks.js`.

Reads run in 200-file async batches (mirrors `snapshot-methods-history.js`'s
`loadFilesAsync`) to keep wall-time under 30 s for 13 000 tickers.

## 4 · Workflow Integration

Inserted into `.github/workflows/daily-pull.yml` **after** `Generate Screener
Dashboard` (currently line 242-246) and **before** `Snapshot Picks-History`:

```yaml
- name: Snapshot Score-History
  env:
    AUDIT_SCORE_MULTIPLIERS: '1'   # match dashboard's score basis
  run: node scripts/snapshot-score-history.js --snapshots snapshots --out score-history
  continue-on-error: true
```

Critical: `AUDIT_SCORE_MULTIPLIERS=1` must match the dashboard step
(line 244). Otherwise stored scores diverge from displayed scores — exactly
the silent-corruption pattern Audit Group A targets.

Pipeline-health entry (`pipeline-health/snapshot-score-history.json`) mirrors
the per-script health contract (Tag 168). 5 % failure-rate threshold.

The script must run **before commit** (line 396-437) so the new
`score-history/*.json` files land in git. Place it as step #N where N is
between Generate Screener (242) and Snapshot Picks-History (253).

## 5 · generate-screener.js Integration

In `extractRow(stock, …)` around line 225 (the return object), add:

```js
const hist = readScoreHistory(ticker);  // memoized; reads score-history/<T>.json
const score7d  = hist.findEntry(today, -7);   // closest entry ≥7d old
const score30d = hist.findEntry(today, -30);
return {
  …,
  hgScoreDelta7d:  hgScore != null && score7d?.hgScore  != null ? hgScore - score7d.hgScore : null,
  hgScoreDelta30d: hgScore != null && score30d?.hgScore != null ? hgScore - score30d.hgScore : null,
  qcScoreDelta7d:  …,
  qcScoreDelta30d: …,
  scoreHistory:    hist.entries.slice(-30)   // for sparkline
};
```

Modal Section D (line 783-786) renders the sparkline + two ΔScore badges
(green ≥ +5, red ≤ -5, mute otherwise). Use the existing `spark()` helper
(line ~700).

`findEntry(today, -N)` policy: pick the entry whose date is **on or before**
`today - N` days; tolerates weekends/holidays/missed pulls. If no entry that
old exists, returns `null` → ΔScore renders as "—".

## 6 · Migration Path

Day 1 (deploy): script runs, writes one entry per ticker. All ΔScores null;
modal shows "Δ7d: — · Δ30d: —". Sparkline shows single point.

Day 7: Δ7d becomes meaningful; Δ30d still null.

Day 30: full feature live for tickers continuously present since Day 1.

**Backfill option** (not in v1): a one-shot `scripts/backfill-score-history.js`
that replays the last 30 `methods-history/*.json` files through
`score-aggregator.js` to seed history retroactively. Documented for Tag 203;
skipped initially because score-aggregator weight changes between vintages
would make backfilled scores subtly wrong (the dashboard would show ΔScore
movements that are actually weight-change artifacts).

## 7 · Edge Cases

| Case | Behavior |
|---|---|
| Ticker added mid-cycle | New file with 1 entry; ΔScore null until +7d/+30d |
| Ticker removed (delisted) | File stays; never updated; eventually orphaned. Tag 203 garbage-collector: delete `score-history/X.json` if ticker absent from snapshots for 60 days |
| Score flipped tier (STRONG → REJECT) | Stored as-is; Δ-rendering treats null→number and number→null both as "—" (avoids "Δ = +∞") |
| Schema bump (v1 → v2) | `_meta.json.schemaVersion` mismatch → `generate-screener.js` reads `entries: []`, logs `::warning::score-history schema vN, expected v1`, dashboard shows "—" gracefully. Migration script `scripts/migrate-score-history.js` upgrades files lazily |
| Missed pull (no snapshot for a day) | No entry written; rolling window slides over the gap. 30-entry array might span 35-40 calendar days; `findEntry(date, -7)` is robust because it picks "≤today-7" not "exactly today-7" |
| `AUDIT_SCORE_MULTIPLIERS` flag drift | If snapshot-score-history is run without it but dashboard renders with it, stored history is 5-15 % lower than current score — visible as a permanent fake "score uplift today". **Hard mitigation**: both steps must share the env block; CI assertion in `scripts/pipeline-health-check.js` (Tag 193) cross-checks that today's stored score within ±0.5 of today's dashboard score |
| Atomic-write race (two runs overlap) | `concurrency: main-push` group (workflow line 16) prevents two daily-pulls running simultaneously. Within a run, the script is single-process |
| File-system case (Windows vs Linux) | All tickers already case-normalized in `snapshot-picks.js`; reuse same convention. Use lower-case filename `aapl.json`? **No** — match `snapshots/AAPL.json` which is upper-case; saves one normalization round-trip |

## 8 · Test Plan (for Tag 203 implementation)

1. Unit: `findEntry({entries: [...]}, '2026-05-16', -7)` returns correct entry
   for: exact match, weekend gap, ticker-younger-than-N-days, empty entries.
2. Integration: run snapshot-score-history.js twice on the same day → no
   duplicate entry, file unchanged after second run (idempotent).
3. Fixture-hash: per Karl's `fixture_hash_invariant.md`, this script is
   downstream of `SCORE_WEIGHTS` so adding it must not change tag28 fixture
   hash — verify with `node tag28-tests.js` before/after.
4. Size: after first run on full universe, `du -sh score-history/` < 25 MB.
5. CI: `pipeline-health-check.js` allowlist updated (F-CI-002, Tag 193) so the
   new script's health file is expected.

## 9 · Out of Scope (Tag 203+)

- Backfill from methods-history
- Garbage-collection of delisted tickers
- Per-ticker ΔScore Discord alerts ("AAPL hgScore dropped 20+ in 7d")
- Aggregate "biggest movers" tab on the dashboard

---

**Deliverable**: this design doc. Implementation deferred to Tag 203 per
agent-spec instruction.
