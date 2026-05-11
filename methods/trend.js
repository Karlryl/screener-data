'use strict';
/**
 * Tag 31: Method-Trend-Detection
 * Tracks pro Stock pro Methode den Werte-Verlauf über Zeit.
 * Erkennt: improving, stable, deteriorating, oder n/a (zu wenig Daten).
 */

const HISTORY_WINDOW = 8;            // Tag 119: 12 -> 8 to keep alert-state.json bounded
const MIN_FOR_TREND = 3;              // ab 3 Datenpunkten wird Trend berechnet
const IMPROVE_PCT = 0.10;             // ≥10% Verbesserung über min vs. max → improving
const DETERIORATE_PCT = 0.10;         // ≥10% Verschlechterung → deteriorating

// Append entry zu history, trim window
function appendHistory(history, date, value, pass) {
  const safe = Array.isArray(history) ? history : [];
  return [...safe, { date, value, pass }].slice(-HISTORY_WINDOW);
}

// Berechnet Trend-Direction für eine Methode auf Basis numerischer Werte
function computeTrend(history, thresholdOp) {
  if (!Array.isArray(history) || history.length < MIN_FOR_TREND) {
    return { direction: 'n/a', delta: null, points: history ? history.length : 0 };
  }
  // Numeric-only points
  const pts = history.filter(h => h && typeof h.value === 'number' && Number.isFinite(h.value));
  if (pts.length < MIN_FOR_TREND) {
    return { direction: 'n/a', delta: null, points: pts.length };
  }
  // Compare median-of-recent-3 vs median-of-older
  const recent = pts.slice(-3);
  const older = pts.slice(0, -3);
  if (older.length === 0) {
    return { direction: 'n/a', delta: null, points: pts.length };
  }
  const median = (arr) => {
    const sorted = arr.map(p => p.value).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
  };
  const recentMed = median(recent);
  const olderMed = median(older);
  if (olderMed === 0) {
    const delta = recentMed - olderMed;
    return { direction: delta > 0 ? 'improving' : (delta < 0 ? 'deteriorating' : 'stable'), delta, points: pts.length };
  }
  const pctChange = (recentMed - olderMed) / Math.abs(olderMed);

  // For lte/lte_abs methods (Sloan, Net-Debt-EBITDA): lower is better
  // For gte methods (Rule of 40, ROIC, FCF-Yield, GM-Stability is lte): higher is better
  // Adjust trend direction based on thresholdOp
  let isImproving;
  if (thresholdOp === 'gte') {
    isImproving = pctChange > 0;  // rising = improving
  } else {
    isImproving = pctChange < 0;  // falling = improving
  }
  const absChange = Math.abs(pctChange);
  if (absChange < IMPROVE_PCT) {
    return { direction: 'stable', delta: pctChange, points: pts.length };
  }
  return { direction: isImproving ? 'improving' : 'deteriorating', delta: pctChange, points: pts.length };
}

module.exports = {
  HISTORY_WINDOW, MIN_FOR_TREND,
  appendHistory, computeTrend
};
