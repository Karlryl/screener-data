'use strict';
/**
 * Tag 98: Profitability-State (CORE)
 * ===================================
 * Klassifiziert den AKTUELLEN Profitability-Zustand auf einer von 3 Achsen:
 *
 *   LOSS     - netIncome Y-0 ≤ 0
 *   EMERGING - Y-0 > 0 UND (Y-1 ≤ 0 ODER nur 1-2 Jahre profitabel in Folge)
 *   STABLE   - 3+ Jahre profitabel in Folge
 *
 * Pass-Logik: pass = state ∈ {STABLE, EMERGING}. LOSS failt.
 * Aber: Hypergrowth-Stocks (CRDO/ALAB) failen oft hier - werden über Rule-of-40
 * gefangen. profitability-state ist EIN Signal von mehreren, nicht knockout.
 *
 * Ersetzt: multi-year-stability, recent-profitability, emerging-profitable (Tier-Logik).
 * Die alten 3 Methoden landen in methods/disabled/.
 */
const H = require('./_helpers.js');

const ID = 'profitability-state';
const LABEL = 'Profitability State';
const THRESHOLD = 'EMERGING';   // mindestens EMERGING = pass
const THRESHOLD_OP = 'gte';

function _getNetIncomeArr(stock) {
  const arr = H.val(stock, 'annual.annualNetIncome');
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr.map(v => (v == null ? null : (typeof v === 'number' ? v : v.value)));
}

function _classify(niArr) {
  // niArr: latest first. Mindestens 1 Jahr nötig. Ideal 4+.
  if (!niArr || niArr.length === 0) return null;
  const y0 = niArr[0];
  if (y0 == null) return null;
  if (y0 <= 0) return 'LOSS';

  // Y-0 ist positiv. Wieviele Jahre in Folge?
  let consec = 0;
  for (const ni of niArr) {
    if (ni == null) break;
    if (ni > 0) consec++;
    else break;
  }
  if (consec >= 3) return 'STABLE';
  return 'EMERGING';
}

function evaluate(stock) {
  const niArr = _getNetIncomeArr(stock);
  if (!niArr || niArr.length < 2) {
    return H.buildResult({
      computable: false,
      reason: `insufficient netIncome history (need ≥2 years)`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const state = _classify(niArr);
  if (state == null) {
    return H.buildResult({
      computable: false,
      reason: 'cannot classify state - null netIncome',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  // numerische Codierung für Sortierung: LOSS=0, EMERGING=1, STABLE=2
  const stateRank = { LOSS: 0, EMERGING: 1, STABLE: 2 }[state];
  const pass = stateRank >= 1;  // EMERGING oder STABLE
  return H.buildResult({
    value: stateRank,
    pass,
    computable: true,
    components: { state, yearsAvailable: niArr.length, latestNetIncome: niArr[0] },
    reason: `state=${state} (${niArr.length}y available, Y-0=${niArr[0]})`,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'LOSS / EMERGING / STABLE classification based on consecutive years profitable',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'state',
  evaluate
};
