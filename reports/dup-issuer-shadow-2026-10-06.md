# Duplicate-issuer shadow export, 2026-10-06

The export now reports listed secondary tickers through the optional `dupIssuer`
field. A sourced hand table records exactly nine issuers, 19 tickers and ten
secondary tickers, including the currently absent GE.VI. No rank, score, name,
exclusion, board membership or short-list membership is changed.

## Implementation and scope

- `configs/dup-issuer-shadow-table.json` preserves the supplied R11 sources,
  verbatim quotes, source check date 2026-09-30 and entry date 2026-10-06.
  Sources were not reopened; this task has no network access.
- The loader rejects malformed records. `secondaryIndex` and
  `applyDupIssuerShadow` add only
  `{of, issuer, basis: "hand-table:dup-issuer-shadow"}` to listed secondaries.
  Kept and unlisted tickers receive no key, not null or false.
- All three real export mappers call the applicator through one shared step.
  The table loads once for the production build and also covers direct mapper
  callers. Missing or malformed tables throw instead of silently losing flags.
- `codeKeeps` records R11's production-rule re-enactment; it does not select the
  true primary listing. `homeListingProposal` is information only, null for
  unresolved cases, and has no effect on the exported marker.
- The identity register, issuer aliases and production deduplication are unchanged.
  M16 applies verbatim: "Erkennung und Meldung sind erlaubt; jede
  Verschmelzungs-Entscheidung auf Basis dieser Erkennung bleibt bis zu einem
  eigenen Gericht gesperrt."
- The Markdown contract documents all three row types. The shared JSON contract
  is unchanged: its required-field lists already permit additive optional keys.

## Frozen-generation comparison

Generation: `2026-10-03T09:31:17.258Z`.

`index.json` SHA256:
`2b785612ce8ffafcfe64d06a7bad51885785abfbac260642700e49a3dcdebe3b`.

Measurement unit: exported row occurrences, not unique tickers or issuers.
All 29 JSON files and their manifest are checked before processing; original
hashes are checked again after writing the copies to a fresh temporary directory.
Only the pure marker applicator runs over these rows; the export mappers do not
recompute the frozen generation. Every written after file is read back and deep
compared against its original after removing only the added `dupIssuer` key.

`node scripts/dup-issuer-shadow-diff.js` exited 0:

```text
Files compared: 29; rows compared: 11923; rows changed: 11; other differences: 0
Changed rows by feed: {"full":9,"shortLists":2,"overview":0,"survival":0}
Only added key: dupIssuer; no rank, score, name or membership changed.
```

Exact flagged-row list copied from the command output:

```jsonl
{"file":"full/financials.json","track":"profitable","ticker":"1GLXY.MI","rank":70,"dupIssuer.of":"GLXY"}
{"file":"full/health-care.json","track":"unprofitable","ticker":"6855.HK","rank":275,"dupIssuer.of":"AAPG"}
{"file":"full/industrials.json","track":"profitable","ticker":"GCP.DE","rank":246,"dupIssuer.of":"GE"}
{"file":"full/industrials.json","track":"profitable","ticker":"AERO.MX","rank":1478,"dupIssuer.of":"AERO"}
{"file":"full/industrials.json","track":"unprofitable","ticker":"AVAV.SW","rank":41,"dupIssuer.of":"AVAV"}
{"file":"full/materials.json","track":"profitable","ticker":"AMRZ.SW","rank":425,"dupIssuer.of":"AMRZ"}
{"file":"full/materials.json","track":"profitable","ticker":"KCO.DE","rank":927,"dupIssuer.of":"KCO.VI"}
{"file":"full/utilities.json","track":"profitable","ticker":"CPLE3.SA","rank":59,"dupIssuer.of":"ELPC"}
{"file":"full/utilities.json","track":"profitable","ticker":"AXIA3.SA","rank":109,"dupIssuer.of":"AXIA"}
{"file":"industrials.json","track":"unprofitable","ticker":"AVAV.SW","rank":41,"dupIssuer.of":"AVAV"}
{"file":"utilities.json","track":"profitable","ticker":"CPLE3.SA","rank":59,"dupIssuer.of":"ELPC"}
```

The observations match the supplied P31 expectations. GE.VI has no row in this
generation. The two short-list occurrences repeat two of the nine full-board
secondary tickers; they are not two additional issuers.

## Not entered, why

- RBI, QSR / QSP.TO: R11 describes economically equivalent exchangeable shares,
  not secondary listings. No entry and no flag.
- Molson Coors, TAP-A / TPX.TO: the same exchangeable-share distinction applies;
  the class attribution of TPX.TO is additionally unproven. No entry and no flag.

## Open decision

Visible removal of secondary rows would change ranks and membership. That needs
its own council decision and is outside this shadow task. Home-listing proposals
must not become selection rules through this reporting table.

## Verification

`node --test tests/dup-issuer-shadow-table.test.js tests/scoring/dup-issuer-shadow-export.test.js`
exited 0: 34 tests, 34 pass, 0 fail, 0 skipped. The guard runs all three real
mapper bodies with unrelated data helpers isolated in memory; the real hand-table
loader and marker run normally. An otherwise identical mapper run with the marker
bypassed provides the before-output comparison. No real snapshots are read.

Deliberate red proof, on the unprocessed in-memory pair only:

```text
$ node tests/scoring/dup-issuer-shadow-export.test.js --prove-red
AssertionError [ERR_ASSERTION]: CPLE3.SA: missing/wrong dupIssuer.of (expected ELPC)
+ actual - expected
+ undefined
- 'ELPC'
Exit code: 1
```

The normal suite also asserts that this unprocessed pair is rejected. No test was
disabled or weakened, and the red proof never mutates the writer or frozen files.

The documented `validateExport(afterDir)` invocation, which calls the same
validator as CLI `--check`, exited 0 on the written after tree:

```text
findash-export/v1 schema OK.
```

`docs/findash-export-v1.contract.json` was not modified; the new key requires no
change to its required-field lists. `git diff --check` passed, and git status
contains only the eight changed target files. No commit, push or publication is
part of this task.

An independent read-only reviewer found no concrete defects (96% confidence),
reran both new tests with 34 passes and independently reproduced the red proof.
The reviewer did not read the frozen generation or execute the complete gate.

`node scripts/test-gate.js --mode=all` was not run: existing tests can read
snapshots and other files outside the task's explicit read whitelist. The brief
both requires that run and forbids those reads. A clarification request is
pending; no exception has been assumed and no complete-gate success is claimed.
