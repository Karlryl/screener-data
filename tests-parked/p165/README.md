# P165 parked defect tests

These 14 tests remain expected red on origin/main `a443bb832e0797ef34b4be640dac79b95f286511`. All 19 corrected DL23 tests were rerun offline in an isolated export of that commit before copying: 5 passed and 14 failed on their expected assertions, with no infrastructure failures.

Each parked filename is its original DL23 filename plus `.parked`. The bytes are unchanged, and every SHA-256 below was recomputed and matched against DL23 `evidence/package-files.json` before and after copying. The five green tests and both DL23 helpers are in `tests/`, also byte-identical; no path edits were needed.

The extra extension is required: `scripts/test-gate.js` excludes these files both from `BLOCKING_GLOBS` and from the global `git ls-files *test.js` inventory. Merely placing a `.test.js` file outside `tests/` would trigger the orphan guard once tracked. A write-free probe of the unchanged gate verified zero blocking matches and zero parked orphan errors before copying; the original `.test.js` suffix was the counterexample and produced 14 orphan errors.

The original relative imports deliberately remain unchanged. These are stored test sources, not directly runnable tests in this folder. A future fix package must restore its test under the original `tests/<name>` path, retain the shared helpers, and pass the complete gate without weakening assertions. The SEC test uses the regular repository `merge-sec-xbrl.js`; no second copy is added to the repository.

## Defects and unlocking packages

| Parked file | F-number | Defect | Unlocking package | SHA-256 (DL23 and parked bytes) |
|---|---|---|---|---|
| `exports-excluded-currency.test.js.parked` | DL8 F-10 | Unproven trading-currency conversion exposes market cap instead of withholding it. | Unassigned; requires its own fix package. | `1ffa5a14a7505e6b2b98d1b872a3ed7999f57d0a9d2655ab6d499036bc7973fa` |
| `exports-index-branches.test.js.parked` | DL8 F-29 | Equal-length branch lists accept duplicate, unknown and non-string identifiers. | Unassigned; requires its own fix package. | `dd3a4b4af59cb59e87c6a550854c8b94b6cacedc445a3116e7b595babc27af1a` |
| `exports-sec-duration.test.js.parked` | DL8 F-02 | A quarter tagged FY is accepted as annual revenue and can invalidate a genuine annual value. | Separate analysis package required; no package number assigned. | `ee53a05cd3f897244c736e4782006d530f0a4719d17e5c2f54d50c8316979510` |
| `exports-smallcap-store.test.js.parked` | DL8 F-01 | Small-cap currency evidence and quarter counts are read from the main snapshot store. | P159 | `1207e57b51a4341b066aa75c0b3aa2837d025ceaa8077caf5c01b071388d0cb6` |
| `libb-reload-empty-cash.test.js.parked` | F-20-reload-history | An empty or missing cash-flow series can replace previously dated FCF and OCF history. | Unassigned; requires its own fix package. | `51f8132e114adf966e0c3aa6cd4c5f0994529882ebafc49cee6669908ac27bba` |
| `libb-sec-q4-intervals.test.js.parked` | F-21-sec-pit | Cross-year or overlapping quarters can produce an invalid derived Q4. | Unassigned; requires its own fix package. | `e7e816fec27780f9811ca7541074dfa3a2e8bf9b0fb0f7324fa046f151c1fefe` |
| `pull-annual-side-series.test.js.parked` | DL8 F-05 | Different annual window lengths create an SBC gap despite equal latest fiscal dates. | P159 | `fb2ea2a31ac0f4932c0ec961f5ba926ea4f8cd5abffd75dbc4ab56146a1df67e` |
| `pull-earnings-cache.test.js.parked` | DL8 F-04 | A pre-report cache satisfies an earnings-triggered refresh and can falsely advance the data clock. | Unassigned; requires its own fix package. | `70a1940eb61528746b8dede28733ad1627a0723161d8ee204e225f16b700a80d` |
| `pull-fx-timestamp-validation.test.js.parked` | DL8 F-03 | Malformed top-level or per-currency timestamps leave an FX rate usable as live evidence. | Unassigned; requires its own fix package. | `8a1e52248ab85ba9b6b1b269e645c711735cd0c39ac2df6984cf6d21229c999c` |
| `pull-gbp-pence-targets.test.js.parked` | DL8 F-31 | GBP reporters quoting per-share targets in GBp receive a 100-fold target conversion. | P162 | `f4ad14daef4ed8c4966633b659976d8021fe3b629d8da169e8a157aa9880a356` |
| `pull-insider-missing-shares.test.js.parked` | DL8 F-24 | A counted insider transaction with missing shares leaves a falsely known net-share total. | Unassigned; requires its own fix package. | `287cc9bc519047a4373a6fcee24c54ca952fcf675c7ca801c47c16225a383cde` |
| `pull-shard-complete-grammar.test.js.parked` | DL8 F-26 | Malformed shard parameters are accepted and can select an unintended partition. | Unassigned; requires its own fix package. | `0bbb557c5979c39657fec3324a9cf168c4ee4b21859c403743e2678ed5f17008` |
| `pull-subset-manifest.test.js.parked` | DL8 F-25 | A subset pull overwrites the prior full-universe manifest, including checkpoint writes. | Unassigned; requires its own fix package. | `c2f54c500d90a8fa87837e42f9cd88dd1f3e6b06e1f02b618b7ebd362fce2c56` |
| `root-rule40-canonical-identity.test.js.parked` | DL8 F-28 | Escaped filenames replace canonical identities, lose board joins, and admit invalid metadata. | Unassigned; requires a coordinated identity fix package. | `423eb6c3488e423d7b188a134957b0a425f08103d6c21fecda3fca238ce550e2` |

## Provenance and the Rule40 conflict

F-numbers follow the corrected DL23 test headers and DL13 `testkarte.csv` links. The CSV groups F-01/F-29 at module level; the corrected headers distinguish the small-cap and branch-validator tests. F-26 and F-28 are explicitly attributed by the corrected headers, while their corresponding CSV function rows contain no F-number. F-20 and F-21 retain the CSV labels `F-20-reload-history` and `F-21-sec-pit` without inventing a DL8 attribution.

`root-rule40-canonical-identity.test.js.parked` requires canonical `CON` and `A/B` identities joined to board scores 73 and 75. The existing `tests/rule40-reserved-name-snapshot.test.js` instead expects `_CON`, `onBoard === false`, and `row === null`. P165 leaves that existing test unchanged. The later identity fix must reconcile both tests together.

No production code, existing tests, gate configuration, dependencies, or historical data are changed by this package.
