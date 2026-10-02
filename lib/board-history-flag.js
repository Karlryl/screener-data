'use strict';
/**
 * lib/board-history-flag.js — the one rule for reading a board-history verdict.
 *
 * Since Tag 1396 every daily vintage is committed, flagged or not; the verdict travels
 * inside each board file as `gate`. Two classes, derived from `gate.reasons` (the verdict
 * logic itself lives unchanged in scripts/write-board-history.js evaluateGate()):
 *   - flagged     = gate.suspect === true (any reason)
 *   - structural  = a reason other than the p99 rule (cohort-empty, cohort-overlap-collapse,
 *                   nan-break, coverage-collapse:*, integritaets-verfall:*), OR the p99 rule
 *                   on a registered daten-schub transition whose fan-out cap broke.
 *   A flagged day that is not structural is a value warning (p99 only).
 *
 * Shared by the writer (exit code, prior walk) and rank-ic (skip flagged boards).
 */

const P99_GRUND = 'p99-delta-exceeds-threshold';

/**
 * True when a stored board vintage carries a gate verdict with suspect === true.
 * @param {object|null} vintage parsed board-history board file
 * @returns {boolean}
 */
function istGeflaggt(vintage) {
  return !!(vintage && vintage.gate && vintage.gate.suspect === true);
}

/**
 * True when a gate verdict is a structural break (not a p99-only value warning).
 * A stored block written since Tag 1396 carries `structural` itself (the only place the
 * fan-out part of the rule survives); older files and raw evaluateGate() results are
 * derived from their reasons.
 * @param {object|null} gate stored gate block or evaluateGate() result
 * @returns {boolean}
 */
function istStrukturell(gate) {
  if (!gate || typeof gate !== 'object') return false;
  if (typeof gate.structural === 'boolean') return gate.structural;
  const reasons = Array.isArray(gate.reasons) ? gate.reasons : [];
  if (reasons.some((r) => r !== P99_GRUND)) return true;
  // Fan-out part: only an evaluateGate() result carries datenSchub/fanOutHaelt.
  return reasons.includes(P99_GRUND) && gate.datenSchub === true && gate.fanOutHaelt === false;
}

module.exports = { istGeflaggt, istStrukturell, P99_GRUND };
