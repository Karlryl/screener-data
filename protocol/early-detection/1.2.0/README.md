# FEM-SEC-US @ 1.2.0 (Early Detection V4)

Status: **PREREGISTERED / SEALED / NOT READY TO EXECUTE**.

This directory defines the separate **F**rueherkennungs-**E**videnz-**M**atrix (FEM) research layer for discovering potential growth companies before visible growth and before GQS confirmation. It is not the sealed GES pilot. It does not change GQS-00, productive scoring, board routing, weights, rankings or exports. It also does not generate valuation, Elliott-wave interpretation, a technical buy signal or a price target.

## Binding artifacts

- `preregistration.json`: frozen hypotheses, clocks, events, comparisons, splits, success and failure rules.
- `fixtures.json`: outcome-free contract examples used by the audit.
- `readiness-and-blockers.md`: current data status and the exact gates that prevent premature result computation.
- `preseal-outcome-access-declaration.json`: immutable, sealed declaration that no confirmatory outcome was accessed before freeze, including the initial hash of the live ledger.
- `outcome-access-ledger.json`: append-only live access journal, initially empty and intentionally excluded from the immutable manifest so later access can be recorded before it happens.
- `outcome-access-checkpoint.json`: mutable checkpoint excluded from the manifest; before every outcome access, ledger and checkpoint must be committed and pushed to protected `origin/main`. Post-seal verification compares local state to that remote-tracking checkpoint even at zero events, preventing an undetected rollback to genesis without a prohibited remote history rewrite.
- `hash-manifest.json`: canonical hashes generated and verified by the audit script.
- `scripts/early-detection-confirmatory.py`: the complete frozen confirmatory runner. It derives growth events from as-filed quarter rows, first monthly transitions, deterministic controls from the complete eligible pool, the eight-filing outcome, split assignment, matched-set bootstraps, IRLS technical incrementality, H-LATE, the technical-only null test and H-FEM. Prepared `qualifies`, matched sets, readiness or pass/fail booleans are not accepted.
- `confirmatory-runtime-lock.json`: exact Python, NumPy, PCG64 and replicate-count lock used by that runner.
- `execution-gate-artifact-template.json`: one-gate attestation contract with full-input/component binding and remotely rehashed evidence.
- `execution-gate-evidence-template.json`: exact eleven-gate remote evidence contract; the sealed template remains RED and is copied only after real artifacts exist.
- `CONFIRMATORY_RUNBOOK.md`: the only permitted event/hash/checkpoint order before a locked outcome file may be read.

Version 1.2.0 supersedes the unsealed, review-rejected 1.1.0 draft before any confirmatory outcome access. It removes future outcomes from live candidate classification, fixes outcome availability and exact matching, excludes left-censored data-start panels from first/never claims, binds every run component and remote evidence byte, defines signal multiplicity and separates the sealed no-access declaration from the append-only access journal. A sealed version is immutable; further rule changes require a new semantic version and a new future test window.

`SOURCE_REGISTRY.csv` in the study bundle is a day-level bibliographic registry only. It is not signal-eligible. Historical T/E/L inputs must first be promoted into the append-only Point-in-Time research corpus with a mapped source class, exact timezone-qualified source and observation timestamps, payload hash and cutoff.

## Verification

```powershell
node tests/early-detection.test.js
node scripts/early-detection-audit.js --verify
```

The seal runs the complete deterministic local repository suite sequentially before writing a manifest. The reviewed seal preflight contains 165 test files and 207 passing tests, including 27 confirmatory-runner self-checks. The manifest includes the complete confirmatory runner, runtime lock and outcome-free negative tests. Before reading a confirmatory input file, the runner independently invokes the audit to verify the local manifest, fetched `origin/main` checkpoint and monotone outcome-access history. `confirmatoryAnalysisImplementationSealed` is then derived internally; a local file or caller-supplied Boolean is insufficient. Live discovery smokes under `tests/discovery/` call external registers and are reported as a separate non-sealing environment gate, because a remote 429/5xx is not evidence of a repository defect. The audit remains fail-closed for every local contract. Confirmatory output remains prohibited until all eleven remaining Point-in-Time, corpus, blindness and input-audit gates are green. Descriptive inventories must be labelled `DESCRIPTIVE_ONLY` and cannot be presented as evidence that the matrix works.
