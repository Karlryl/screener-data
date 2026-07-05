<!-- Generated 2026-06-20 by screener-strategy-rebuild-vs-harden workflow (run wf_7ea6aef1-dc3): 13 agents (6 map + 3 design + 3 court + judge). -->

# Screener-Strategie: Härten vs. Neu bauen — Urteil

**Empfehlung:** hybrid-strangler

**Headline:** Strangle the edges, keep the core, fix the broken eval oracle FIRST.

## Erstes Projekt
Un-break the evaluation oracle. In one change: make the eval fail LOUD (exit 1 on missing/empty inputs, remove continue-on-error), DELETE the median(pass)-median(fail) metric, and wire fitness/ rank-IC read-only over the full evaluatedTickers universe. It is first because it converts the project from flying-blind-on-a-confidently-wrong-instrument to honestly-instrumented. Verified live: method-effectiveness.json certifies evidenceGate ok on a physically-impossible +81% median 28-day return (medianReturnFail collapsed to 0 by survivorship drop) on a modal 6 vintages, and both eval scripts silently process.exit(0) on failure. Every downstream improvement that claims to maximize the screener (re-derived weights, factor pruning, the closed loop) would be calibrated against this garbage and would actively DEGRADE the calibrated core. Unlike the legacy-engine deletion or the scored-universe cache, this is pure correctness with no migration surface and is value-positive the instant it lands. Make the instrument honest before you read it.

## Audit-Harness (pipeline-audit v2) — Urteil
YES, keep building pipeline-audit v2, re-scoped as a recurring correctness-and-completion harness, not a one-time bug sweep, slotted as connective tissue across Phase 0 and every phase boundary. It earns its place because this codebase's defining failure mode is silent: the +81%-return ok-gated eval, the 5-week-stale empty artifact, the exit(0)-on-catch, the 28 continue-on-error steps, and the half-finished ADR-001 all went undetected for weeks-to-months. Its job: (1) eval-sanity assertions (no ok gate when nVintages below MIN or horizon unmatured; plausibility bounds on median returns; fail on stale/empty artifacts); (2) the migration-completion gate the fixture hash structurally cannot provide (fail the build if old and new impls of a strangled seam coexist past a deadline, closing the gap that let ADR-001 stall); (3) the existing determinism gates folded in. Run in CI per-commit and daily post-pull. It must NOT become another open-ended audit loop nobody actions; scope it to assertions that BLOCK, so it enforces the strangler's discipline rather than being a parallel research project.

## Vollständige Workstream-Karte

| In Empfehlung | Workstream | Begründung |
|:--:|---|---|
| ✅ | Eval-oracle correctness | Verified: method-effectiveness.json certifies ok on a +81% median 28d return with medianReturnFail 0 survivorship artifact, modal n=6; eval scripts exit(0) on catch; 28 continue-on-error steps. Most dangerous defect; fix first. |
| ✅ | Legacy-engine excision (finish ADR-001) | engine-v7.3 read-time FX layer contradicts write-time USD normalization (Tag-219c landmine), still live via _helpers.js line 75. Only coupling is one lazy classifySubProfile require. Collapses to one scorer/one FX truth. |
| ✅ | Single scored-universe artifact | ~9 stages each reload 4683 snapshots and re-run ~83 methods; scores never persisted. One score-universe.js is highest-leverage compute change, purely additive. |
| ✅ | Snapshot domain model (lib/snapshot.js) | Field access re-implemented in 3-4 places; no single definition of a snapshot. One typed accessor owning the USD invariant kills field-drift/FX bugs at source. |
| ✅ | Orchestration driver (Node DAG) | Pipeline exists only as 711-line YAML step-order; data-safety loop and gates live in untestable shell. In-code DAG makes architecture executable. |
| ✅ | One shared classification module | classifyTabs and SM.evaluateMode are two non-identical pick definitions over the same scores. Collapse to one parameterized module in the artifact. |
| ✅ | Promote fitness/ to production eval + baseline-diff gate | fitness/ has correct rank-IC, survivorship variants, coverage gates, but runs on 8/44 baselines wired into nothing. Promote to full universe, replace median-diff metric, add ~200-LOC gate rejecting weight changes not beating baseline at a matured horizon. |
| ✅ | Closed effectiveness-weights loop | SCORE_WEIGHTS are hand-tuned LLM literals; measured edge feeds nothing back. THE ceiling-definer. Built but hard-gated on matured vintages; never run against the broken oracle. |
| ✅ | SEC-XBRL merge into snapshots | Verified pulled monthly but consumed by zero methods. Merging unblocks Beneish/Ohlson/Penman-Nissim/Magic-Formula and adds an independent cross-check vs single-source Yahoo. |
| ✅ | Ingestion scale-out (CI matrix-sharding) | Single 240-min job already failed at the ceiling; coverage gate relaxed 40 to 13 percent to certify a ~20% pull. Sharding by ticker-range is the only lever; re-wrapping not rewrite. |
| ✅ | Frontend extraction + payload slice | Whole SPA is a 2748-line template string in a god-file. Extract to linted source + esbuild behind the existing data contract; apply Tag-220b slice for the 5.3MB payload. Keep zero-dep. |
| ✅ | Hygiene + git-bloat | Delete 50MB stray HTML, temp files, empty dirs; gitignore the 483MB methods-history. Zero behavior risk, immediate win. |
| ✅ | atomic-write adoption completion | 19 raw fs.writeFileSync sites risk silent state-loss on Windows/OneDrive. Finite hardening task. |
| ⬜ | Independent FX source (ECB/openexchangerates) | FX comes from the same Yahoo it normalizes; FX_FALLBACK is a stale 2024 table. Named for completeness; later hardening, residual single-vendor risk. |
| ✅ | CALENDAR: accumulate matured vintages | The true binding constraint, not a code workstream. 84d matured 0/29 vintages; only 7d noise alpha non-null. Recommendation's only contribution is keeping the cron running. |
| ⬜ | Factor-validity contingency | If alpha stays null after 6+ matured months under the fixed loop, the keep-core premise collapses and the factors are the problem. The decisive long-horizon tell; not buildable now. |

## Roadmap

### Phase 0: Safety rail + hygiene (days)
Lock 3 gates + fixture hash into a CI block-on-drift check; snapshot golden HTML; add CI completion gate (fail if old and new impl of a seam coexist past deadline). Delete stray junk; gitignore methods-history. Zero behavior change.

_depends on: none_

### Phase 1: Surgical subset - un-break eval + delete legacy engine + scored-universe (2-4 wks)
Net-positive even on abandonment. Fix eval failure-swallowing (exit 1, drop continue-on-error); delete median-diff; wire fitness/ read-only full-universe. Extract classifySubProfile to lib/ with golden tests, migrate tests off scoreTrackA/B, delete engine-v7.3 + score-orchestrator (finish ADR-001). Build score-universe.js; repoint ~9 consumers. Hash-gated.

_depends on: Phase 0_

### Phase 2: Snapshot domain model (1-2 wks)
Build lib/snapshot.js typed envelope + single FX accessor (lift _convertSnapshotToUSD); migrate readers/methods in small hash-gated batches.

_depends on: Phase 1_

### Phase 3: One classifier + orchestration driver (3-4 wks)
Unify classification into one module in the artifact. Build pipeline/run.js Node DAG; move gates/data-safety loop into testable code. Shadow-run vs YAML, diff, then cut over.

_depends on: Phase 2_

### Phase 4: Data activation + ingestion scale-out (2-3 wks)
Merge SEC-XBRL via lib/snapshot.js to activate dormant methods + 2nd source. Matrix-shard pull-yahoo; raise coverage gate off 13% as throughput recovers.

_depends on: Phase 3_

### Phase 5: Frontend strangle (2-3 wks)
Extract CLIENT_JS/CSS to linted source + esbuild behind window.SCREENER_DATA; apply slice/lazy-fetch; add why-this-pick contribution breakdown. Zero-dep preserved.

_depends on: Phase 1_

### Phase 6: Close the loop (code now; firing blocked on calendar)
Build effectiveness-to-weights review loop behind n>=30 + matured-84d gate wired to an explicit fixture-hash bless that cannot fire unless rank-IC beats baseline at a matured horizon. Re-derive one factor at a time once vintages mature (~Q4 2026).

_depends on: Phase 4_

## Strategisches Memo

Verdict: HYBRID-STRANGLER, with a forced re-sequencing. Keep the proven core wholesale, rebuild the spine as clean modules behind the five seams that already exist, delete the rot incrementally with the fixture hash as the safety rail, and never stop the daily cron. But invert the published phase order: fix the broken evaluation oracle and delete the parasitic legacy engine FIRST, because the strategy's headline value rests on a measurement substrate I verified to be not merely immature but actively, confidently wrong.

1. Why strangler, not the others. All six lenses describe a barbell: a coherent, expensive-to-replace CORE (103 cited methods / 16,360 LOC, three green gates, a frozen fixture hash fd4a13856b18fc7b, months of un-backfillable daily vintages) flanked by edge-localized rot (711-line YAML-as-orchestrator, a deprecated-but-live engine-v7.3.js, a 4,417-LOC god-file frontend, ~9x re-scoring, two divergent pick-definitions, an open effectiveness-to-weights loop). Ground-up rebuild is the wrong default: it discards the only real asset (calibrated methods plus irreplaceable data) to fix surgical problems and freezes the cron during the exact window the corpus needs to mature; five of six lenses call a full rebuild a poor trade. Pure harden under-reaches: it leaves the spine capped (orchestration in YAML, scores never persisted, eval loop open) which are the ceiling-definers. Strangler dominates both: preserve the core behind interfaces, rebuild the spine, delete legacy only after its replacement is green and hash-verified. The repo suits it: a single runner.evaluateStock chokepoint, a clean window.SCREENER_DATA frontend contract, fitness/ ~30% built on correct rank-IC math.

2. What I verified live in screener-data. The eval oracle is confidently wrong: outputs/method-effectiveness.json (asOf 2026-06-20) certifies evidenceGate ok on medianReturnPass 0.81 (a +81% median 28-day return) with medianReturnFail 0 (survivorship drop). Modal 6 vintages; 16 of 86 show the zero-fail artifact; 84d matured for 0 of 86. Failures are swallowed: process.exit(0) on catch in both eval scripts; 28 continue-on-error steps in daily-pull.yml. The legacy engine is severable: the only hot-path coupling is methods/_helpers.js line 75 (lazy classifySubProfile), plus two methods and two test files. fitness/ is wired into NO workflow. Coverage gate relaxed to 13 percent; n_ok 4,739 of 23,748 is about 20 percent. SEC-XBRL consumed by zero methods. Decisive point: the mechanism that would maximize the screener is dead-on-arrival today and would degrade the core if run against the current oracle.

3. The honest counter-case. Execution-discipline collapse in a solo repo. ADR-001 Phase 3/5 was designed and never executed. The strangler's atomic move (build, migrate, DELETE) is exactly what the operator hasn't finished, and every phase passes through a strictly-worse two-implementation state the fixture hash cannot detect (it guards determinism, not completion). The roadmap answers this: front-load the abandon-safe surgical subset as Phase 1; add a CI completion gate that fails the build if old and new impls of a seam coexist past a deadline; gate the deeper rebuild on demonstrated follow-through. If confidence is low, do only the surgical subset (about 80 percent of near-term value).

4. Are these really ALL the things? Effectively yes (see the workstream map). The under-weighted truths I surface: CALENDAR is the true binding constraint (no plan proves a better screener before about Q4 2026), and the factor-validity contingency (if alpha stays null after maturity, the factors are the problem, not the edges). Smaller residuals: an independent FX source, and completing atomic-write adoption.

5. Roadmap. Phase 0 (safety rail + hygiene) then Phase 1 (un-break eval + delete legacy engine + scored-universe) then Phase 2 (snapshot domain model) then Phase 3 (one classifier + orchestration driver, shadow-run before cutover) then Phase 4 (SEC-XBRL + sharding) then Phase 5 (frontend) then Phase 6 (close the loop in code; firing blocked on matured vintages). Phases 1 and 5 can parallelize.

6. First project. Un-break the evaluation oracle (fail loud, delete the median-diff metric, wire fitness/ rank-IC read-only over the full universe). First because every downstream improvement would otherwise be calibrated against a +81%-return garbage signal and would actively degrade the calibrated core. Zero migration surface; value-positive instantly.

7. Pipeline-audit v2 harness. Build it, re-scoped as a recurring correctness-and-completion harness: eval-sanity assertions, the migration-completion gate the hash cannot provide, and the existing determinism gates folded in. Run per-commit and daily. It must BLOCK, not just report.

Bottom line: The screener is at 20 percent of potential for two reasons that point the same way: the spine was never written as executable architecture, and the one loop that could raise the ceiling runs on a broken instrument over an immature corpus. Strangle the edges to fix the first; fix the oracle and let the cron run to fix the second. Commit to the abandon-safe surgical subset now; gate the rest on follow-through and on the calendar no engineering can buy.
