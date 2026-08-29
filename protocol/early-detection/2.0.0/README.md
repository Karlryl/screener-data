# FEM-SEC-US @ 2.0.0 (Early Detection)

Status: **PREREGISTERED / FROZEN 2026-08-19 / SUPERSEDES 1.2.0 SINCE 2026-08-16**.

**This file is descriptive only.** It is an index, not a rule source: it neither activates a
run, nor authorizes outcome access, nor states any obligation. Every binding statement lives in
the versioned records listed below, and only there. The parent index `../README.md` is
descriptive in exactly the same sense. Where this file and a record disagree, the record wins
and this file is wrong.

This directory is the current version of the separate **F**rueherkennungs-**E**videnz-**M**atrix
research layer. It is governed by the constitution of 2026-08-16 (17 rules, R1-R17) and carries
the signal family `FEM-SEC-US-BESCHLEUNIGUNG@2.0.0`. Productive integration is prohibited: it
does not change GQS-00, productive scoring, board routing, weights, rankings or exports. It
supersedes `FEM-SEC-US@1.2.0` under `SUPERSEDE_NO_DELETE` — the 1.2.0 directory is preserved
byte-for-byte as the audit parent and must not be executed.

## Key records

- `preregistration.json`: the frozen research question, signal family, outcomes, splits, tests
  and success criteria. Its `endpunktSperre` records that this signal family never receives a
  price, return or valuation endpoint again, not even as a secondary one.
- `supersede-record.json`: the 1.2.0 supersede (`decidedAt` 2026-08-16, `SUPERSEDE_NO_DELETE`),
  what was decommissioned, and the preserved evidence with its hashes. Its `validityRule` makes
  the shutdown effective only together with `provenance-closure.json` and `data-contract.json`.
- `rules.json`: the rules registry — window, buffer years, watcher classes, which watchers carry
  evidence.
- `hash-manifest.json`: binds exactly three files (this version's preregistration and the two
  counting scripts). Everything else in this directory, including this README, is deliberately
  outside that seal.
- `outcome-access-ledger.json`, `endtest-versiegelung.json`, `friedhof.json`: access journal,
  end-test seal, and the pattern graveyard.
- `register-single-appender-rule.json`: `BINDING` governance rule for who may append to a
  register.
- `d1-` … `d6-*-preregistration.json`: the frozen D-stage registrations, each `FROZEN_BEFORE_…`
  its own data access.
- `r2-a1-*`: the identity-bridge line — its preregistration, the blocker-1/2/3 corrections and
  closure records, and the v1.2.0 artifact closure that pins the implementation hash.
- `r2-d-*`, `r2-d1-*`: the attrition/back-calculation line with its threshold seal.
- `*-deviation-record.json`, `*-amendment-record.json`, `*-addendum.json`: append-only
  documentation of deviations. They document; they never rewrite a frozen record retroactively.

## Verification

```powershell
node --test tests/studie-e3-praereg.test.js
node scripts/test-gate.js --mode=all
```

The seal guard (`W1`) checks that the manifest binds exactly its three files and that each still
carries its sealed bytes. Confirmatory output stays prohibited until the gates named in the
records are green; descriptive inventories must be labelled `DESCRIPTIVE_ONLY` and can never be
presented as evidence that the matrix works.
