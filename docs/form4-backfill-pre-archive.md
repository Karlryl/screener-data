# Form 4 backfill: rows that left the cache before the archive existed

File: `external-data/archive/sec-form4/backfill-pre-archive.json.gz`, 49,876 bytes, 970 rows, built 30.10.2026 once. It is frozen (sha256 pinned in `tests/form4-backfill-archive.test.js`). No writer touches it: the writers only open `<YYYY-MM>.json.gz` by name. It lives apart from the monthly files so that the daily merge step can never hit a binary conflict on it. A future backtest reads cache, monthly archive and this file together.

## Scope of the walk
Every blob of `external-data/sec-form4-cache.json`: 13 commits on `origin/main` (from the import of 13.10.2026) plus 138 commits of the older history (first commit `3f20476d14`, 16.05.2026, last `49507ce504`, 08.10.2026). The older history is no longer on GitHub; it survives in the local object store under the ref `origin/archiv-main`, so 885 of the 970 rows had no public copy at all. A further 80 commits on side refs hold 7 other blobs and add no row key.

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

`backfill-purged-no-matching-transaction` must not be read as corrected data. In 370 of these 482 rows the new filing comes from another person. The candidate mechanism is `purgeAmendedPeriod`, which drops all rows of a ticker and period when a 4/A arrives. This is unconfirmed: the rows hold no form type, and no SEC filing was fetched.

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

## Format
Same lines as the monthly archive, so `readArchive` reads it: `{archivedAt, reason, ticker, row}`, `row` being the full, uncompacted row. Added fields: `source` with `lastSeenCommit`, `lastSeenDate`, `firstMissingCommit`, `firstMissingDate`, `lastSeenOnMain`, and for rows with a new filing `newSamePeriodFilings`, and `newFilingSamePerson` where it was tested. `filingDate` is on all 970 rows (T7). `periodOfReport` is missing on 260 rows, because the older rows never had it.

## Limits
- Only committed states are visible. A row that came and went between two commits, or a row dropped before its first commit (a late filing with an old transaction date, before the archive existed), is not in here. No commit exists between 08.10. and 13.10.
- The commit hashes of the older history resolve only in the local object store.
- The file's rows reach no board: only the two writers, `studie-mitschrift` (size and hash of the cache file alone) and tests touch these paths.

The one-time driver stays outside the repository, because the older history is not available to CI.
