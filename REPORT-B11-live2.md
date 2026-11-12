# B11 second live pass (12.11.2026)

Fresh set of 300 SS/SZ tickers disjoint from the first 300 (overlap 0), parser cn-q3-layout-v2, 899 HTTP calls.

- Parsed 280 of 300 = 93.3 percent (gate 90 percent on a fresh set: met).
- Unparsed 20: unknown-prior-column-layout 6, revenue-or-ytd-anchor-mismatch 8, not-first-revenue-row 2, operating-revenue-anchor-missing 1, ambiguous-revenue-anchors 1, unknown-restatement-ytd-layout 1, q3-report-not-found 1 (600559.SS). All stay worthless gaps; no value is derived for them.
- Shadow report over the 600-ticker store (data day 2026-11-11): 477 of 546 recorded tickers recognised (87.4 percent), 472 agree, 5 mixed-basis, gate300 true, proposal state review-required-no-switch. No board number changed.

Store: `external-data/exchange-quarters/cn-printed.json` now holds 600 tickers (the first 300 unchanged).
