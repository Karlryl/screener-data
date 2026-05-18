# CONTEXT — Resume-Briefing for the Next Session

_Last updated: 2026-05-18, post Tag 231 wave-11._

---

## Standing /goal (Karl's directive — persistent across sessions)

> "arbeite kontinuirlich bis dein Limit aufgebraucht ist am screener
> research betreibe research um herauszuufinden was fehlt was verbessert
> werden kann finde bugs fixe diese bugs arbeite weiter am dashboard
> damit es professioneller aussieht und denke daran der screener ist bei
> max 20% potential"

Translation: keep working continuously; research what's missing/improvable;
hunt bugs; polish the dashboard; remember the screener is at ~20% of its
potential.

**Operating mode:** autonomous. Karl says `weiter` / `weiter mit der nächsten
wave` — do not ask clarifying questions, dispatch the next wave. Edges
where confirmation IS still required: secrets, force-pushes, history
rewrites, anything that costs money via external APIs (Yahoo CDN counts).

---

## Current pipeline state

| Item | Value |
|---|---|
| Branch | `main` (138 unpushed commits this session) |
| Snapshots in `snapshots/` | 3,529 (will jump after the first post-Run-#110 universe expansion) |
| Watchlist `watchlist.json` | 15,734 tickers |
| Methods registered | 98 files (CORE 15, DATAGUARD 13, DIAGNOSTIC 70) |
| `methods/index.js` entries | 86 (some optional) |
| Fixture-hash | stable at the Tag-117 18-method anchor |
| `tag28-tests.js` | 155/155 PASS |
| `engine-cli-tests.js` | 10/10 PASS |
| `tests/integration-anchor-test.js` | 10/10 PASS (all anchors qualifying) |
| Last successful GH Actions Run | #109 (2026-05-17 20:10 UTC) — first green after #105–#108 all failed |
| Run #110 ETA | 2026-05-18 02:00 UTC cron, ~3.5–4h budget |

---

## What changes during the NEXT pull runs

**Run #110 (tonight 02:00 UTC):**
- First run with Tag 215f concurrency=8 + Tag 219 240min timeout + Tag 219c
  `financialCurrency` ADR fix all live at full scale.
- Tag 226a-2 stale-snapshot probe is DORMANT this run (99.9% of snapshots
  lack `meta.asOf`, so full-pull runs by default for everyone).
- After Run #110: all snapshots carry `meta.asOf`, Tag 211l fields
  (annualSGA, currentAssets/Liabilities, etc), Tag 219 fields (beta,
  ebitda, EV), Tag 220c fields (majorHoldersBreakdown, earningsHistory),
  Tag 219c `financialCurrency` ADR-correct conversion. Snapshot count
  likely climbs ~3,529 → ~15,000+ as `MAX_UNIVERSE 25000` (Tag 227a-1)
  takes effect.

**Run #111 (2026-05-19 02:00 UTC):**
- Tag 226a-2 probe ACTIVATES — forces full-pull on any snapshot missing
  Tag 211l fields (~3,400 stale entries → fresh).
- Tag 230a probe ACTIVATES — forces full-pull on any intl snapshot
  missing currency normalization (~1,640 intl tickers → re-FX'd).
- Methods expected to jump from ~0–1.5% to ~80% coverage after #111:
  `sga-revenue-trend`, `working-capital-trend`, `ohlson-o-score`,
  `magic-formula`, `penman-nissim-decomposition`, `analyst-upside`,
  `earnings-surprise-momentum`, `institutional-density`,
  `betting-against-beta` (full anchor coverage), incidental lift on
  `buyback-yield` + `capital-allocation-quality`.
- All 1,640 intl tickers re-currency-normalized — fixes mathematically-wrong
  ratios in `fcf-yield` / `ev-ebitda` / `peg` / `pre-commerciality-megacap-guard`
  for ~46.5% of universe that's been silently broken for months.

If Run #110 or #111 fails, [[memory:workflow_triggers]] applies — only
cron + manual dispatch fire it, not push.

---

## Anchor stocks — all 10 currently PASS

NVDA / MSFT / PLTR / META / COST / GOOG / AVGO / V / CRDO / MELI

Most recent fixes that unblocked anchors:
- **MELI** (Tag 225a): `EXTREME_SLOAN` red-flag rule was `Math.abs() > 0.20`,
  treated NEGATIVE_OK (-20.6% conservative accounting) as accrual
  manipulation. Now sign-aware (`val > 0.20`).
- **V** (Tag 225e-1): `reinvestment-rate` 20% threshold mis-calibrated for
  Financials/REITs (asset-light by structure). Added sector-aware override
  map (Financial Services / REITs / Insurance → 5–8%, default 20%).

Pattern enforcement (don't break): **never exclude an anchor to pass a
guard; fix the guard.** Hardcoded ticker exclusions are forbidden.

---

## 17 new DIAGNOSTIC methods added this session (Tag 211–230)

| Tag | Method | Cite |
|---|---|---|
| 211d | earnings-power-stability | Lepetit et al 2024 SSRN |
| 211e | fcf-conversion-stability | Damodaran/Mauboussin |
| 212a | operating-leverage-margin-accel | Mauboussin 2014 |
| 212b | revenue-quality-cov | Asness-Frazzini-Pedersen 2019 QMJ |
| 213a | institutional-ownership-13f | SEC 13F-HR |
| 213b | price-momentum-12-1 | Jegadeesh-Titman 1993 / AMP 2013 |
| 214a | sga-revenue-trend | Lev-Thiagarajan 1993 JAR |
| 214b | capex-vs-sbc-quality | Mauboussin Counterpoint 2024 |
| 215d | working-capital-trend | Lev-Thiagarajan 1993 JAR |
| 223a | analyst-upside | Damodaran consensus |
| 223a | earnings-surprise-momentum | PEAD: Foster 1984 / Bernard-Thomas 1989 / Liu-Strong 2024 |
| 223a | institutional-density | majorHoldersBreakdown ≥50% floor |
| 224b | ohlson-o-score | promoted DIAGNOSTIC → DATAGUARD (logit bankruptcy) |
| 226c-5 | asset-growth-anomaly | Cooper-Gulen-Schill 2008 JF |
| 227b-1 | magic-formula | Greenblatt 2005 / Gray-Carlisle 2012 |
| 227b-2 | penman-nissim-decomposition | Penman-Nissim 2003 RAS |
| 230b | betting-against-beta | Frazzini-Pedersen 2014 JFE |

**Validation:** Tag 229b walk-forward smoke test confirmed asset-growth-anomaly,
magic-formula, and penman-nissim all show directionally-correct 5d forward
return spread (PASS > FAIL) across 7 vintages. Magic-formula + Penman-Nissim
pending puller-activation for full coverage.

---

## Most important bugs killed this session

1. **Tag 219c (CRITICAL):** Yahoo silently moved `financialCurrency` from
   `price` to `financialData`. TSM/BABA/9988.HK were mis-FX'd by ~30× for
   months. Fixed with fallback chain `_y(pr,'financialCurrency') ||
   _y(yahoo.financialData,'financialCurrency')`.
2. **Tag 220b (CRITICAL):** `methods-report.html` was 267 MB (all 3528
   rows embedded full JSON). Shrunk to 9.73 MB via TOP_PICKS_N=200 slice
   + shared STOCK_DATA_MAP.
3. **Tag 222:** `pull-historical-prices.js` `JSON.stringify(history,null,2)`
   created a 280 MB string (V8 hard limit 512 MB) → OOM at scale. Dropped
   pretty-print → 80 MB compact.
4. **Tag 226a-2:** Tag 166 price-only fast-path silently stranded Tag 211l
   new fields. With `FTS_CACHE_VERSION` locked at 2, 96.5% of universe
   carried stale shape. Field-presence probe forces full-pull without
   bumping cache version (respects Karl's invariant).
5. **Tag 229c HIGH:** `detect-changes.js` METHOD_RECOVERED event has been
   silently swallowed for months — incomputable→computable transitions
   invisible because `prev.value != null` set `wasComputable=false` AND
   `!prev`-branch didn't fire.
6. **Tag 230c HIGH:** `lib/atomic-write.js` 3 durability gaps (Pillai/
   OSDI-2014 pattern): no POSIX parent-dir fsync, no Windows EPERM retry,
   no `writeSync` partial-write loop. Critical for state files on Karl's
   Windows + OneDrive setup.
7. **Tag 231a HIGH:** `walk-forward-perf.js` had look-ahead bias from
   `nearestTradingDay` alternating scan after `getEntryDate` T+1, AND
   pick/benchmark measured over different calendar windows on weekends.
   Alpha estimates were inflated.

---

## Open punch list

| Item | Source | Priority |
|---|---|---|
| `_priceOnlyUpdate` intl-currency stale envelopes (Tag 226c-4 / 230a fix is wired but dormant until Run #111) | known | medium |
| `pull-yahoo.js` at 19k+ tickers projects to 14.6h — eventual GH Actions matrix-sharding architecture needed (sketched in `audit-reports/2026-05-17-tag226b-run-109-eta.md`) | Tag 222a + 226b | high (eventually) |
| OTC source-attribution: historical 10,858 `auto-universe-refresh` entries lost their `source` field pre-Tag-169; current code correct, no retroactive fix without forbidden live re-pull | Tag 228c | low (cosmetic, surface-attribution) |
| 7 documented MEDIUM/LOW findings across Tag 227c/229c/230c/231a audit reports | various | low |
| Fast-path activation verification on Run #110 + #111 — verify probes fire and `_convertSnapshotToUSD` runs on intl tickers | Tag 229a + 230a | high (next session pickup) |

---

## Operating constraints (binding rules)

These are non-negotiable; documented here so the next session inherits them:

- Node binary at `C:\Program Files\nodejs\node.exe` (NOT on PATH).
- Never modify `FTS_CACHE_VERSION` (stays at 2).
- Never edit `methods/index.js` from parallel agents (race-prone shared
  registry — use coordinator pattern or wave-serialize).
- Never push to remote unless Karl explicitly asks.
- Never use `--no-verify` to skip hooks.
- `audit-classifications.js` MUST stay gitignored.
- Hardcoded ticker exclusions in method logic are forbidden — build
  pattern-based signatures.
- Every method change must include a comment explaining the failure mode
  it prevents.
- After every method change: run `tag28-tests.js` + `engine-cli-tests.js`
  + `tests/integration-anchor-test.js` to verify no anchor regressed +
  fixture-hash stable.

---

## How to resume — first 3 actions for next session

1. Check Run #110 outcome: `gh run list --workflow=daily-pull.yml --limit=3`
   (or read the Monitor task output). If FAIL — diagnose and dispatch fix
   wave before anything else.
2. If Run #110 succeeded: read `snapshots/_manifest-full.json` to confirm
   universe expanded (~15k vs current 3,529).
3. Run `tests/integration-anchor-test.js` to confirm 10/10 anchors still
   PASS post-snapshot-refresh. If any anchor degraded, that's the next
   wave's headline.

Then dispatch Tag 232 wave-12 per /goal.

---

## Memory references (auto-memory at C:\Users\Karlr\.claude\projects\C--Users-Karlr-OneDrive-Dokumente-GitHub-screener-data\memory\)

- `toolchain_local.md` — what's available on Karl's Windows box
- `workflow_triggers.md` — daily-pull doesn't run on push, cron + dispatch only
- `autonomy_mode.md` — execution > clarifying questions
- `fixture_hash_invariant.md` — only SCORE_WEIGHTS-listed methods affect hash
- `audit_parallel_pattern.md` — 3-5 agents per wave, commit as Tag NNNa-e
- `github_auth.md` — OAuth token extraction from Windows Credential Manager
- `parallel_agent_race.md` — never parallel-edit shared registry files
- `yahoo_finance2_schema_spam.md` — silence via `validation:{logErrors:false}`
- `dead_code_method_activation.md` — pulled-side fix, not method-side
- `ci_coverage_gate_calibration.md` — universe grows, percent-only gates tighten silently
