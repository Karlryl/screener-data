# Readiness and blockers

Status on 2026-08-08: **NOT READY TO EXECUTE THE CONFIRMATORY STUDY**.

## Green foundations

- GQS-00@1.0.0 is frozen and independently reproducible.
- The V4 research question, five clocks, growth event, market event, matrix states, comparison arms and failure rules are preregistered.
- Research helpers and outcome-free fixtures have standalone regression tests.
- Existing adjusted-close history can support descriptive moving-average, RSI, MACD and close-based breakout calculations.
- Existing SEC material is useful for mapping and prototyping.

## Blocking gates

| Gate | Status | Why it blocks confirmatory results | Exit evidence |
|---|---|---|---|
| Entity/listing ledger | RED | Current tickers cannot be projected backward safely. | Effective-dated CIK, entity, security and listing mappings with tests. |
| Append-only SEC store | RED | Current aggregates do not preserve every original revision and acceptance timestamp. | Raw payload hashes, accessions, acceptance times and immutable revisions. |
| Historical universe | RED | Delisted, acquired and failed companies are not yet proven complete. | Point-in-time membership snapshots including exits and dead tickers. |
| As-of leakage gate | RED | The rule exists but has not been proven across the full ingestion path. | Automated negative tests that inject later facts and fail. |
| Adjusted OHLCV | RED | Current price history is adjusted close only. | Open, high, low, close, volume and split/dividend treatment with provenance. |
| Corporate actions/delistings | RED | Return paths and security continuity would be biased. | Effective-dated action ledger and delisting-return policy. |
| Historical GQS adapter | RED | GQS first-qualification dates cannot yet be reconstructed point in time. | Version-locked adapter reproducing historical snapshots from then-known facts. |
| Concept map | RED | Sector-specific accounting concepts can silently change the label. | Frozen concept/segment/units taxonomy and coverage report. |
| Blind coding agreement | RED | Retrospective theme labels can import outcome knowledge. | Two blinded coders, weighted kappa >=0.70 per dimension and exact agreement >=80%. |
| Research corpus seal | RED | Search breadth can be expanded selectively after outcomes are known. | Frozen append-only corpus, queries, source classes, cutoffs and content hashes. |
| Independent audit | RED | Final execution must be reviewed without seeing outcomes. | Signed methodology, data and source audits with no unresolved critical finding. |

## Explicitly prohibited until all gates are green

- No hit rate, false-alarm rate, lead time, information coefficient or return result.
- No claim that GQS is too late or that the matrix works.
- No retrospective AI-removal conclusion from unclassified companies.
- No parameter selection using 2021-2024 outcomes.
- No productive GQS or board change.
