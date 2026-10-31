# screener-data

Node.js stock-screener pipeline. On trading days it pulls fundamentals and prices for about 24 000 global tickers, scores each ticker with one formula per sector route, writes the daily boards to `board-history/` and publishes the findash export and a status page to GitHub Pages.

Engineer-to-engineer reference. No marketing copy. Agent rules: `CLAUDE.md`, `AGENTS.md`. Where this README and the running code disagree, the code wins. For chronological context see `audit-reports/`.

---

## What this is

- **Inputs:** Yahoo Finance (`yahoo-finance2`), SEC EDGAR XBRL (financial-statement extension), SEC EDGAR Form 4 (insider transactions), SEC EDGAR 13F-HR (institutional holdings), NASDAQ Screener API, OTC Markets (OTCQX / OTCQB / Expert), the exchange and listing adapters in `discovery/`, and exchange-printed quarterly revenue (`docs/exchange-quarters-store.md`).
- **Universe:** about 24 000 tickers in `watchlist.json` (24 148 on 2026-10-22), refreshed each run by `refresh-universe.js` (cap `MAX_UNIVERSE` 25 000).
- **Outputs:** one vintage per run in `board-history/<date>/` (13 sector boards plus `survival`, with `calibration.json` and `regime.json`). On the `gh-pages` branch: `index.html` (status page) and `outputs/` (findash export `outputs/findash-export/v1`, coverage marker, macro regime, rank-IC, pull stats). `outputs/` and `snapshots/` are git-ignored on `main`.
- **Schedule:** `cron: '17 2 * * 2-6'` (Tue–Sat 02:17 UTC) plus `workflow_dispatch`. GitHub starts scheduled runs late: between 2026-10-15 and 2026-10-22 they began between 06:56 and 07:38 UTC. Main pipeline: `.github/workflows/daily-pull.yml`; 12 further workflows in the same directory (PR check, heartbeat, weekly guard, monthly plan-check, monthly SEC-XBRL, small-cap pull, TV reachability, exchange quarters, exchange-check shadow, computed-margin A/B, early-detection research data, findash watchdog).
- **Wall-clock per run:** about 80 to 90 min for the successful runs between 2026-10-14 and 2026-10-22 (highest job `timeout-minutes: 200`, the pull matrix).
- **Runtime:** Node 22 (`engines.node >=22`).

This is a discovery / screener tool. The official score measures quality, never price. There is no portfolio tracking, no buy/sell signal, no broker integration.

---

## Architecture

`.github/workflows/daily-pull.yml` runs these jobs (order follows `needs:`):

- **`prep`** (once): test gate `--mode=blocking`, `refresh-universe.js` → `watchlist.json`, FX rates, shard count (`SHARD_COUNT` 17, single source for the matrix).
- **`quarter-candidates`, `quarter-selection`**: plan the capped reload of stale quarterly statements (`scripts/plan-stale-quarter-reload.js`).
- **`pull`** (matrix, 17 shards): `pull-yahoo.js --shard i/17` → shard snapshots.
- **`prices`** (sharded): `pull-historical-prices.js`.
- **`merge`**: merges shard snapshots and manifests, runs the F-12 filter (`scripts/filter-snapshot-merge.js`), the freshness and two-stage coverage gates, commits to `main` and deploys to Pages.
- **`scoring`**: `src/scoring/run-screener.js`, `scripts/write-findash-export.js`, Pages deploy of the scoring output, then writes and commits the `board-history/` vintage.
- **Guards:** `entdeckungs-waechter`, `earnings-transport-waechter`, `jahres-ausreisser-waechter`, `druckenmiller-guard`, `feed-fill-waechter`; **`laufstatus`** runs after all jobs and summarises the run.

## Scoring

- `src/scoring/router.js` maps each ticker to a sector route (provisional GICS map).
- `src/scoring/formulas/index.js` holds one formula per route (13 routes); `src/scoring/formulas/quality/` and `src/scoring/formulas/smallcap/` carry the quality and small-cap boards.
- `src/scoring/board-status.js` marks each route `core` or `diagnostic`; a diagnostic route is scored and shown as unproven. Unknown routes fall back to `diagnostic`.
- Score formulas take no price-normalised signal (yield, P/E, PEG, EV/EBITDA, DCF, target upside, price momentum).
- Hand tables for proven vendor errors live in `configs/` (for example `configs/yahoo-q4-known-cases.json`, documented in `docs/yahoo-q4-known-cases.md` and `docs/financial-corrections.md`).

---

## Repository layout

```
.
├── .github/workflows/        # daily-pull.yml (main pipeline) + 12 further workflows
├── pull-yahoo.js             # fundamentals + quotes, sharded (--shard i/N)
├── pull-historical-prices.js # daily OHLCV, sharded
├── pull-earnings-dates.js    # Yahoo earnings calendar
├── pull-sec-xbrl.js          # monthly SEC financial-statement extension (+ merge-sec-xbrl.js)
├── refresh-universe.js       # universe assembly -> watchlist.json
├── discovery/                # exchange and listing adapters used by refresh-universe.js
├── src/scoring/              # engine: run-screener.js, router.js, formulas/, board-status.js, score.js
├── lib/                      # shared modules (atomic writes, guards, stores)
├── scripts/                  # pipeline steps, gates, exports, replays
├── tests/                    # standalone test files (see Tests); tests-parked/ is not run
├── configs/, config/         # hand tables, policies and switches read by the pipeline
├── data-health/              # registers (quarantine, NAV holdings, value open items, baselines)
├── board-history/            # daily board vintages (successor of picks-history/)
├── picks-history/            # FROZEN since 2026-07-02, see picks-history/_FROZEN.md
├── methods-history/, score-history/, r40rx-history/  # historical stores, no current writer
├── prices/, price-shards-in/ # price history
├── external-data/            # SEC, 13F, Form 4 and exchange caches (bulk partly git-ignored)
├── protocol/                 # frozen score versions (gqs-00) and pre-registrations
├── docs/                     # technical notes, export contract, before/after evidence, ADRs
├── audit-reports/, reports/  # audit and run reports
└── watchlist.json            # the universe ({_meta, stocks:[…], lastUniverseRefresh, …})
```

---

## Running locally

Prereqs: Node 22+, `npm ci`.

```bash
# 1. Refresh the universe (Wikipedia + SEC + NASDAQ + OTC; optional Finnhub via env)
FINNHUB_API_KEY=... node refresh-universe.js --watchlist watchlist.json

# 2. Pull fundamentals (multi-hour for the full ~24k universe in one process; CI splits it
#    into 17 shards with --shard i/17; use a trimmed watchlist for smoke tests)
node --max-old-space-size=6144 pull-yahoo.js \
  --watchlist watchlist.json --output snapshots --rate-limit 2000

# 3. Historical prices + FX + earnings calendar
node pull-historical-prices.js --out prices --rate-limit 1500
node scripts/refresh-fx.js
node pull-earnings-dates.js

# 4. Score + classify (current engine)
node src/scoring/run-screener.js
node scripts/write-findash-export.js

# 5. Post-run analytics
node scripts/walk-forward-perf.js  # legacy/orphaned — not wired into CI, manual ad-hoc backtest only, not live scoring
node scripts/write-board-history.js
```

The `daily-pull.yml` workflow is the canonical sequence — see it for the exact ordering, env vars, and continue-on-error semantics.

---

## Tests

Run the whole suite with the existing test runner (the same call as the PR check):

```bash
node scripts/test-gate.js --mode=all
```

The blocking track globs `tests/*test.js`, `tests/scoring/*test.js`, `lib/*test.js`, and
`tests/druckenmiller/*test.js` (`BLOCKING_GLOBS` in `scripts/test-gate.js` is the source of
truth; the daily run uses `--mode=blocking`). Every such file is a standalone runner
(`node <file>`, exit 0/1).

`tests/scoring/anchors.fixture.test.js` is the load-bearing test — its
fixture-hash assertion is the production guardrail against accidental scoring
drift.

---

## GitHub Actions configuration

| Secret               | Required | Purpose                                                         |
|----------------------|----------|-----------------------------------------------------------------|
| `FINNHUB_API_KEY`    | Optional | Augments universe discovery via Finnhub `/stock/symbol`         |
| `SEC_CONTACT`        | Yes      | Contact part of the SEC user agent (`lib/sec-user-agent.js`; SEC answers 403 without it) |
| `PII_GUARD_TERMS`    | Expected | Terms of the PII guard (`tests/kein-kontakt-im-repo.test.js`); the check skips loudly without it |
| `FONDS_GUARD_TERMS`  | Expected | Terms of the public-tree guard (`tests/kein-signal-im-oeffentlichen-baum.test.js`); same format |
| `HETZNER_API_TOKEN`  | Watchdog only | Server check in `findash-watchdog.yml`                     |

The only alarm channel is the **red X in GitHub Actions** (plus GitHub's own failure mail to the owner). The former Discord path was removed on 2026-07-29: its webhook was never set, so it was a no-op that looked like a second channel. `FINNHUB_API_KEY` absence narrows the discovered universe but does not fail the run.

**Repo permissions:** Settings → Actions → General → Workflow permissions → "Read and write permissions". Required for the bot commit + `gh-pages` deploy.

**GitHub Pages:** Settings → Pages → Source: "Deploy from branch" → `gh-pages` / `(root)`.

**Cron trigger model:** the workflow runs on `schedule` + `workflow_dispatch` only. **Pushes do not trigger it.** Local commits do not re-run the pipeline; manual dispatch from the Actions UI is the only ad-hoc trigger.

---

## Operational notes

- **Yahoo throttling.** `PULL_CONCURRENCY=8` + `--rate-limit 2000ms` per worker in each of the 17 pull shards. Run #107 (Tag 215f) hit 7 210 rate-limit failures at concurrency 20; do not raise concurrency without re-validating against Yahoo's CDN-edge throttle.
- **Coverage gate (two-stage, `scripts/coverage-gate.js`).** Below `max(2500, 13 % of n_total)` successful snapshots the run is catastrophic (exit 1, no deploy); below the full-pull target `max(4600, 18 %)` or with too many failures it is degraded (deploy plus warning marker `outputs/coverage-status.json`). Falls back to the `.json` file count if the manifest is missing or implausible.
- **Snapshot freshness gate.** ≥50 % of snapshots must have `asOf` or `fetchedAt` < 36 h old. Hard-fail on breach (Tag 218).
- **Date-rollover safety.** All snapshot scripts honour `RUN_DATE_UTC` (frozen at job start) over `Date.now()` so a pull crossing UTC midnight produces consistent vintages.
- **Atomic writes.** Output scripts use `tmp + rename` (Tag 218b hardening).
- **Merge pre-stage / quarantine register.** `scripts/filter-snapshot-merge.js` runs as step *„F-12 Karteileichen-Filter"* in the `merge` job and copies only authorized snapshots from `snapshots-eingang/` to `snapshots/`. Two ticker registers gate that copy: `data-health/nav-holdings.json` (NAV holdings / closed-end funds) and `data-health/quarantine.json` — the latter for rows whose numbers **provably belong to a different company** (ENTSCHIED 37, PR #105; first and so far only case: `VMRK`, carrying AvalonBay's complete block). The bar is deliberately high, because a wrong entry deletes a real company from the board: proof of foreign numbers, a second independent pull with the same result, plus `beleg` + `pruefungBis` — an entry needs all five fields `ticker, grund, beleg, aufgenommen, pruefungBis` or the register fails to load. **Nothing is deleted** (Karl decision F-12): the input folder keeps every file, it just never reaches scoring. Unlike the three rename pre-stages (U2 BO/NS root twins, U3 Milan, T179 par-value), this one *discards* — there the identity is uncertain and the sealed dedup decides, here it is proven wrong.
- **Where the quarantine surfaces.** The line `QUARANTAENE: <n> Zeilen — <tickers> [Register: <m> Eintraege]` is printed to the step log on **every** run, including `n = 0` — a register that only speaks when it fires cannot be told apart from one that failed to load. On top of that, three loud failure modes as GitHub annotations: a register entry with no matching file in the input (`::warning::`, the exclusion is silently ineffective — delisted/renamed/typo), an entry past its re-review date (`::warning::`, see next bullet), and a quarantined file still sitting in the target directory from an earlier local run (`::error::` + hard stop; CI never hits this since `snapshots/` is git-ignored, local runs can). An unparseable or malformed register aborts the step instead of scoring poisoned rows (fail-closed).
- **Quarantine re-review (`pruefungBis`).** Every quarantine entry carries a mandatory re-review date. Once `pruefungBis` is older than the run date, each run warns `QUARANTAENE: <ticker> ist seit <datum> zur Wiedervorlage faellig …` — deliberately **not** a hard stop: the row is still poisoned, so the overdue entry keeps protecting correctly; what is overdue is the human decision to renew or retire it. This is what keeps the register a stop-gap rather than a graveyard. Guard: `tests/quarantaene.test.js` (checks the non-effect as sharply as the effect, and pins that discarding never touches the three rename pre-stages).
- **Push race.** The commit step retries-with-rebase up to 3× against `main` (Tag 179, F-CI-001 v2). On a content conflict the rebase is aborted — which keeps the just-made commit — and the run goes **red** after 3 attempts: the first writer's data wins, nothing is overwritten. (Tag 544: the cherry-pick-back branch that used to sit here was dead code and could never fire.)

---

## Architecture decisions

`docs/decisions/ADR-001-retire-track-a-b-scoring.md` documents the consolidation of the legacy `engine-v7.3` Track-A / Track-B stack onto `methods/score-aggregator.js`, which was itself later replaced by `src/scoring/`. Status: Superseded/Implemented — all phases are done and neither stack exists in the tree any more; see the ADR's 2026-07-19 Status Update section.

---

## Tag history

Development is tagged sequentially: commit subjects read `Tag <n>: …`, and the number is fixed when the change is merged to `main` (Tag 1473 on 2026-10-21). This repository was re-created on 2026-10-13 with a fresh history; the earlier history is kept privately. Audits live in `audit-reports/`, before/after evidence for formula and data changes in `docs/*-vorher-nachher-*.md`.

---

## License

Proprietary (public repo, so no secrets or personal data in commits). No external contributors expected.
