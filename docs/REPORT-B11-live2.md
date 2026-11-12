# B11 second live pass (12.11.2026)

Set of 300 SS/SZ tickers disjoint from the first 300 stored tickers (overlap 0), parser cn-q3-layout-v2, 899 HTTP calls. It is not disjoint from the 60 development fixtures: 7 of them (000711.SZ, 000725.SZ, 000738.SZ, 600489.SS, 600511.SS, 600515.SS, 600536.SS) are in the set and all parsed. Without them the rate is 273 of 293 = 93.2 percent; the 90 percent gate holds either way.

- Parsed 280 of 300 = 93.3 percent (gate 90 percent on a fresh set: met).
- Unparsed 20: unknown-prior-column-layout 6, revenue-or-ytd-anchor-mismatch 8, not-first-revenue-row 2, operating-revenue-anchor-missing 1, ambiguous-revenue-anchors 1, unknown-restatement-ytd-layout 1, q3-report-not-found 1 (600559.SS). All stay worthless gaps; no value is derived for them.
- Shadow report over the 600-ticker store (data day 2026-11-11): 477 of 546 recorded tickers recognised (87.4 percent), 472 agree, 5 mixed-basis, gate300 true, proposal state review-required-no-switch. No board number changed.
- Split by July row (cohorts of the shadow report): without a July row 223 agree / 3 mixed-basis, with a July row 249 agree / 2 mixed-basis (sum 472 / 5). The July vintage is not in the sparse clone; reproduce with `node scripts/cn-printed-shadow-report.js --snapshots=<snap folder> --data-day=2026-11-11 --store=external-data/exchange-quarters/cn-printed.json --baseline-dir=<main repo>/board-history --out=<out>` (without `--baseline-dir` every row is reported as `baseline-unavailable`).

Store: `external-data/exchange-quarters/cn-printed.json` now holds 600 tickers (the first 300 unchanged).
