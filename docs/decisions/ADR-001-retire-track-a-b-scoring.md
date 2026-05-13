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
