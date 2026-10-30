# Form 4 backfill: rows that left the cache before the archive existed

File: `external-data/archive/sec-form4/backfill-pre-archive.json.gz`, 49,876 bytes, 970 rows, built 30.10.2026 once. It is frozen (sha256 pinned in `tests/form4-backfill-archive.test.js`). No writer touches it: the writers only open `<YYYY-MM>.json.gz` by name. It lives apart from the monthly files so that the daily merge step can never hit a binary conflict on it. A future backtest reads cache, monthly archive and this file together, as described under "Reading the file".

## Scope of the walk
Every blob of `external-data/sec-form4-cache.json`: 13 commits on `origin/main` (from the import of 13.10.2026) plus 138 commits of the older history (first commit `3f20476d14`, 16.05.2026, last `49507ce504`, 08.10.2026). The older history is no longer in this public repository; it is kept in a private archive repository and in the local object store (walked through the ref `origin/archiv-main`), so 885 of the 970 rows had no public copy at all. A further 80 commits on side refs add no row key.

A row key is ticker plus `txnKey`. Lost means: in some commit, and in neither the cache of `d4a3e7c368` nor the archive `2026-10.json.gz` of 30.10. Every kept row was re-found with equal content in the blob of its `lastSeenCommit`.

## Replaced or expired: how the reasons are told apart
Each row is judged at the first commit it is missing from, in this order.

| Reason | Test | Rows | Filings |
|---|---|---:|---:|
| `backfill-ticker-moved` | same `txnKey` under another ticker in that commit | 10 | 4 |
| `backfill-expired` | transaction date older than 180 days, no new filing for the period | 288 | 190 |
| `backfill-expired-or-replaced` | older than 180 days and a new filing for the period, cause cannot be separated | 1 | 1 |
| `backfill-replaced-same-transaction` | within 180 days; a new filing for the same ticker and period carries the same date, code, shares and person | 189 | 72 |
| `backfill-purged-no-matching-transaction` | within 180 days; a new filing for the same ticker and period arrived, but it does not carry this transaction | 482 | 305 |

Together 970 rows, 556 filings, 177 tickers (a filing can fall under two reasons). No row stayed unexplained.

The mechanism behind the replaced and purged rows is `purgeAmendedPeriod`, which drops all rows of a ticker and period when a 4/A arrives. This is confirmed in a sample, not row by row, because the rows hold no form type: in the blind review of PR #63 the new filing was a 4/A in 26 of 26 EDGAR checks, and in 14 of 14 of those where it came from another person.

Rows per month of the first commit without them:

| Month | Expired | Replaced | Purged | Moved | Either | Total |
|---|---:|---:|---:|---:|---:|---:|
| 2026-06 | 51 | 0 | 0 | 0 | 0 | 51 |
| 2026-07 | 9 | 0 | 0 | 0 | 0 | 9 |
| 2026-08 | 81 | 106 | 217 | 9 | 0 | 413 |
| 2026-09 | 101 | 56 | 156 | 0 | 0 | 313 |
| 2026-10 | 46 | 27 | 109 | 1 | 1 | 184 |

Last seen on `origin/main`: 85 rows, 62 filings (24 expired, 8 replaced, 53 purged); this confirms the count of the blind review of PR #55. Last seen in the older history: 885 rows.

The one row of `backfill-ticker-moved` also held by the monthly archive is CING, held there under CINGW, with equal content apart from the symbol. The test allows exactly this case.

## Reading the file
- **Duplicates.** Dedupe cache, monthly archive and this file by ticker + `txnKey`, because a key can come back later in a monthly file. This alone is not enough: a plain union double-counts the 189 replaced and 10 moved rows, whose successors have another accession number or another ticker and so another key. Do not count those rows in addition to their successors.
- **Point in time.** A replaced or purged row counts as valid from its `filingDate` until the filing date of the 4/A. `newSamePeriodFilings` names the 4/A by accession number; the rows of that filing carry its `filingDate`.
- **After the 4/A, purged rows split by `newFilingSamePerson`.**
  - `false` (370 rows): the 4/A came from another person. These rows must not be read as corrected; they are expected to stay valid.
  - `true` (112 rows): the same person filed again. 55 rows have the same date and code but different shares, so they look like real corrections. 45 have the same date and another code, and 12 have no row of the same date; these are further candidates for corrections.

## Format
Same lines as the monthly archive, so `readArchive` reads it: `{archivedAt, reason, ticker, row}`, `row` being the full, uncompacted row. Added fields: `source` with `lastSeenCommit`, `lastSeenDate`, `firstMissingCommit`, `firstMissingDate`, `lastSeenOnMain`, and for rows with a new filing `newSamePeriodFilings`, and `newFilingSamePerson` where it was tested. `filingDate` is on all 970 rows (T7). `periodOfReport` is missing on 260 rows, because the older rows never had it.

## Limits
- Only committed states are visible. A row that came and went between two commits, or a row dropped before its first commit (a late filing with an old transaction date, before the archive existed), is not in here.
- The walk missed 3 cache commits of the old main branch (09.10., 10.10. and the morning of 13.10.): 141 commits exist there, not 138, because `origin/archiv-main` ends earlier. They were read afterwards and add no row key, and no expiry reason changes. The `source` fields of the frozen file are inexact for 36 rows: `firstMissingCommit` names the import of 13.10., although the rows left in one of those three commits, and for 8 of them `lastSeenCommit` is one commit too early. The row content and `filingDate` are not affected. The file stays as it is, and this limit stands instead.
- A collapse before the cache shows only in raw SEC data. `txnKey` can merge two transactions when they are inserted, and the second then never reaches a commit: 1 of 95 transactions across 40 filings in the review's sample (ATTO `0000886982-26-000495`, two sales of 200 shares at the same price, one stored). The sample is small. The file is complete against the git history, not against the filings. The fix belongs in the writer.
- The commit hashes of the older history do not resolve in this public repository, only in the private archive repository and the local object store.
- The file's rows reach no board: only the two writers, `studie-mitschrift` (size and hash of the cache file alone) and tests touch these paths.

The one-time driver stays outside the repository, because the older history is not available to CI.
