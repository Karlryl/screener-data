# Early-detection protocol versions

- `1.0.0`: first sealed draft. Preserved byte-for-byte as an audit parent; superseded before any confirmatory outcome access after independent review found ambiguous endpoints and fail-open edge cases.
- `1.1.0`: outcome-blind correction draft rejected by final review. It is unsealed and must never be executed.
- `1.2.0`: corrected final candidate. It becomes active only after final independent re-review, a real freeze timestamp, an immutable hash manifest and a green verification run. It is now historical, superseded by `2.0.0`, and must not be executed.
- `2.0.0`: current protocol version. Its versioned records govern execution eligibility; this index is descriptive only and neither activates nor authorizes a run.

No result obtained under one version may be re-labelled as confirmatory under another version.
