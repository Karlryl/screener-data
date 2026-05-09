'use strict';
/**
 * Tag 112: Hypergrowth-Quality-Klassifikator
 * ============================================
 * Rule-Based 3-Faktor-Klassifikation (ChatGPT-Architektur):
 *   1. Quarter Breadth: wieviele der letzten 4 Q YoY > 50% wachsen?
 *      Real Hypergrowth: 3-4/4 stark | Q-Spike: oft nur 1/4
 *   2. OI Direction: annualOpInc-Trend
 *      flippt+, schrumpft = real | expandiert dramatisch = Fake
 *   3. Spike Concentration: max(letzte 4Q) / sum(letzte 4Q)
 *      <35% normal | >45% Spike-Verdacht | >55% wahrscheinlich Fake
 *
 * Plus Material-Threshold: TTM-Rev >= $100M ODER >= 0.5% Mcap
 *  (sonst: LOW_BASE_EFFECT — Mini-Stocks mit 300% Wachstum aus $5M-Basis raus)
 *
 * Output: Reason-Code (kein Aggregat-Score) — debugbarer als Composite.
 * Q_SPIKE_FAKE wird disqualifiziert (Hard-Fail).
 */
const H = require('./_helpers.js');

const ID = 'hypergrowth-quality-class';
const LABEL = 'HG-Quality';
const THRESHOLD = 'REAL_HYPERGROWTH_BUT_LOSSY';
const THRESHOLD_OP = 'gte';

const MATERIAL_REV_FLOOR = 100e6;
const MATERIAL_MCAP_RATIO = 0.005;

const RANK = {
  REAL_HYPERGROWTH_ACCELERATING: 5,
  REAL_HYPERGROWTH_BUT_LOSSY: 4,
  HYPERGROWTH_REVIEW: 3,
  LOW_BASE_EFFECT: 2,
  NOT_HYPERGROWTH: 1,
  Q_SPIKE_FAKE: 0
};

function _arr(stock, path) {
  const a = H.val(stock, path);
  if (!Array.isArray(a)) return [];
  return a.map(v => v == null ? null : (typeof v === 'number' ? v : v.value)).filter(v => Number.isFinite(v));
}

function evaluate(stock) {
  const oiArr = _arr(stock, 'annual.annualOpInc');
  const revQ = _arr(stock, 'timeseries.revenueQ');
  const revY = _arr(stock, 'annual.annualRev');
  const yoyGrowth = H.metricValue(stock, 'revenueGrowthYoY');
  const ttmRev = H.metricValue(stock, 'revenueTTM') || (revY[0] || 0);
  const mcapField = H.val(stock, 'marketCap');
  const mcap = (typeof mcapField === 'number') ? mcapField : (mcapField && mcapField.value) || 0;

  if (yoyGrowth == null) {
    return H.buildResult({
      computable: false, reason: 'no revenueGrowthYoY',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // Material-Threshold
  const isMaterial = ttmRev >= MATERIAL_REV_FLOOR || (mcap > 0 && ttmRev / mcap >= MATERIAL_MCAP_RATIO);

  // Faktor 1: Quarter Breadth (mit Annual-Fallback wenn <8Q verfuegbar)
  // Yahoo liefert oft nur 4-5Q → fallback auf annualRev YoY-Vergleich pro Jahr.
  let strongQ = 0, breadthOk = false, breadthSource = 'q';
  if (revQ.length >= 8) {
    breadthOk = true;
    for (let i = 0; i < 4; i++) {
      const cur = revQ[i], prev = revQ[i + 4];
      if (cur > 0 && prev > 0 && (cur - prev) / prev > 0.5) strongQ++;
    }
  } else if (revY.length >= 4) {
    // Fallback: count(annualRev YoY > 50%) ueber 3 Y2Y-Vergleiche
    breadthOk = true; breadthSource = 'y';
    for (let i = 0; i < 3; i++) {
      const cur = revY[i], prev = revY[i + 1];
      if (cur > 0 && prev > 0 && (cur - prev) / prev > 0.5) strongQ++;
    }
    // skaliere auf "von 4" damit Schwelle vergleichbar bleibt (3-of-3 ≈ 4-of-4)
    if (strongQ === 3) strongQ = 4;
    else if (strongQ === 2) strongQ = 3;
  }

  // Faktor 2: OI Direction
  let oiDir = 'unknown', oiSeverity = 0;
  if (oiArr.length >= 2) {
    const y0 = oiArr[0], y1 = oiArr[1];
    if (y0 > 0 && y1 <= 0) oiDir = 'flip-positive';
    else if (y0 > 0 && y1 > 0) oiDir = 'profitable';
    else if (y0 < 0 && y1 < 0) {
      if (Math.abs(y0) < Math.abs(y1) * 0.7) oiDir = 'loss-shrinking';
      else if (Math.abs(y0) > Math.abs(y1) * 1.5) {
        oiDir = 'loss-expanding';
        oiSeverity = Math.abs(y0) / Math.abs(y1);
      }
      else oiDir = 'loss-flat';
    }
    else if (y0 < 0 && y1 > 0) oiDir = 'flip-negative';
    else oiDir = 'mixed';
  }

  // Faktor 3: Spike Concentration
  let spikeShare = null;
  if (revQ.length >= 4) {
    const last4 = revQ.slice(0, 4);
    const total = last4.reduce((s, v) => s + v, 0);
    const max = Math.max(...last4);
    if (total > 0) spikeShare = max / total;
  }

  // Klassifikation
  let cls, reasons = [];

  if (!isMaterial && yoyGrowth > 100) {
    cls = 'LOW_BASE_EFFECT';
    reasons.push('TTM-Rev=' + (ttmRev/1e6).toFixed(0) + 'M unter Material-Schwelle');
  } else if (yoyGrowth < 25) {
    cls = 'NOT_HYPERGROWTH';
    reasons.push('YoY=' + yoyGrowth.toFixed(0) + '% unter 25%');
  } else {
    const isSpikeConc = (spikeShare != null && spikeShare > 0.45);
    const isBroadGrowth = (breadthOk && strongQ >= 3);
    const isOIBad = (oiDir === 'loss-expanding' && oiSeverity > 2);
    const isOIGood = (oiDir === 'flip-positive' || oiDir === 'loss-shrinking' || oiDir === 'profitable');

    if (isOIBad) {
      cls = 'Q_SPIKE_FAKE';
      reasons.push('OI-Verlust expandiert ' + oiSeverity.toFixed(1) + 'x — Cash-Burn-Anomalie');
    } else if (isSpikeConc && spikeShare > 0.55) {
      cls = 'Q_SPIKE_FAKE';
      reasons.push('Spike-Konzentration ' + Math.round(spikeShare*100) + '% (>55%)');
    } else if (isSpikeConc && breadthOk && strongQ <= 1) {
      cls = 'Q_SPIKE_FAKE';
      reasons.push('Spike ' + Math.round(spikeShare*100) + '% + nur ' + strongQ + '/4 Q stark');
    } else if (isBroadGrowth && isOIGood) {
      cls = 'REAL_HYPERGROWTH_ACCELERATING';
      reasons.push(strongQ + '/4 Q stark, OI: ' + oiDir);
    } else if (isBroadGrowth) {
      cls = 'REAL_HYPERGROWTH_BUT_LOSSY';
      reasons.push(strongQ + '/4 Q stark, OI: ' + oiDir);
    } else if (breadthOk && strongQ >= 2) {
      cls = 'HYPERGROWTH_REVIEW';
      reasons.push(strongQ + '/4 Q stark — Review');
    } else {
      cls = 'HYPERGROWTH_REVIEW';
      reasons.push('Daten unvollständig oder mixed signals');
    }
  }

  const value = RANK[cls];
  const pass = value >= 4;  // REAL_HYPERGROWTH_BUT_LOSSY oder besser

  return H.buildResult({
    value, pass, computable: true,
    components: {
      class: cls,
      strongQuarters: strongQ,
      breadthOk: breadthOk, breadthSource: breadthSource,
      oiDirection: oiDir,
      oiSeverity: oiSeverity,
      spikeShare: spikeShare != null ? Math.round(spikeShare * 100) : null,
      isMaterial: isMaterial,
      ttmRev: ttmRev
    },
    reason: cls + ' — ' + reasons.join('; '),
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Hypergrowth-Klassifikator: Quarter-Breadth + OI-Direction + Spike-Concentration → Reason-Code',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'class',
  evaluate
};
