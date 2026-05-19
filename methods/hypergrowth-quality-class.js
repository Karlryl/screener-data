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
function _rawArr(stock, path) {
  const a = H.val(stock, path);
  if (!Array.isArray(a)) return [];
  return a.map(v => v == null ? null : (typeof v === 'number' ? v : v.value));
}

function evaluate(stock) {
  const oiArr = _arr(stock, 'annual.annualOpInc');
  // Use raw arrays for revQ and revY so positional YoY comparisons (revQ[i] vs revQ[i+4]) stay aligned
  const revQ = _rawArr(stock, 'timeseries.revenueQ');
  const revY = _rawArr(stock, 'annual.annualRev');
  const yoyGrowth = H.metricValue(stock, 'revenueGrowthYoY');
  const ttmRev = H.metricValue(stock, 'revenueTTM') || (Number.isFinite(revY[0]) ? revY[0] : 0);
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

  // Faktor 1: Quarter Breadth — Tag 112d: Zwei-Tier-Schwelle
  //   strongQ = Y2Y > 50% (echter Hypergrowth-Tier — CRDO/ALAB/RDDT)
  //   solidQ  = Y2Y > 25% (solid growth — APP/NOW/MELI/ANET)
  let strongQ = 0, solidQ = 0, breadthOk = false, breadthSource = 'q';
  if (revQ.length >= 8) {
    breadthOk = true;
    for (let i = 0; i < 4; i++) {
      const cur = revQ[i], prev = revQ[i + 4];
      // Skip if either value is null/NaN — positional alignment preserved
      if (cur != null && Number.isFinite(cur) && cur > 0 && prev != null && Number.isFinite(prev) && prev > 0) {
        const g = (cur - prev) / prev;
        if (g > 0.5) strongQ++;
        if (g > 0.25) solidQ++;
      }
    }
  } else if (revY.filter(v => Number.isFinite(v)).length >= 4) {
    breadthOk = true; breadthSource = 'y';
    let validPairs = 0;
    for (let i = 0; i < 3; i++) {
      const cur = revY[i], prev = revY[i + 1];
      // Skip if either value is null/NaN — positional alignment preserved
      if (cur != null && Number.isFinite(cur) && cur > 0 && prev != null && Number.isFinite(prev) && prev > 0) {
        validPairs++;
        const g = (cur - prev) / prev;
        if (g > 0.5) strongQ++;
        if (g > 0.25) solidQ++;
      }
    }
    // Scale annual pairs (max 3) onto quarterly-equivalent 0-4 scale,
    // using actual valid pair count to avoid over-crediting null-gap years.
    if (validPairs > 0) {
      strongQ = Math.round(strongQ / validPairs * 4);
      solidQ  = Math.round(solidQ  / validPairs * 4);
    }
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
    const last4 = revQ.slice(0, 4).filter(v => v != null && Number.isFinite(v));
    if (last4.length === 4) {
      const total = last4.reduce((s, v) => s + v, 0);
      const max = Math.max(...last4);
      if (total > 0) spikeShare = max / total;
    }
  }

  // Klassifikation
  let cls, reasons = [];

  // Bug #18: LOW_BASE_EFFECT was only triggered when yoyGrowth > 100, so a
  // sub-material company with 25-99% growth escaped into TRUE_HYPERGROWTH.
  // Any immaterial company (revenue below floor) should be flagged regardless of growth rate.
  if (!isMaterial) {
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
      reasons.push(strongQ + '/4 Y >50%, OI: ' + oiDir);
    } else if (isBroadGrowth) {
      cls = 'REAL_HYPERGROWTH_BUT_LOSSY';
      reasons.push(strongQ + '/4 Y >50%, OI: ' + oiDir);
    } else if (breadthOk && solidQ >= 3 && isOIGood) {
      // Tag 112d: solid growth tier (25%+ konsistent) — APP/NOW/MELI
      cls = 'REAL_HYPERGROWTH_BUT_LOSSY';
      reasons.push(solidQ + '/4 Y >25%, OI: ' + oiDir);
    } else if (breadthOk && solidQ >= 3) {
      cls = 'HYPERGROWTH_REVIEW';
      reasons.push(solidQ + '/4 Y >25% (solid), OI: ' + oiDir);
    } else if (breadthOk && (strongQ >= 2 || solidQ >= 2)) {
      cls = 'HYPERGROWTH_REVIEW';
      reasons.push('mixed Q-pattern — Review');
    } else {
      cls = 'HYPERGROWTH_REVIEW';
      reasons.push('Daten unvollständig oder schwache Signale');
    }
  }

  const value = RANK[cls];
  const pass = value >= 4;  // REAL_HYPERGROWTH_BUT_LOSSY oder besser

  return H.buildResult({
    value, pass, computable: true,
    components: {
      class: cls,
      strongQuarters: strongQ, solidQuarters: solidQ,
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
