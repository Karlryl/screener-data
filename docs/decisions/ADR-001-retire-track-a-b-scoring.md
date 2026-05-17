# ADR-001 — Retire Track-A / Track-B Scoring in engine-v7.3.js

**Status:** Accepted (2026-05-13)
**Phase:** Tag 134 Phase 2 — Methodology Hygiene
**Author:** Karl + Claude

## Context

The codebase contains two parallel scoring stacks:

1. **`engine-v7.3.js`** — the original engine. Exports `scoreTrackA`, `scoreTrackB`, `computePenalties`, `computeExpectationsRisk`, `computeAktienfinderScore`. Uses BUCKETS taxonomy `A / B / INFLECTION / SPEC / OUT`.

2. **`methods/score-aggregator.js` + `methods/strategy-modes.js`** — the production scorer used by `snapshot-picks.js`, `generate-modes-report.js`, and the daily workflow. Uses Tier taxonomy `A / B / NEAR_MISS / REJECT`.

The deep audit (Opus 4.7, 2026-05-13) found that the `engine-v7.3` scoring functions are **not invoked by any production code path**. Only callers:

- `engine-cli-tests.js` (workflow pre-pull guard)
- `score-orchestrator.js` (called only by `diagnose-spec.js` and `engine-cli-tests.js`)
- `diagnose-spec.js` (dev-time diagnostic)

The two stacks have drifted: two BUCKETS taxonomies, two penalty systems, two sub-profile lookups. A scoring change in one stack does not propagate to the other. This is silent risk.

`computeAktienfinderScore` is doubly dead: it always returns `{ score: 0, applicable: false }` because `external.aktienfinderScore` is never populated by the Yahoo pull (a manual-bookmarklet flow that was never wired up at scale). The 20% weight pivot to non-AF distribution is therefore always taken; the AF branch is logically unreachable.

## Decision

**Retire Track-A / Track-B in engine-v7.3.js.** Specifically:

- Mark the following as **deprecated** in their docstring and add a console.warn at first invocation:
  - `scoreTrackA`, `scoreTrackB`
  - `computePenalties`, `computeExpectationsRisk`
  - `computeAktienfinderScore`
  - `bucketFor`, `passesTrackAUniverse`, `passesTrackBUniverse`, `isCrossProfile`
- **Keep** the following helpers — they are used by the production stack:
  - `classifySubProfile`, `classifySubProfileDetailed` — consumed by `methods/sector-medians-compute.js`
  - `computeRevenueAcceleration` — consumed by `quarterly-revenue-acceleration.js`
  - The `_helpers` internals
- `score-orchestrator.js` is marked deprecated in its module docstring. Tests that depend on it will be migrated to test `score-aggregator.computeScore` directly in Phase 3.
- `diagnose-spec.js` is left untouched as a dev tool; flagged for removal in Phase 5 cleanup.

**Methods registry (Tag 134 Phase 2.2):** `methods/index.js` now is an explicit allow-list of method files. `runner.js` loads from there instead of `fs.readdirSync`. A typo'd `id`, a load failure, or a duplicate `id` aborts the loader instead of silently skipping. This closes the structural defect A4.

**`methods/disabled/` directory removed.** Those files were never loaded by `runner.js` (which only scans the flat directory). They were dead code. The runtime-disable mechanism in `methods/method-types.js` (`DISABLED` set) remains the single source of truth for disabling methods without deleting code.

## Why not delete outright

`engine-cli-tests.js` is the workflow's pre-pull gate. If we delete the functions, the test fails and the entire pipeline (yahoo pull, modes-report, picks-history) stops. The migration is:

1. **Phase 2 (this ADR):** Mark deprecated. Tests still pass.
2. **Phase 3:** Migrate `engine-cli-tests.js` to test `score-aggregator` and `evaluateMode` directly. Then physically remove the Track-A/B exports.
3. **Phase 5:** Delete `score-orchestrator.js` and `diagnose-spec.js`.

## Consequences

- **Single scoring path** going forward. Method changes touch one stack, not two.
- **Audit trail** of methodology decisions in `docs/decisions/`.
- **Test debt** in Phase 3: rewrite the ~120 lines of engine-cli-tests.js Track-A/B coverage as score-aggregator coverage.

## Related defects closed

- A3 (dual scoring stacks)
- A4 (filesystem-scan loader)
- A5 (half-baked aktienfinder integration)

---

## Status Update 2026-05-17 (Tag 224a)

Per the Tag 222c documentation-accuracy audit (`audit-reports/2026-05-17-tag222c-documentation-audit.md` §4, findings A1 / A2 / A3): the ADR's factual claims about which functions are dead, which are kept, and why are **all still correct at HEAD**. Phase 2 (deprecation warnings) and the Tag 134 Phase 2.2 work (explicit `methods/index.js` allow-list + removal of `methods/disabled/`) are landed and verified — `engine-v7.3.js` emits the documented `[engine-v7.3 DEPRECATED] … is retired per ADR-001` warning at L928, `methods/disabled/` is gone, the registry is an allow-list, and `score-aggregator.js` is the production scorer (24 method files reference `SCORE_WEIGHTS` directly).

### Phases still pending

| Phase | Stated intent | Current state | Reason deferred |
|---|---|---|---|
| **Phase 3** | Migrate `engine-cli-tests.js` to test `score-aggregator` and `evaluateMode` directly. Then physically remove `scoreTrackA` / `scoreTrackB` exports from `engine-v7.3.js`. | `scoreTrackA` / `scoreTrackB` still exist at `engine-v7.3.js` L931+. `engine-cli-tests.js` still calls them as the workflow's pre-pull gate. The deprecation warning fires but the functions execute as before. | Rollback safety. The pre-pull gate is the workflow's only protection against shipping broken scoring code; rewriting it onto `score-aggregator` without losing the ~120 lines of Track-A/B coverage is a Phase 3 work item that has not been prioritised against shipping new methods. Estimated effort: ~half-day. |
| **Phase 5** | Delete `score-orchestrator.js` and `diagnose-spec.js`. | Both files are still present. Neither carries a deprecation marker in its module docstring — `score-orchestrator.js`'s header still self-describes as "Single source of truth für Score-Berechnung", **the exact opposite of what this ADR retired**. `diagnose-spec.js` is unmodified. | Same rationale as Phase 3 — these files have no production callers but are referenced by `engine-cli-tests.js`. Phase 5 is gated on Phase 3 completion. |

### Action items opened by this status update

1. **`score-orchestrator.js` docstring header** — must be updated to mark the file deprecated per this ADR's stated intent. The current header is actively misleading to anyone discovering the file.
2. **Phase 3 work** — schedule the `engine-cli-tests.js` migration. Until then the deprecation is partial: the warnings fire but the legacy stack remains executable and a real source of bugs (see Tag 220a A1 finding — manipulation-filters API drift was only caught because `engine-cli-tests.js` was actively exercising the legacy path).
3. **No new ADRs** were written for Tag 75 → Tag 222 work despite ~150 tags of methodology changes (Mauboussin intangible-ROIC, Beneish, Ohlson, capital-allocation composite, Tag 211 fixture-hash invariant, Tag 218/219 atomic-write hardening, Tag 213a/213b smart-money signals). The Tag 222c audit recommends ADR-002 (fixture-hash invariant), ADR-003 (universe-discovery architecture), ADR-004 (atomic-write hardening). None has been opened.

### Decision

Status remains **Accepted**. Phases 3 + 5 are explicitly **deferred**, not abandoned — they will be picked up either when a real bug forces touching the legacy stack again or when a dedicated cleanup wave is scheduled. This status update closes the documentation drift surfaced by Tag 222c finding A1 / A2 / A3.

