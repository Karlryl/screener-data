'use strict';
/**
 * Pre-Breakout composite score (pb-score) — SINGLE SOURCE OF TRUTH.
 * ================================================================
 * This is the one shared definition of the dashboard's pb-score formula.
 * Both generate-screener.js (repo root) and scripts/snapshot-score-history.js
 * MUST import this module instead of forking the formula inline — otherwise the
 * stored score-history drifts from the displayed score and the dashboard shows a
 * permanent fake "score uplift today" artifact.
 *
 * Tag 200c — capped at 100:
 *   pb_score = min(max(revGrowth,0),100)/100 * 25  (current-year growth, capped)
 *            + min(max(grossMargin,0),100)/100 * 20 (margin level, capped at 100%)
 *            + min(max(r40,0),100)/100 * 15        (R40 capped at 100 — beyond is noise)
 *            + gmaBonus                            (GM trending up: accel=10, stable=4, else 0)
 *            + omaBonus                            (OM trending up — Damodaran: accel=15, stable=6, else 0)
 *            + revAccelBonus                       (growth re-accelerating: min(15, delta/50*15), only if delta>0)
 *   Caps prevent CRDO-level extremes (yoy=201, r40=217) from inflating the score.
 *
 * Pure function. Returns `null` when growth or grossMargin is not finite (mirrors
 * the original inline guard in generate-screener.js and the early `return null`
 * in snapshot-score-history.js). Behaviour is byte-identical to those two former
 * inline implementations — do not change weights, thresholds, clamps, or guards.
 *
 * @param {object} inputs
 * @param {number} inputs.growth        revenue growth YoY (percent)
 * @param {number} inputs.grossMargin   gross margin level (percent)
 * @param {number} [inputs.r40]         Rule-of-40 value (null/undefined treated as 0)
 * @param {string} [inputs.gmaTrend]    gross-margin-acceleration trend ('accelerating'|'stable'|...)
 * @param {string} [inputs.omaTrend]    operating-margin-acceleration trend ('accelerating'|'stable'|...)
 * @param {number} [inputs.revAccelDelta] revenue re-acceleration delta in pp (null/undefined = no bonus)
 * @returns {number|null}
 */
function computePbScore({ growth, grossMargin, r40, gmaTrend, omaTrend, revAccelDelta } = {}) {
  if (!Number.isFinite(growth) || !Number.isFinite(grossMargin)) return null;
  const growthC = Math.min(100, Math.max(0, growth));
  const gmC     = Math.min(100, Math.max(0, grossMargin));
  const r40C    = Math.min(100, Math.max(0, r40 || 0));
  const gmaBonus = (gmaTrend === 'accelerating') ? 10 : (gmaTrend === 'stable' ? 4 : 0);
  const omaBonus = (omaTrend === 'accelerating') ? 15 : (omaTrend === 'stable' ? 6 : 0);
  let revAccelBonus = 0;
  if (revAccelDelta != null && revAccelDelta > 0) {
    revAccelBonus = Math.min(15, revAccelDelta / 50 * 15);
  }
  return (growthC / 100 * 25) + (gmC / 100 * 20) + (r40C / 100 * 15) + gmaBonus + omaBonus + revAccelBonus;
}

module.exports = { computePbScore };
