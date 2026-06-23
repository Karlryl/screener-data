# Court-Screen Findings — Handoff to the Formula/Court Gauntlet (2026-06-21)

> Confirmed audit findings in `court-score.js` / `court-screen.js` (court SCORING domain). These
> change court results, so they are routed to the gauntlet — NOT auto-fixed on the audit branch.
> Source: round-1 + round-2 audit (adversarially verified where round-2 completed).

## HIGH / CRITICAL
- **`court-score.js:205-209,218-236` (critical):** `growthSource` / `accelSource` / `durSource` are
  recorded in Schritt 1 but IGNORED in the Schritt-2 scoring — the provenance the score claims to
  use never actually gates it.
- **`court-screen.js:100-128` + `court-score.js:222,250,253` (high):** No FX/currency normalization
  anywhere — revenue, GP, FCF, RPO are taken raw from mixed-currency snapshots → cross-currency
  comparisons are apples-to-oranges (same Tag-219c class as the main pipeline's FX bug).
- **`court-score.js:241,238,253-269` (high):** Inorganic-growth / M&A detection is cosmetic — `pAuth`
  is hardcoded 0, so the inorganic flag can never fire.
- **`court-score.js:293-302,234` (high):** Collapse-reweight recomputes the score from DISPLAY-rounded
  axis values (axisS) rather than full-precision — rounding error leaks into the final score.
- **`court-score.js:151` (high):** `ma-rpo-snapshot.json` read is unguarded — a missing/corrupt file
  throws a raw ENOENT and aborts the court run.

## Why routed (not auto-fixed)
Court is a scoring system with its own pass/fail semantics + its own gauntlet (court-score-tests.js,
the Court-of-Judgment process). Auto-applying FX normalization or provenance-gating changes court
results and must go through that validation, like the methods/ SCORE_WEIGHTS findings. Full evidence
in `audit-reports/2026-06-21-round1-audit-report.md` and `...-round2-salvage.json`.
