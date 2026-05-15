'use strict';
/**
 * Tag 108: Profitability-State v3 — Triple-Source-Confirmation
 * =============================================================
 * Klassifiziert auf 3 Quellen: NetIncome, OperatingIncome, FreeCashflow.
 * Each source nutzt Tag 103f-Logic (Cyclical-Recovery + Persistent-Loss-Override).
 *
 * Final State:
 *   - Majority Vote (2-of-3 oder 3-of-3)
 *   - Bei tie/disagree: konservativ (niedrigster State im Hierarchie LOSS<TURN<RECENT<STABLE)
 *   - NI-Persistent-Loss-Override behält Veto: wenn NI-Source LOSS sagt via Persistent-Loss-Pattern, final = LOSS
 *
 * Visibility-Tag (in components.confidence): "3/3", "2/3 NI+OI", "1/3 OI" etc.
 * Macht Karl auf einen Blick sichtbar, wie bestätigt der State ist.
 */
const H = require('./_helpers.js');

const ID = 'profitability-state';
const LABEL = 'Profitability State';
const THRESHOLD = 'TURNAROUND';
const THRESHOLD_OP = 'gte';

const STATE_RANK = { LOSS: 0, TURNAROUND: 1, RECENT: 2, STABLE: 3 };
const RANK_STATE = ['LOSS', 'TURNAROUND', 'RECENT', 'STABLE'];
const MARGINAL_REV_PCT = 0.02;

function _getArr(stock, key) {
  const arr = H.val(stock, key);
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr.map(v => (v == null ? null : (typeof v === 'number' ? v : v.value)));
}

// Tag 103f-Logic: klassifiziert eine einzelne Quelle (NI, OI, oder FCF) zu LOSS/TURN/RECENT/STABLE
// Returns { state, persistentLoss: bool } — persistentLoss=true wenn LOSS via Median-Override
function _classifySource(arr, revArr) {
  if (!arr || arr.length === 0) return null;
  const y0 = arr[0];
  if (y0 == null) return null;

  // Hard LOSS: Y0 negativ
  if (y0 <= 0) return { state: 'LOSS', persistentLoss: false };

  const y1 = arr[1], y2 = arr[2], y3 = arr[3];

  // Count positive years
  let positiveCount = 0;
  let consecutiveFromY0 = 0;
  let counting = true;
  for (const v of arr) {
    if (v == null) break;
    if (v > 0) { positiveCount++; if (counting) consecutiveFromY0++; }
    else counting = false;
  }
  const yearsAvail = arr.filter(v => v != null).length;

  // Cyclical-Recovery
  const olderPositive = (y2 != null && y2 > 0) || (y3 != null && y3 > 0);
  if (yearsAvail >= 3 && olderPositive && positiveCount >= Math.ceil(yearsAvail / 2)) {
    return {
      state: consecutiveFromY0 >= 3 ? 'STABLE' : 'RECENT',
      persistentLoss: false
    };
  }

  // Klassischer TURNAROUND-Kandidat: Y-1 negativ, Y0 positiv
  if (y1 == null || y1 <= 0) {
    const rev = revArr && revArr[0] && revArr[0] > 0 ? revArr[0] : null;
    const marginOk = rev ? (y0 / rev >= MARGINAL_REV_PCT) : true;

    const recentLosses = arr.slice(0, 4).filter(v => v != null && v <= 0).map(v => Math.abs(v));
    if (recentLosses.length >= 3) {
      const sorted = recentLosses.slice().sort((a,b)=>a-b);
      // Bug #5: use standard median (average of two middle elements for even-length arrays)
      const mid = Math.floor(sorted.length / 2);
      const medianLoss = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      // ALNY-Pattern: Y0 unter median(prior losses) → Persistent-Loss-Override
      if (y0 < medianLoss) return { state: 'LOSS', persistentLoss: true };
      if (!marginOk) return { state: 'LOSS', persistentLoss: true };
      return { state: 'TURNAROUND', persistentLoss: false };
    }

    if (!marginOk) return { state: 'LOSS', persistentLoss: false };
    return { state: 'TURNAROUND', persistentLoss: false };
  }

  // Y0 + Y-1 beide positiv: STABLE oder RECENT
  if (consecutiveFromY0 >= 3) return { state: 'STABLE', persistentLoss: false };
  return { state: 'RECENT', persistentLoss: false };
}

function evaluate(stock) {
  const niArr = _getArr(stock, 'annual.annualNetIncome');
  const oiArr = _getArr(stock, 'annual.annualOpInc');
  const fcfArr = _getArr(stock, 'annual.annualFCF');
  const revArr = _getArr(stock, 'annual.annualRev');

  if (!niArr || niArr.length < 2) {
    return H.buildResult({
      computable: false,
      reason: 'insufficient netIncome history',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // Klassifiziere jede Quelle
  const niResult = _classifySource(niArr, revArr);
  const oiResult = oiArr && oiArr.length >= 2 ? _classifySource(oiArr, revArr) : null;
  const fcfResult = fcfArr && fcfArr.length >= 2 ? _classifySource(fcfArr, revArr) : null;

  if (!niResult) {
    return H.buildResult({
      computable: false,
      reason: 'cannot classify NI',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // Sammle gültige States
  const sources = [];
  sources.push({ name: 'NI', state: niResult.state, persistentLoss: niResult.persistentLoss });
  if (oiResult) sources.push({ name: 'OI', state: oiResult.state, persistentLoss: oiResult.persistentLoss });
  if (fcfResult) sources.push({ name: 'FCF', state: fcfResult.state, persistentLoss: fcfResult.persistentLoss });

  // NI-Persistent-Loss-Veto: ALNY-Pattern bleibt LOSS auch wenn OI/FCF abweichen
  let finalState;
  if (niResult.persistentLoss) {
    finalState = 'LOSS';
  } else {
    // Majority Vote
    const counts = {};
    for (const s of sources) counts[s.state] = (counts[s.state] || 0) + 1;
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (sorted[0][1] >= 2) {
      finalState = sorted[0][0];  // klare Mehrheit
    } else {
      // Tie: konservativ (niedrigster State)
      const ranks = sources.map(s => STATE_RANK[s.state]);
      finalState = RANK_STATE[Math.min(...ranks)];
    }
  }

  // Tag: "3/3", "2/3 NI+OI", "1/3 NI"
  const matchingSources = sources.filter(s => s.state === finalState);
  const confidenceTag = matchingSources.length + '/' + sources.length + ' ' + matchingSources.map(s => s.name).join('+');

  const stateRank = STATE_RANK[finalState];
  const pass = stateRank >= 1;
  return H.buildResult({
    value: stateRank,
    pass,
    computable: true,
    components: {
      state: finalState,
      confidence: confidenceTag,
      sources: sources.map(s => s.name + '=' + s.state).join(', '),
      yearsAvailable: niArr.length,
      latestNetIncome: niArr[0]
    },
    reason: 'state=' + finalState + ' (' + confidenceTag + ', NI Y0=' + (niArr[0]/1e6).toFixed(0) + 'M)',
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'LOSS / TURNAROUND / RECENT / STABLE — Triple-Source (NI+OI+FCF) mit Confidence-Tag (Tag 108)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'state',
  evaluate
};
