'use strict';

// Karl's rule (core rules, "Bauen und Prüfen"): after a formula change the old calculation stays visible as a comparison
// for at most four weeks. One table holds the end of every comparison arm the writers export, so an arm cannot outlive
// the rule because its end date lives in a comment or nowhere (untangle finding F004, 13.11.2026). An arm is shown while
// the data day is before `ends`; `start` is the merge day of the change that opened it. tests/comparison-ends.test.js
// fails when an arm spans more than MAX_COMPARISON_DAYS. The cycle-ramp comparison keeps its endsOn in
// protocol/gqs-00/1.2.0-pending/transition.json (read by scripts/cycle-ramp-deadline.js) and is not listed here.
const MAX_COMPARISON_DAYS = 28;
const COMPARISON_ARMS = Object.freeze({
  // PR #72 (Tag 1542, merged 07.11.2026): periodGateShadow, the growth figure and three axes with the period gate off.
  periodGate: Object.freeze({ start: '2026-11-07', ends: '2026-12-04' }),
  // G31 (#12, merged 19.10.2026): the *Legacy fields of the findash and Rule-of-40 exports, the pre-G31 calculation.
  g31Legacy: Object.freeze({ start: '2026-10-19', ends: '2026-11-16' }),
  // P290 (#89, merged 12.11.2026): excluded.json homeListing.oldRuleDiffers, the listing order before P290.
  p290OldRule: Object.freeze({ start: '2026-11-12', ends: '2026-12-10' }),
});

/**
 * The data day a comparison is judged on: the given day, else the frozen run day RUN_DATE_UTC, else the UTC clock day.
 * @param {string} [day] Data day YYYY-MM-DD.
 * @returns {string} Data day YYYY-MM-DD.
 */
function comparisonDataDay(day) {
  if (typeof day === 'string' && /^\d{4}-\d{2}-\d{2}/.test(day)) return day.slice(0, 10);
  const env = process.env.RUN_DATE_UTC || '';
  return /^\d{4}-\d{2}-\d{2}/.test(env) ? env.slice(0, 10) : new Date().toISOString().slice(0, 10);
}

/**
 * Whether a comparison arm is still exported on this data day.
 * @param {string} name Key of COMPARISON_ARMS (periodGate, g31Legacy, p290OldRule).
 * @param {string} [day] Data day YYYY-MM-DD; defaults to comparisonDataDay().
 * @returns {boolean} true while the data day is before the arm's end.
 */
function comparisonShown(name, day) {
  const arm = COMPARISON_ARMS[name];
  if (!arm) throw new Error(`[comparison-ends] unknown comparison arm: ${name}`);
  return comparisonDataDay(day) < arm.ends;
}

module.exports = { COMPARISON_ARMS, MAX_COMPARISON_DAYS, comparisonDataDay, comparisonShown };
