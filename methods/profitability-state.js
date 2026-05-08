'use strict';
/**
 * Tag 103f: Profitability-State v2 (CORE)
 * =========================================
 * 4 Buckets: LOSS / TURNAROUND / RECENT / STABLE
 *
 * v2-Fixes gegen False-Positives die v1 hatte:
 *   - Cyclical-Recovery: Wenn vor dem Verlust schon profitabel war (Y-2/Y-3 positiv),
 *     ist es kein klassischer TURNAROUND sondern STABLE/RECENT.
 *   - Marginal-Turnaround: Y0 muss klar profitabel sein — Y0/|Y-1| >= 0.5 ODER Y0 >= 5% Revenue.
 *     Sonst bleibt LOSS (statistisches Rauschen einer Verlust-Reihe).
 *   - Persistent-Loss-Override: 3+ negative in 4 Jahren UND Y0 marginal → LOSS.
 *
 * Robust gegen ALNY-Bug (10y Verlust + 1 marginal-positiv → war fälschlich TURNAROUND).
 * Robust gegen LITE-Bug (positiv→Verlust→positiv = Cyclical, war fälschlich TURNAROUND).
 */
const H = require('./_helpers.js');

const ID = 'profitability-state';
const LABEL = 'Profitability State';
const THRESHOLD = 'TURNAROUND';
const THRESHOLD_OP = 'gte';

const MARGINAL_RATIO = 0.5;        // Y0 must be >= 50% of |Y-1| to count as turnaround
const MARGINAL_REV_PCT = 0.02;     // OR Y0 must be >= 2% of revenue (margin floor)

function _getArr(stock, key) {
  const arr = H.val(stock, key);
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr.map(v => (v == null ? null : (typeof v === 'number' ? v : v.value)));
}

function _classify(niArr, revArr) {
  if (!niArr || niArr.length === 0) return null;
  const y0 = niArr[0];
  if (y0 == null) return null;

  // Hard LOSS: Y0 <= 0
  if (y0 <= 0) return 'LOSS';

  // Y0 > 0 from here
  const y1 = niArr.length > 1 ? niArr[1] : null;
  const y2 = niArr.length > 2 ? niArr[2] : null;
  const y3 = niArr.length > 3 ? niArr[3] : null;

  // Count positive years across all available
  let positiveCount = 0;
  let consecutiveFromY0 = 0;
  let counting = true;
  for (const ni of niArr) {
    if (ni == null) break;
    if (ni > 0) {
      positiveCount++;
      if (counting) consecutiveFromY0++;
    } else {
      counting = false;
    }
  }

  // Cyclical-Recovery: Wenn die Mehrheit der Jahre profitabel war (>=50%) UND
  // ein älteres Y war positiv vor dem letzten Verlust, ist das kein klassischer Turnaround.
  // LITE: [26M, -547M, -132M, 199M] → positiveCount=2/4=50%, Y-3=199 positiv → Cyclical → RECENT.
  const yearsAvail = niArr.filter(v => v != null).length;
  const olderPositive = (y2 != null && y2 > 0) || (y3 != null && y3 > 0);
  if (yearsAvail >= 3 && olderPositive && positiveCount >= Math.ceil(yearsAvail / 2)) {
    return consecutiveFromY0 >= 3 ? 'STABLE' : 'RECENT';
  }

  // Klassischer TURNAROUND-Kandidat: Y-1 negativ, Y0 positiv
  if (y1 == null || y1 <= 0) {
    const y1Abs = Math.abs(y1 || 0);
    const rev = revArr && revArr[0] && revArr[0] > 0 ? revArr[0] : null;
    const marginOk = rev ? (y0 / rev >= MARGINAL_REV_PCT) : true;

    // Persistent-Loss-Check: 3+ negative in letzten 4y →
    //   Y0 muss median(|prior losses|) uebertreffen, sonst statistical noise.
    const recentLosses = niArr.slice(0, 4).filter(v => v != null && v <= 0).map(v => Math.abs(v));
    if (recentLosses.length >= 3) {
      const sorted = recentLosses.slice().sort((a,b)=>a-b);
      const medianLoss = sorted[Math.floor(sorted.length/2)];
      // ALNY: Y0=314 < median(278,440,1131)=440 → bleibt LOSS
      // CRDO: Y0=52 > median(17,22,28)=22 → wird TURNAROUND
      if (y0 < medianLoss) return 'LOSS';
      if (!marginOk) return 'LOSS';
      return 'TURNAROUND';
    }

    // 1-2 Verlust-Jahre: weichere Schwelle
    const ratioOk = y1Abs > 0 ? (y0 / y1Abs >= MARGINAL_RATIO) : true;
    if (!ratioOk && !marginOk) return 'LOSS';
    return 'TURNAROUND';
  }

  // Y0 + Y-1 beide positiv: STABLE oder RECENT
  if (consecutiveFromY0 >= 3) return 'STABLE';
  return 'RECENT';
}

function evaluate(stock) {
  const niArr = _getArr(stock, 'annual.annualNetIncome');
  const revArr = _getArr(stock, 'annual.annualRev');
  if (!niArr || niArr.length < 2) {
    return H.buildResult({
      computable: false,
      reason: 'insufficient netIncome history (need >=2 years)',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const state = _classify(niArr, revArr);
  if (state == null) {
    return H.buildResult({
      computable: false,
      reason: 'cannot classify state - null netIncome',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const stateRank = { LOSS: 0, TURNAROUND: 1, RECENT: 2, STABLE: 3 }[state];
  const pass = stateRank >= 1;
  return H.buildResult({
    value: stateRank,
    pass,
    computable: true,
    components: { state, yearsAvailable: niArr.length, latestNetIncome: niArr[0] },
    reason: 'state=' + state + ' (' + niArr.length + 'y, Y0=' + (niArr[0]/1e6).toFixed(0) + 'M)',
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'LOSS / TURNAROUND / RECENT / STABLE — robust gegen Cyclical/Marginal (Tag 103f)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'state',
  evaluate
};
