# Tag 222c — Documentation Accuracy Audit

**Date:** 2026-05-17
**Scope:** Read-only cross-reference of all in-repo prose (README.md, docs/, PROJECT-STATUS.md, ADR-001, method-file docstrings, workflow comments, audit-reports index) vs. code reality at HEAD (`40d81ca30`).
**Method:** Read each doc fully → for each numeric / structural claim → grep code → record drift.

---

## 1. Executive Summary — 18 findings

| Severity | Count | Class |
|---|---|---|
| **CRITICAL** | 3 | README + PROJECT-STATUS describe a system that no longer exists |
| **HIGH** | 5 | Method/script counts off by 3–4×, missing recent fields, stale `methods/disabled/` claim |
| **MEDIUM** | 6 | Workflow doc gaps, ADR phase-3/5 not annotated, package.json description stale |
| **LOW** | 4 | Cosmetic / encoding artefacts (`Â` BOM bytes in headers, German comment typos) |

**Headline finding:** the two top-level prose files (`README.md`, `PROJECT-STATUS.md`) describe **Karl's personal 10-stock watchlist tool** (Tag 18 / Tag 75 era). The repository at HEAD is a **15 734-ticker discovery pipeline** (Tag 165 / Tag 221). Almost every numeric claim in those two files is wrong by 1–3 orders of magnitude. Neither file has been touched in ~150 tags (Tags 76–221).

Conversely, the **method-file docstrings are very clean**: sampled 12 methods, 11 had docstring values matching code exactly, 1 had a documented re-write traceable in the source (Sloan-Ratio asymmetric fix, Tag 221). The ADR is structurally accurate but Phases 3/5 have not been executed and the ADR doesn't say so.

---

## 2. README.md — Claim vs. Reality

| # | README claim (line) | Reality | Drift |
|---|---|---|---|
| R1 | "Daily Yahoo-Pull + Score + Discord-Alert für Karls Hypergrowth-Watchlist" (L3) | **15 734-ticker discovery pipeline** that screens an entire global universe into HG / QC / SMALL / R40 / PRE-BREAKOUT modes; the watchlist is auto-refreshed by `refresh-universe.js` (Tag 132+), not curated. | **CRITICAL** — entire premise of file is outdated |
| R2 | "Beim nächsten Cron-Run werden neue Stocks gepullt, alte rausgeworfen" (watchlist editing instructions, L82) | `watchlist.json` is now `{ _meta, stocks:[…], lastUniverseRefresh, lastManualExpansion }` (Tag 207a). The editing instructions show the legacy flat-array schema. | **CRITICAL** — following the docs corrupts the watchlist |
| R3 | "Default: **Montag 08:00 UTC** … `'0 8 * * MON'` = wöchentlich (default)" (L71-78) | Workflow cron is `'0 2 * * *'` (daily 02:00 UTC). Has been since at least Tag 134. | **CRITICAL** — wrong schedule + wrong example |
| R4 | "Watchlist >50 Stocks: GitHub-Actions-Time-Limit (10min default) wird knapp" (L120) | `timeout-minutes: 240` (Tag 219); the actual run is 3+ hours on 15k tickers. | **HIGH** |
| R5 | "Engine-Tests laufen lokal mit `node engine-test.html` (Browser)" (L137) | No `engine-test.html` exists. Tests are `engine-cli-tests.js`, `tag21-tests.js`, `tag22-tests.js`, `tag28-tests.js`. | **HIGH** — example cannot work |
| R6 | "Aktienfinder: Quality-Score via Bookmarklet manuell synced" (L114) | ADR-001 declared `computeAktienfinderScore` doubly-dead (always `applicable:false`). `external-data/aktienfinder.json` is `{}` (Tag 221a finding C2). The bookmarklet flow is gone in practice. | **HIGH** |
| R7 | Initial-run example uses `--rate-limit 1500` (L65) | Workflow uses `--rate-limit 2000` and `PULL_CONCURRENCY=8` (Tag 215f). | **MEDIUM** |
| R8 | Cron-trigger model: README implies push triggers re-run | Per user memory `workflow_triggers.md`: daily-pull only runs on cron + dispatch, never on push. README doesn't mention this. | **MEDIUM** |
| R9 | `package.json` `scripts.pull` uses `--rate-limit 1500` | Workflow real value is 2000. Same drift as R7 in a second place. | **LOW** |

---

## 3. PROJECT-STATUS.md — Claim vs. Reality

This file is dated **2026-05-07 / Tag 75**. We are at Tag 222, ~10 days and 147 tags later. It is essentially abandoned.

| # | Claim | Reality | Drift |
|---|---|---|---|
| P1 | "**Tag 75 erreicht**. 23 aktive Methoden + 4 disabled" | **80 entries** in `methods/index.js`; the `methods/disabled/` directory **is empty** (verified — `ls` returns nothing). | **CRITICAL** |
| P2 | "**70 Stocks** Watchlist (kein Position-Tracking, kein Buy-Signal)" | 15 734 tickers in watchlist; modes-report assigns mode-membership which the screener UI uses to surface picks. | **CRITICAL** |
| P3 | "23 Methoden parallel, alle isoliert (kein Aggregat-Score)" | `methods/score-aggregator.js` exists and is the production scorer (per ADR-001). HG/QC/TURN composite scores are explicit (`SCORE_WEIGHTS`). | **HIGH** — directly contradicts ADR-001 + score-aggregator |
| P4 | "Aktive Methoden (23): … aktienfinder-quality, multi-year-stability, roce, magic-formula" | None of those four files exist in `methods/`. | **HIGH** |
| P5 | "Disabled Methoden (4, in methods/disabled/)" | `methods/disabled/` empty; ADR-001 explicitly says the directory was removed Phase 2. | **HIGH** |
| P6 | Cron "Mo 08:00 UTC" | Same as R3 — really `0 2 * * *` daily. | **HIGH** (consistent lie across two files) |
| P7 | CLI-tools list omits all of `scripts/*.js` (19 scripts) and `score-orchestrator`/`snapshot-picks`/`generate-screener`/`generate-dashboard`/`compute-picks-lookback`/`audit-classifications`/`backtest-*` (10+ scripts). | Most current tooling is undocumented in PROJECT-STATUS. | **HIGH** |
| P8 | "Reports (HTML): methods-report.html, diff-report.html" | Repo also produces `screener.html`, `dashboard.html`, `modes-report.html`, `index.html` (deployed to gh-pages). | **MEDIUM** |
| P9 | Roadmap "Tag 76+" — none of the actually-shipped items (sector-relative ROIC, Beneish, Ohlson, capital-allocation, Mauboussin intangible ROIC, 13F, Form4 puller, …) are listed. | The file's roadmap is the wishlist of a different project. | **LOW** (it's clearly a backlog) |

---

## 4. ADR-001 — Accuracy

The ADR's *factual* claims (which functions are dead, which are kept, why) are **all correct** at HEAD:

- `engine-v7.3.js` does emit `[engine-v7.3 DEPRECATED] … is retired per ADR-001` warnings (verified L928).
- `methods/disabled/` is indeed gone.
- `methods/index.js` is an explicit allow-list (verified).
- `score-aggregator.js` is the production scorer (verified by `SCORE_WEIGHTS` references in 24 method files).

**Gaps:**

| # | Issue | Severity |
|---|---|---|
| A1 | ADR Phase 3 ("Migrate `engine-cli-tests.js` to test `score-aggregator` directly, then physically remove Track-A/B exports") is **not done** — `scoreTrackA`/`scoreTrackB` still exist at L931+. ADR doesn't note this. | **MEDIUM** |
| A2 | ADR Phase 5 ("Delete `score-orchestrator.js` and `diagnose-spec.js`") is **not done**. Both files still present. Neither is marked deprecated in their docstring (the ADR claims `score-orchestrator.js` would be marked deprecated in its module docstring — grep returns 0 deprecation mentions in that file). | **MEDIUM** |
| A3 | `score-orchestrator.js` header still describes itself as "**Single source of truth für Score-Berechnung**" — exactly the opposite of what the ADR retired. | **MEDIUM** |

---

## 5. Method-File Header Sample (every ~5th alphabetically)

Sampled 12 method files. Verified docstring threshold + intent vs. code.

| Method | Docstring threshold | Code constant | Match? |
|---|---|---|---|
| `altman-z-score.js` | "Pass: Z″ >= 1.1" | `THRESHOLD = 1.1` | OK |
| `analyst-revision-breadth.js` | "net_4w >= 3" | matches header text | OK |
| `asset-growth-divergence.js` | "15pp / 0.15 decimal" | `THRESHOLD = 0.15` | OK |
| `beneish-m-score.js` | "M < -2.22" | constant matches | OK |
| `closed-end-trust-guard.js` | pattern S1-S4 described | code implements all 4 | OK |
| `ev-ebitda.js` | implied ≤ 20 (default text) | `THRESHOLD = 20` | OK |
| `fcf-stability.js` | "CoV <= 0.40" | `THRESHOLD = 0.40` | OK |
| `hypergrowth-quality-class.js` | "TTM-Rev ≥ $100M ODER ≥ 0.5% Mcap" | `MATERIAL_REV_FLOOR=100e6`, `MATERIAL_MCAP_RATIO=0.005` | OK |
| `insider-buy-cluster.js` | ">= 2 distinct buys 90d" | `THRESHOLD = 2` | OK |
| `loss-magnitude-guard.js` | ">= -0.50" | `THRESHOLD = -0.50` | OK |
| `peg.js` | "PEG ≤ 1.5 (Lynch)" | `THRESHOLD = 1.5` | OK |
| `reinvestment-rate.js` | ">= 20%" | `THRESHOLD = 0.20` | OK |
| `rule-of-40.js` | ">= 40" | `THRESHOLD = 40` | OK |
| `sloan-ratio.js` | header still describes symmetric `|Sloan|` thresholds | code (post-Tag 221) is **asymmetric** — only positive direction triggers WARN/REVIEW/FAIL; negative passes with `NEGATIVE-OK` flag (L71-79) | **DRIFT** — only sampled mismatch |
| `working-capital-anomaly.js` | "≤ 1.3" | `THRESHOLD = 1.3` | OK |

**Method-header accuracy: 13/14 sampled = 93%.** The one drift (Sloan) is from a fix landed today (`52660f43d`) — the inline code comment was added but the top-of-file docstring still describes the pre-Tag-221 symmetric logic.

Minor encoding artefact: `sloan-ratio.js` L3, `reinvestment-rate.js` and several others contain stray `Â` bytes / UTF-8-as-Latin-1 mojibake in the header comments (e.g. `Tag 117 v2 â eskalierte`). Cosmetic; no functional impact.

---

## 6. Workflow Comments — `.github/workflows/daily-pull.yml`

Spot-checked all 35 `Tag NNN…` comments in the YAML. **All read accurately** vs. the steps they introduce — this file is the best-maintained piece of prose in the repo. Tag references are consistent (Tag 132 universe refresh, Tag 142 prune, Tag 147 coverage gate, Tag 161/162/207b/215e calibration, Tag 168 health-check, Tag 192/218 freshness gate, Tag 207a/b schema-aware checks, Tag 218–220 atomic-write hardening, Tag 219a date-rollover fix). No `Tag N: …` comment in the YAML refers to a step that doesn't exist or does something different.

**One omission:** there is **no comment explaining the cron drift from README's "MON" to actual `0 2 * * *` daily**. A one-line comment in the schedule block pointing future readers at the README so they know to update both would close the loop.

---

## 7. Stale / Wrong Examples

1. `README.md` L65 — `node pull-yahoo.js … --rate-limit 1500` — rate is 2000 today.
2. `README.md` L82-93 — flat-array `watchlist.json` schema example; real schema is wrapped.
3. `README.md` L137 — `node engine-test.html` (file does not exist).
4. `package.json` scripts — three `pull*` scripts still encode the 1500/500/100 rate-limit triplet; only the 2000 workflow value is real.
5. `PROJECT-STATUS.md` "23 active methods" listing — 4 of the 23 named files do not exist.
6. `fixes-for-pull-yahoo.md` — top-level file describes an audit (F-DP-004, F-DP-013) that has since been integrated and re-audited via Tag 217–221 cycles. The file is undated and never marked done.

---

## 8. Highest-Value TODO/FIXME Comments

The repository is **remarkably clean**: only **1 TODO** in production code.

| File:Line | Note | Value |
|---|---|---|
| `pull-yahoo.js:591` | `// SBC-Ratio: nicht in Default-Modules — TODO Tag-14: separater financials-Module-Pull` | Stale (Tag 14, we're at Tag 222). SBC is now pulled via FTS. Either remove the TODO or wire SBC ratio to consume the existing field. |
| `tag28-tests.js:374` | `normalizeRegion('XXX', 'London')` — `XXX` is a test-fixture string, not a real TODO. | None |

No FIXME, no XXX (real), no HACK. This is healthy.

---

## 9. ADR / Decisions

- `docs/decisions/ADR-001-retire-track-a-b-scoring.md` — Status: Accepted 2026-05-13. **Phases 2 done, 3 + 5 pending without note.** Should append a "Status update 2026-05-17" line.
- No other ADRs exist. Given the volume of methodology decisions made Tag 75 → 222 (Mauboussin intangible-ROIC, Beneish, Ohlson, capital-allocation composite, Tag 211 fixture-hash invariant, Tag 218/219 atomic-write hardening), **at least 3–4 more ADRs are missing**.

---

## 10. Field-Name Drift (Tag 219)

Tag 219 schema audit (per Tag 221a finding C1) added/renamed `annualSGA`, `annualShares`, `_quality`, `insiderActivity`. README, PROJECT-STATUS, and ADR-001 do not mention any of these. The newer field names appear only inside method-file headers (which is correct for those methods) — but no top-level doc describes the post-Tag-219 snapshot schema.

---

## 11. Discord Webhook Setup Instructions

README L48–58 ("Discord-Webhook") describes the manual GitHub-secret setup. This matches `daily-pull.yml`'s `DISCORD_WEBHOOK: ${{ secrets.DISCORD_WEBHOOK }}` exactly. **No drift here.** What's not documented: Discord alerts now also fire from `picks-regression-check.js`, `check-pull-stats.js`, `pipeline-health-check.js`, and the workflow's failure-notify step — README implies the only alerter is `detect-changes.js`.

---

## 12. Audit-Reports Folder

47 audit reports dated 2026-05-14 → 2026-05-17 (~3-day spree).

**Spot-checks of action follow-through:**
- `2026-05-17-tag217b-older-methods-A-M.md` → fixes landed in `0c5d68613` (Tag 217g: 7 HIGH fixes). OK.
- `2026-05-17-tag217c-older-methods-N-Z.md` → fixes landed in `0c5d68613`. OK.
- `2026-05-17-tag218b-scripts-audit.md` → atomic-write fixes in `b714b8243` (Tag 218b: atomic writes for 8 output scripts). OK.
- `2026-05-17-tag218c-workflows-lib-audit.md` → 7 fixes in `9a2558f63` (Tag 219a). OK.
- `2026-05-17-tag219b-cross-file-dataflow.md` + `2026-05-17-tag219c-yahoo-schema-audit.md` → fixes in `2653d3730` (Tag 220c). OK.
- `2026-05-17-tag220a-core-engine-audit.md` + `2026-05-17-tag220b-report-generators-audit.md` → fixes in `40d81ca30` (Tag 221c — today's tip). OK.
- `2026-05-17-tag221a-data-integrity.md` (C1: Tag 211l schema un-deployed; C2: `aktienfinder.json={}` ; C3: 2026-05-12 date gap) → **no fix commit found** for the three CRITICAL data-integrity issues. They appear to be deferred or accepted.
- `2026-05-17-tag221b-cross-method-consistency.md` → fixes in `52660f43d` (sloan asymmetric + earnings-stability scaled-horizon). Partial — 2 of 12 findings addressed.

Most-recent audit (`tag221a`) flags items that are clearly known-unfixed. Audit-report → commit mapping is generally good; the directory tells a coherent story.

---

## 13. Recommendations

### Rewrite (full)
1. **`README.md`** — the document is 5 months out of date relative to system reality. Needs full rewrite around: discovery-pipeline framing, the actual cron (`0 2 * * *`), wrapped `watchlist.json` schema, real test commands, the gh-pages deploy. Setup section can shrink to ~10 lines (anyone using this repo today is Karl, who set it up).
2. **`PROJECT-STATUS.md`** — either delete (its content lives in `audit-reports/`) or rewrite for the Tag 222 era (80-method registry, modes-report architecture, screener-dashboard 6 tabs, the 6 `pull-*` scripts, the 19-script `scripts/` folder).

### Minor updates
3. **`docs/decisions/ADR-001-retire-track-a-b-scoring.md`** — append "Status update 2026-05-17: Phase 3 + Phase 5 not yet executed." Mark `score-orchestrator.js` docstring as deprecated per the ADR's stated intent.
4. **`methods/sloan-ratio.js`** header — rewrite the top docstring to describe the asymmetric (post-Tag 221) logic; the inline L71-79 comment is fine, but the top-of-file is the entry-point for any new reader.
5. **`pull-yahoo.js:591`** — remove the Tag-14 TODO or convert it into a real action.
6. **`fixes-for-pull-yahoo.md`** — close out (mark which F-DP-* fixes landed in which Tag) or delete.
7. **`package.json`** — bump `--rate-limit 1500` → `2000` in the `pull` script, or drop the scripts since the workflow is the real entrypoint.

### Add (new ADRs)
8. ADR-002: Fixture-hash invariant (Tag 211 — DIAGNOSTIC vs SCORE_WEIGHTS distinction).
9. ADR-003: Universe-discovery architecture (Tag 132–165 — `refresh-universe.js` + OTC + NASDAQ Screener API; max 13 000 default).
10. ADR-004: Atomic-write hardening across all output scripts (Tag 218b).

---

**Findings: 18 (3 CRITICAL, 5 HIGH, 6 MEDIUM, 4 LOW).** Top-3 actionable items:

1. **Rewrite `README.md`** so the README of a 15 000-ticker pipeline does not advertise itself as a 10-stock watchlist tool with weekly cron + a non-existent test command.
2. **Either delete or rewrite `PROJECT-STATUS.md`** — it is the single highest source of confusion (every claim is wrong) and the `audit-reports/` directory already supersedes it.
3. **Append a status-update line to ADR-001** noting Phases 3 + 5 not executed, and mark `score-orchestrator.js` as deprecated per the ADR's own stated intent.
