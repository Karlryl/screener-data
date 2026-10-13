# Board-history backfills

Days under `board-history/` that were not written by the daily run itself but rebuilt afterwards from saved run data.

## 2026-10-02 (Tag 1405)

- **Why missing:** daily run 36984285974 (scoring job 110788880985, commit 347aaffb4e) scored the day, but the old value gate saw financials and real-estate as suspect (p99 delta 17.90 > 10.93, 8.90 > 8.20) and, through sibling coupling, withheld the whole day directory (writer exit 2). The Tag 1396 gate stores such a day with its verdict instead.
- **Inputs and sources:**
  - code and repo data (prices, earnings-calendar, external-data) at 347aaffb4e;
  - raw snapshots and merge-handoff (macro-regime) from the local backup of that run's raw data, plus `scripts/opinc-source-migrate.js` as in the job;
  - `outputs/hypergrowth/full/*`, `outputs/calibration.json` re-scored at 347aaffb4e; `outputs/universe-hash.json` from `write-excluded-list.js`;
  - prior day, `_gate-calibration.json`, `_excluded.json`, `data-health/p99-delta-history.json` from main (f56444adad);
  - `GITHUB_SHA` = 347aaffb4eb70e788672b0b0496c2061e34d4528 (formulaCommit).
- **Deviations from a live-written day:**
  1. `calibration.json` `generated_at` and `calibrationGeneratedAt` in the 14 board files are the re-score time 2026-10-02T14:44:18.996Z; the CI time was not saved (it lay between 09:51:38Z and 09:51:45Z).
  2. Written by the Tag 1396 writer (main f56444adad) with the hand tables of the run commit 347aaffb4e (`configs/financial-known-cases.json`, `lib/financial-known-cases.js`), so the pit blocks match the tables the day's scores were computed with.
- **Verification:** 9,756 rows compared with the published export (gh-pages efc37def26), 0 differences; field-level diff against the old writer's output on the same inputs: only `gate.structural` (false) added in the 14 board files, `calibration.json` and `regime.json` byte-identical; sidecars byte-identical to main; gate: financials and real-estate flagged by p99 only, structural false everywhere.
