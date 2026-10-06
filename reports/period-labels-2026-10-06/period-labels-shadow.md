# Verified reporting-period labels: offline shadow, 2026-10-06

Implementation status: label fix and focused checks pass; the required seven-file command is not green because its unchanged quarterly-reader inventory does not classify the new `scripts/period-labels-check.js`. The inventory/test is outside the allowed edit list and has not been changed or bypassed. No commit, push, network access, export regeneration or findash access was performed.

## Change and contract

The optional `periodLabels` array is separate from schemaVersion 1 `cases`, `quarantines` and `coverage`. Each entry has `caseId`, `ticker`, optional `listingAliases`, `field: revenueQ`, `periodType: 3M`, `period` (vendor day), `reportedPeriodEnd`, `currency`, `verifiedValue`, a German `reason`, and sourced evidence. Calendar validity, the inclusive seven-day bound, unique authority, source/value traceability and conflicting value cases are checked. This is label authority only, never value-correction or coverage authority. The existing unchanged-value early return remains untouched.

`applyFinancialCases` annotates `timeseries.reportedRevenueQEnds` only when listing, currency, unit, period and exact current value match; dates remain aligned, unmatched slots are null, duplicate dates are not annotated, and drifted annotations are removed. `revGrowthLeg` first selects the same computational pair and computes the same percentage as before, then selects verified labels; its `sourcePeriodEnd`/`sourcePriorPeriodEnd` retain vendor dates. Annual source ends equal annual labels. The export adds `revGrowthSourcePeriodEnd`/`revGrowthSourcePriorPeriodEnd` through the existing agreement check for all three row mappers, including null/none cases. Old exports without the optional pair still validate. No existing field was renamed.

Computational `revenueQEnds`, `revenueQ`, `jahresVergleichIdx`, growth calculations, stale-quarter vendor-age logic, TTM/seasonality, Q4 hand table, SEC/Yahoo merge, scoring and workflows are unchanged. The P55 repro changes only repository-root resolution; all its assertions remain intact.

## Exact new authority

All amounts are USD. The current eight P55 entries retain original filing URLs and search quotes. Eight additional historical entries use exact copied SEC facts; their source `page` explicitly says these are JSON facts, not reopened filing-page quotations. The SEC filing-index URLs are constructed from the fixture's CIK/accession identifiers and were not opened. Full verbatim fact excerpts and their original cache hashes/provenance are available in the permitted evidence/fixture files. No filing-page quotation was invented. The strictest reading of a requirement for a newly verified original-page quotation on every historical entry remains a provenance limitation of the supplied material.

| Ticker | Vendor period | Reported end | Verified value | Source |
|---|---|---|---:|---|
| ADI | 2026-07-31 | 2026-08-01 | 4021899000 | https://investor.analog.com/static-files/4c652382-cb7c-4418-a71f-45af25c7584b |
| ADI | 2025-07-31 | 2025-08-02 | 2880348000 | https://investor.analog.com/static-files/4c652382-cb7c-4418-a71f-45af25c7584b |
| CRDO | 2026-07-31 | 2026-08-01 | 479003000 | https://www.sec.gov/Archives/edgar/data/1807794/000162828026060111/crdo-20260801.htm |
| CRDO | 2026-04-30 | 2026-05-02 | 437003000 | https://www.sec.gov/Archives/edgar/data/1807794/000162828026043303/0001628280-26-043303-index.html ; https://www.sec.gov/Archives/edgar/data/1807794/000162828026014017/0001628280-26-014017-index.html |
| CRDO | 2026-01-31 | 2026-01-31 | 407012000 | https://www.sec.gov/Archives/edgar/data/1807794/000162828026014017/0001628280-26-014017-index.html |
| CRDO | 2025-10-31 | 2025-11-01 | 268027000 | https://www.sec.gov/Archives/edgar/data/1807794/000162828025054549/0001628280-25-054549-index.html |
| CRDO | 2025-07-31 | 2025-08-02 | 223074000 | https://www.sec.gov/Archives/edgar/data/1807794/000162828026060111/crdo-20260801.htm |
| CRDO | 2025-04-30 | 2025-05-03 | 170025000 | https://www.sec.gov/Archives/edgar/data/1807794/000162828025033813/0001628280-25-033813-index.html ; https://www.sec.gov/Archives/edgar/data/1807794/000162828025011738/0001628280-25-011738-index.html |
| KLIC | 2026-06-30 | 2026-07-04 | 330409000 | https://www.sec.gov/Archives/edgar/data/56978/000005697826000032/klic-20260704.htm |
| KLIC | 2026-03-31 | 2026-04-04 | 242621000 | https://www.sec.gov/Archives/edgar/data/56978/000005697826000020/0000056978-26-000020-index.html |
| KLIC | 2025-12-31 | 2026-01-03 | 199625000 | https://www.sec.gov/Archives/edgar/data/56978/000005697826000012/0000056978-26-000012-index.html |
| KLIC | 2025-09-30 | 2025-10-04 | 177558000 | https://www.sec.gov/Archives/edgar/data/56978/000005697825000081/0000056978-25-000081-index.html ; https://www.sec.gov/Archives/edgar/data/56978/000005697825000071/0000056978-25-000071-index.html |
| KLIC | 2025-06-30 | 2025-06-28 | 148413000 | https://www.sec.gov/Archives/edgar/data/56978/000005697826000032/klic-20260704.htm |
| KLIC | 2025-03-31 | 2025-03-29 | 161986000 | https://www.sec.gov/Archives/edgar/data/56978/000005697826000020/0000056978-26-000020-index.html |
| SKYT | 2026-03-31 | 2026-03-29 | 160686000 | https://www.sec.gov/Archives/edgar/data/1819974/000181997426000014/skyt-20260329.htm |
| SKYT | 2025-03-31 | 2025-03-30 | 61296000 | https://www.sec.gov/Archives/edgar/data/1819974/000181997426000014/skyt-20260329.htm |

The three Q4 proofs are individual exact differences: CRDO 2026-05-02 = 1,335,116,000 minus 898,113,000; CRDO 2025-05-03 = 436,775,000 minus 266,750,000; KLIC 2025-10-04 = 654,081,000 minus 476,523,000. Each pair shares a start date. This does not introduce a Q4 computation or change any stored revenue.

## Verification

Before editing, the P55 assertions were executed using a memory-only repository-root correction (the supplied root pointed outside this lane). Exit 1: `AssertionError [ERR_ASSERTION]: CRDO ignores reportedRevenueQEnds`, actual `2026-04-30`, expected `2026-05-02`. After the change, both `node tests/fixtures/period-labels/p55-repro.cjs --require-reported-end` and the command without the switch exit 0.

Pre-change legacy hashes are pinned by runnable tests; the revision is unchanged:

- 212 cases: `7da9c61f93bbeff5cfdf2b6d6485a630f16ee1bdacd3dc9afb69241a5ef1a503`.
- 11 quarantines: `04d5d37834c47fb1d95e468102a07c3b4a42b3fcf91a0f892754685443ef5b89`.
- 34 coverage rows: `5aec87031a1f8531b556329f38852ea6fa01c33370cde601c9267595610cf490`.
- All 42 original fixture outputs, including audit events and reader-facing reasons: `52d547a4beeeb24c30daf9cbf15b250fdf83af2263e1bd3168afb0e6700aef3a`, equal before/after.

`node --test tests/rev-growth-basis.test.js tests/financial-known-cases.test.js tests/period-labels-verified-ends.test.js tests/stale-quarter-reload.test.js tests/scoring/rev-growth-anzeige.test.js tests/scoring/findash-export-gate.test.js` exits 0. Last summary:

```text
✔ tests\stale-quarter-reload.test.js (461.4479ms)
ℹ tests 12
ℹ suites 0
ℹ pass 12
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2326.002

```

Inside the existing custom harnesses: financial-known-cases 246 passed, 266 break-once canaries; stale-quarter reload 14 passed, 0 failed. Existing live-universe checks visibly skip four assertions because no snapshots are present; existing rev-growth real-export recomputation also skips without live snapshots. No new skip or weakened assertion was introduced. Frozen-export validation is exercised separately below against real saved output, not absent engine outputs.

The additional required `tests/yahoo-q4-known-cases.test.js` fails with `AssertionError [ERR_ASSERTION]: Every quarterly reader/import must be classified`; actual contains `scripts/period-labels-check.js`, the expected inventory does not. This is caused by adding the requested offline reader, not by an environment calibration failure. The test and its inventory were not edited, and the reader was not hidden from discovery. The full test-gate/CI remains the Diener's responsibility as specified in the brief.

### Deliberate red proof

The same authority assertion that passes genuine metadata was run against a cloned PLTR leg with only `periodEnd` changed to `2026-04-01`. This command targets memory only:

```sh
node -e "const {fixtureSnapshot,assertLabelAuthority}=require('./scripts/period-labels-check.js');const {revGrowthLeg}=require('./lib/rev-growth-basis.js');const f=require('./tests/fixtures/period-labels/period-fixtures.json');const s=fixtureSnapshot(f.cases.find(c=>c.ticker==='PLTR'));const broken={...revGrowthLeg(s),periodEnd:'2026-04-01'};assertLabelAuthority(s,broken);"
```

Exit 1, expected:

```text
node:assert:152
  throw new AssertionError(obj);
  ^

AssertionError [ERR_ASSERTION]: PLTR: periodEnd changed without matching hand-table entry
+ actual - expected

+ '2026-04-01'
- undefined

    at assertLabelAuthority (C:\Users\Anwender\.codex\worktrees\sd-p68\scripts\period-labels-check.js:42:12)
```

The permanent test also proves the valid/invalid directions and compares live code/table SHA256 before and after the memory mutation. No writing test or output file is a mutation target.

### Offline check script

`node scripts/period-labels-check.js` exits 0. It verifies all 29 frozen hashes and the pinned index hash before reading the generation, validates the original with `validateExport`, validates all 29 in-memory after-tree files with `validateFile`, checks every non-label field byte-for-byte, and verifies all source-file hashes again. No file in `outputs/` is changed.

```text
Fixture | pct before | pct after | label before -> after | source end
CRDO | 157.02279076606382 | 157.02279076606382 | 2026-04-30 -> 2026-05-02 | 2026-04-30
KLIC | 49.778993246329925 | 49.778993246329925 | 2026-03-31 -> 2026-04-04 | 2026-03-31
MSFT | 17.74702057796209 | 17.74702057796209 | 2026-06-30 -> 2026-06-30 | 2026-06-30
PLTR | 84.71163256416494 | 84.71163256416494 | 2026-03-31 -> 2026-03-31 | 2026-03-31
Frozen: 29 SHA256 checks OK; index 2b785612ce8ffafcfe64d06a7bad51885785abfbac260642700e49a3dcdebe3b
Frozen file | ticker | pct (unchanged) | exported pair -> proposed label pair
full/semiconductors.json | CRDO | 114.72829643974647 | 2026-07-31/2025-07-31 -> 2026-08-01/2025-08-02
full/semiconductors.json | ADI | 39.63239858517096 | 2026-07-31/2025-07-31 -> 2026-08-01/2025-08-02
full/semiconductors.json | KLIC | 122.6280716648811 | 2026-06-30/2025-06-30 -> 2026-07-04/2025-06-28
full/semiconductors.json | SKYT | 162.14761158966326 | 2026-03-31/2025-03-31 -> 2026-03-29/2025-03-30
full/software-comm-services.json | META | 27.959003283104632 | 2026-06-30/2025-06-30 -> 2026-06-30/2025-06-30
full/software-comm-services.json | MSFT | 17.74702057796209 | 2026-06-30/2025-06-30 -> 2026-06-30/2025-06-30
semiconductors.json | CRDO | 114.72829643974647 | 2026-07-31/2025-07-31 -> 2026-08-01/2025-08-02
semiconductors.json | ADI | 39.63239858517096 | 2026-07-31/2025-07-31 -> 2026-08-01/2025-08-02
semiconductors.json | KLIC | 122.6280716648811 | 2026-06-30/2025-06-30 -> 2026-07-04/2025-06-28
semiconductors.json | SKYT | 162.14761158966326 | 2026-03-31/2025-03-31 -> 2026-03-29/2025-03-30
software-comm-services.json | META | 27.959003283104632 | 2026-06-30/2025-06-30 -> 2026-06-30/2025-06-30
software-comm-services.json | MSFT | 17.74702057796209 | 2026-06-30/2025-06-30 -> 2026-06-30/2025-06-30
Frozen after-tree: 11923 rows with additive source fields; 0 validation errors; 29 file hashes unchanged.
revGrowthYoYPct untouched by construction: this label/export change writes no value field.
ADI: only 2026-07-31 and 2025-07-31 verified. SKYT: only 2026-03-31 and 2025-03-31 verified. All other periods keep vendor labels.
```

## Not covered and next package

ADI metadata exists only for vendor 2026-07-31 -> reported 2026-08-01 (4,021,899,000) and vendor 2025-07-31 -> reported 2025-08-02 (2,880,348,000). SKYT metadata exists only for vendor 2026-03-31 -> reported 2026-03-29 (160,686,000) and vendor 2025-03-31 -> reported 2025-03-30 (61,296,000). Every other ADI/SKYT quarter keeps its vendor label: there are no older ADI/SKYT cache rows or exact revenue/date pairs in the supplied fixture. Their specific other period dates are unknown here and were not guessed.

Original Yahoo raw responses are missing. Historical SEC fact excerpts are source-backed offline fixture evidence, with the original-page quote limitation stated above. The findash warning-matching consumer change is a separate package; no findash path was accessed. The new source fields supply its computational warning keys.

Before acceptance, Claude/Diener must classify the new offline quarterly reader in the existing inventory and rerun the unchanged seven-file command and CI. This lane has no authorization to edit that inventory or its test. No merge/deploy approval is claimed.

## Final independent review and required-command result

The independent blind reviewer (GPT-6 Astra, ultra) reproduced one source-validation defect: an impossible optional source start or a reversed source interval could pass when the revenue/end fingerprint matched. The builder reproduced it before repair. Optional numeric/date source attributes now validate strictly, and five negative cases were added without changing existing tests. The reviewer reran the original reproductions plus a nonfinite-value case: all reject, while all 16 genuine entries still validate and annotate. No concrete code findings remain (reviewer's confidence 98%). This review does not waive the inventory gate.

The exact seven-file TEST-BEFEHL was rerun on the final code. Exit 1; only the untouched reader-inventory test fails. Its missing entry is `scripts/period-labels-check.js`.

```text
financial-known-cases: 246 passed; 266 break-once canaries fired; live hashes unchanged
14 passed, 0 failed
AssertionError [ERR_ASSERTION]: Every quarterly reader/import must be classified
✖ tests\yahoo-q4-known-cases.test.js (2093.0341ms)
ℹ tests 13
ℹ suites 0
ℹ pass 12
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6014.7537
✖ failing tests:
✖ tests\yahoo-q4-known-cases.test.js (2093.0341ms)
```

Final `node scripts/period-labels-check.js` and P55 `--require-reported-end` both exit 0. The script output above is unchanged. `git diff --check` passes; status contains only the 14 allowed paths, including the supplied, untouched, untracked `filing-comparisons.json`.

## Brief feedback

The brief omitted the quarterly-reader inventory from its allowed files and did not supply original filing-page quotes for historical fixture quarters. The explicit separation of label dates from computational dates, fixed original fixture data and hashed published generation made the required invariants directly testable.
