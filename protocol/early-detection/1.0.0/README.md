# FEM-SEC-US @ 1.0.0 (Early Detection V4)

Status: **PREREGISTERED / NOT READY TO EXECUTE**.

This directory defines the separate **F**rueherkennungs-**E**videnz-**M**atrix (FEM) research layer for discovering potential growth companies before visible growth and before GQS confirmation. It is not the sealed GES pilot. It does not change GQS-00, productive scoring, board routing, weights, rankings or exports. It also does not generate valuation, Elliott-wave interpretation, a technical buy signal or a price target.

## Binding artifacts

- `preregistration.json`: frozen hypotheses, clocks, events, comparisons, splits, success and failure rules.
- `fixtures.json`: outcome-free contract examples used by the audit.
- `readiness-and-blockers.md`: current data status and the exact gates that prevent premature result computation.
- `hash-manifest.json`: canonical hashes generated and verified by the audit script.

## Verification

```powershell
node tests/early-detection.test.js
node scripts/early-detection-audit.js --verify
```

The audit is fail-closed. Confirmatory output remains prohibited until every Point-in-Time gate is green. Descriptive inventories must be labelled `DESCRIPTIVE_ONLY` and cannot be presented as evidence that the matrix works.
