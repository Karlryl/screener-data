# Early-detection protocol versions

**Supersede status (2026-08-16):** `2.0.0` supersedes `1.2.0` under `SUPERSEDE_NO_DELETE`; see `2.0.0/supersede-record.json` (`decidedAt` 2026-08-16, released by Karl). `1.2.0` is preserved as an audit parent and is not executable.

**Reading `1.2.0/readiness-and-blockers.md`:** its status page (2 of 13 gates green, 11 red, dated 2026-08-08) is the historical state of the retired line, not open work; it carries no supersede note of its own because it is byte-sealed by `1.2.0/hash-manifest.json`. Do not re-litigate those 11 red gates — the successor gates live in `2.0.0/`.

- `1.0.0`: first sealed draft. Preserved byte-for-byte as an audit parent; superseded before any confirmatory outcome access after independent review found ambiguous endpoints and fail-open edge cases.
- `1.1.0`: outcome-blind correction draft rejected by final review. It is unsealed and must never be executed.
- `1.2.0`: corrected final candidate. It becomes active only after final independent re-review, a real freeze timestamp, an immutable hash manifest and a green verification run. It is now historical, superseded by `2.0.0`, and must not be executed.
- `2.0.0`: current protocol version. Its versioned records govern execution eligibility; this index is descriptive only and neither activates nor authorizes a run.

No result obtained under one version may be re-labelled as confirmatory under another version.
